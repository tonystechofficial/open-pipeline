// The D1 store: every read and write of the pipeline. One intake is written in one batch (contact,
// deal, activity, task), so a half-written intake cannot exist. The SQL is tested on Node's SQLite.
import { planIntake } from '../core/merge.mjs';
import { isClosed } from '../core/pipeline.mjs';

const CONTACT_COLUMNS = ['name', 'phone', 'email', 'company', 'trade', 'town'];
const CLOSED_SHOWN_DAYS = 30; // closed deals stay visible on the board this long
const uuid = () => crypto.randomUUID();
const withFields = (deal) => deal && { ...deal, fields: JSON.parse(deal.fields || '{}') };

export function d1Store(db, config) {
  const bound = (sql, ...args) => db.prepare(sql).bind(...args);
  const all = async (sql, ...args) => (await bound(sql, ...args).all()).results ?? [];
  const first = (sql, ...args) => bound(sql, ...args).first();
  const stageLabel = (id) => config.stages.find((s) => s.id === id)?.label ?? id;
  const wonStages = config.stages.filter((s) => s.won).map((s) => s.id);

  const activity = (contactId, dealId, { kind, body, source = null, sourceRef = null }, at) => [
    bound('INSERT INTO activities (id, contact_id, deal_id, kind, body, source, source_ref, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uuid(), contactId, dealId, kind, body, source, sourceRef, at),
    bound('UPDATE contacts SET last_activity_at = MAX(last_activity_at, ?) WHERE id = ?', at, contactId), // an older event never makes a contact look older
  ];

  async function findContact({ phone, email }) {
    if (phone) {
      const byPhone = await first('SELECT * FROM contacts WHERE phone = ? ORDER BY created_at LIMIT 1', phone);
      if (byPhone) return byPhone;
    }
    return email ? first('SELECT * FROM contacts WHERE email = ? ORDER BY created_at LIMIT 1', email) : null;
  }

  async function getDeal(id) {
    return withFields(await first('SELECT * FROM deals WHERE id = ?', id));
  }

  return {
    /** Writes an intake where it belongs (see core/merge.mjs). A source already recorded is skipped. */
    async applyIntake(intake, { now = new Date() } = {}) {
      if (intake.sourceRef && await first('SELECT id FROM activities WHERE source_ref = ?', intake.sourceRef)) return { duplicate: true };
      const contact = await findContact(intake.contact);
      const deals = contact ? (await all('SELECT * FROM deals WHERE contact_id = ? ORDER BY created_at DESC', contact.id)).map(withFields) : [];
      const plan = planIntake({ intake, contact, deals, config });
      const ts = now.toISOString();
      const at = intake.at ?? ts;
      const contactId = plan.contact.id ?? uuid();
      const dealId = plan.deal.id ?? uuid();
      const ops = [];

      if (!plan.contact.id) {
        const c = plan.contact.set;
        ops.push(bound('INSERT INTO contacts (id, name, phone, email, company, trade, town, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          contactId, c.name ?? null, c.phone ?? null, c.email ?? null, c.company ?? null, c.trade ?? null, c.town ?? null, ts, ts, at));
      } else {
        const keys = Object.keys(plan.contact.set).filter((k) => CONTACT_COLUMNS.includes(k));
        if (keys.length) ops.push(bound(`UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => plan.contact.set[k]), ts, contactId));
      }

      if (!plan.deal.id) {
        const d = plan.deal.set;
        ops.push(bound('INSERT INTO deals (id, contact_id, title, stage, source, fields, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          dealId, contactId, d.title ?? 'Sans nom', d.stage, d.source ?? null, JSON.stringify(plan.deal.fields ?? {}), ts, ts, isClosed(config, d.stage) ? ts : null));
      } else {
        const existing = deals.find((d) => d.id === dealId);
        const fields = { ...existing.fields, ...plan.deal.fields };
        const stage = plan.deal.set.stage ?? existing.stage;
        ops.push(bound('UPDATE deals SET stage = ?, fields = ?, updated_at = ? WHERE id = ?', stage, JSON.stringify(fields), ts, dealId));
        if (plan.deal.set.stage) ops.push(...activity(contactId, dealId, { kind: 'stage', body: `Étape : ${stageLabel(existing.stage)} → ${stageLabel(stage)}` }, ts));
      }

      ops.push(...activity(contactId, dealId, { ...plan.activity, source: plan.source, sourceRef: plan.sourceRef }, at));
      if (plan.task?.title && plan.task.dueAt) {
        ops.push(bound('INSERT INTO tasks (id, deal_id, title, due_at, created_at) VALUES (?, ?, ?, ?, ?)', uuid(), dealId, plan.task.title, plan.task.dueAt, ts));
      }
      await db.batch(ops);
      return { contactId, dealId, createdContact: !plan.contact.id, createdDeal: !plan.deal.id };
    },

    /** Open deals, plus those closed in the last 30 days, each with its next open task. */
    async board({ now = new Date() } = {}) {
      const since = new Date(now.getTime() - CLOSED_SHOWN_DAYS * 86_400_000).toISOString();
      const rows = await all(`SELECT d.id, d.title, d.stage, d.fields, d.updated_at, d.closed_at,
          c.name AS contact_name, c.company, c.phone, c.email,
          (SELECT t.title FROM tasks t WHERE t.deal_id = d.id AND t.done_at IS NULL ORDER BY t.due_at LIMIT 1) AS next_title,
          (SELECT t.due_at FROM tasks t WHERE t.deal_id = d.id AND t.done_at IS NULL ORDER BY t.due_at LIMIT 1) AS next_due
        FROM deals d JOIN contacts c ON c.id = d.contact_id
        WHERE d.closed_at IS NULL OR d.closed_at >= ?
        ORDER BY d.updated_at DESC`, since);
      return rows.map(withFields);
    },

    /** A deal with its contact, its tasks (open first) and its timeline (newest first). */
    async deal(id) {
      const deal = await getDeal(id);
      if (!deal) return null;
      const [contact, tasks, activities] = await Promise.all([
        first('SELECT * FROM contacts WHERE id = ?', deal.contact_id),
        all('SELECT * FROM tasks WHERE deal_id = ? ORDER BY done_at IS NOT NULL, due_at', id),
        all('SELECT * FROM activities WHERE deal_id = ? ORDER BY at DESC LIMIT 200', id),
      ]);
      return { deal, contact, tasks, activities };
    },

    /** Stage, title, fields (a null or empty value removes the field), lost reason. */
    async updateDeal(id, { stage, title, fields, lostReason } = {}, { now = new Date() } = {}) {
      const deal = await getDeal(id);
      if (!deal) return null;
      const ts = now.toISOString();
      const nextStage = stage ?? deal.stage;
      const merged = { ...deal.fields };
      for (const [k, v] of Object.entries(fields ?? {})) {
        if (v === null || v === '') delete merged[k];
        else merged[k] = v;
      }
      const closedAt = isClosed(config, nextStage) ? (deal.closed_at ?? ts) : null;
      const ops = [bound('UPDATE deals SET stage = ?, title = ?, fields = ?, lost_reason = ?, closed_at = ?, updated_at = ? WHERE id = ?',
        nextStage, title ?? deal.title, JSON.stringify(merged), lostReason ?? (nextStage === deal.stage ? deal.lost_reason : null), closedAt, ts, id)];
      if (closedAt && !deal.closed_at) {
        // A closed deal's open tasks no longer mean anything ("send the quote" on a lost deal).
        ops.push(bound('UPDATE tasks SET done_at = ? WHERE deal_id = ? AND done_at IS NULL', ts, id));
      }
      if (nextStage !== deal.stage) {
        const reason = lostReason ? ` (${lostReason})` : '';
        ops.push(...activity(deal.contact_id, id, { kind: 'stage', body: `Étape : ${stageLabel(deal.stage)} → ${stageLabel(nextStage)}${reason}` }, ts));
      }
      await db.batch(ops);
      return getDeal(id);
    },

    async updateContact(id, set, { now = new Date() } = {}) {
      const keys = Object.keys(set ?? {}).filter((k) => CONTACT_COLUMNS.includes(k));
      if (!keys.length) return first('SELECT * FROM contacts WHERE id = ?', id);
      await bound(`UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => set[k] ?? null), now.toISOString(), id).run();
      return first('SELECT * FROM contacts WHERE id = ?', id);
    },

    async addActivity(dealId, { kind, body }, { now = new Date() } = {}) {
      const deal = await getDeal(dealId);
      if (!deal) return null;
      await db.batch([...activity(deal.contact_id, dealId, { kind, body }, now.toISOString()),
        bound('UPDATE deals SET updated_at = ? WHERE id = ?', now.toISOString(), dealId)]);
      return true;
    },

    async addTask(dealId, { title, dueAt }, { now = new Date() } = {}) {
      if (!await getDeal(dealId)) return null;
      const id = uuid();
      await bound('INSERT INTO tasks (id, deal_id, title, due_at, created_at) VALUES (?, ?, ?, ?, ?)', id, dealId, title, dueAt, now.toISOString()).run();
      return first('SELECT * FROM tasks WHERE id = ?', id);
    },

    async updateTask(id, { done, dueAt, title } = {}, { now = new Date() } = {}) {
      const task = await first('SELECT * FROM tasks WHERE id = ?', id);
      if (!task) return null;
      const doneAt = done === undefined ? task.done_at : (done ? now.toISOString() : null);
      await bound('UPDATE tasks SET done_at = ?, due_at = ?, title = ? WHERE id = ?', doneAt, dueAt ?? task.due_at, title ?? task.title, id).run();
      return first('SELECT * FROM tasks WHERE id = ?', id);
    },

    /** Open tasks, soonest first: the tasks page and the morning email. A deal closing completes its own. */
    async openTasks() {
      return all(`SELECT t.id, t.title, t.due_at AS dueAt, d.id AS dealId, d.title AS dealTitle, c.name AS contactName
        FROM tasks t JOIN deals d ON d.id = t.deal_id JOIN contacts c ON c.id = d.contact_id
        WHERE t.done_at IS NULL ORDER BY t.due_at`);
    },

    /** Open deals without any open task: the ones that get forgotten. */
    async idleDeals() {
      const rows = await all(`SELECT d.id, d.title, d.stage FROM deals d
        WHERE d.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.deal_id = d.id AND t.done_at IS NULL)
        ORDER BY d.updated_at`);
      return rows.map((d) => ({ ...d, stageLabel: stageLabel(d.stage) }));
    },

    async search(q) {
      const like = `%${String(q ?? '').trim()}%`;
      if (like === '%%') return [];
      return all(`SELECT d.id, d.title, d.stage, c.name AS contact_name, c.company, c.phone, c.email, c.town
        FROM deals d JOIN contacts c ON c.id = d.contact_id
        WHERE d.title LIKE ? OR c.name LIKE ? OR c.company LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.town LIKE ?
        ORDER BY d.updated_at DESC LIMIT 30`, like, like, like, like, like, like);
    },

    /**
     * Deletes the contacts untouched since `cutoff` that have no open deal and were never clients
     * (a won stage), with their deals, tasks and timeline. Returns how many contacts went.
     */
    async purge(cutoff) {
      const won = wonStages.length ? `OR d.stage IN (${wonStages.map(() => '?').join(', ')})` : '';
      const old = await all(`SELECT c.id FROM contacts c WHERE c.last_activity_at < ?
        AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND (d.closed_at IS NULL ${won}))`, cutoff, ...wonStages);
      for (const { id } of old) {
        await db.batch([
          bound('DELETE FROM activities WHERE contact_id = ?', id),
          bound('DELETE FROM tasks WHERE deal_id IN (SELECT id FROM deals WHERE contact_id = ?)', id),
          bound('DELETE FROM deals WHERE contact_id = ?', id),
          bound('DELETE FROM contacts WHERE id = ?', id),
        ]);
      }
      return old.length;
    },
  };
}
