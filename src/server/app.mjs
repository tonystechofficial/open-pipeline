// The app Worker's routes: the pages and the JSON API behind Cloudflare Access. Every request without
// an Access identity is refused, so the app stays closed even if Access is turned off by mistake.
import { temperatureOf, stageIndex, lostStage } from '../core/pipeline.mjs';
import { parseCsv } from '../core/csv.mjs';
import { fromCsvRow, contactOf } from '../core/intake.mjs';
import { clean } from '../core/text.mjs';
import { json, readJson, isoDate } from './http.mjs';
import { sendDigest } from './daily.mjs';

const ACTIVITY_KINDS = new Set(['note', 'call', 'meeting', 'email']);
const MAX_IMPORT_ROWS = 2000;
const PAGE_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** Custom fields as their types want them; an empty value removes the field. */
export function coerceFields(config, input) {
  const fields = {};
  const errors = [];
  for (const [id, raw] of Object.entries(input ?? {})) {
    const field = config.fields.find((f) => f.id === id);
    if (!field) { errors.push(`Champ inconnu : ${id}`); continue; }
    if (raw === null || raw === '') { fields[id] = null; continue; }
    if (field.type === 'number') {
      const n = Number(String(raw).replace(',', '.'));
      if (Number.isFinite(n)) fields[id] = n; else errors.push(`${field.label} : un nombre est attendu`);
    } else if (field.type === 'select') {
      if (field.options.some((o) => o.id === raw)) fields[id] = raw; else errors.push(`${field.label} : choix inconnu`);
    } else fields[id] = clean(raw, 500);
  }
  return { fields, errors };
}

const withTemperature = (config, deal) => ({ ...deal, temperature: temperatureOf(config, deal.stage) });

export async function handleApp(request, deps) {
  if (!deps.access) return new Response('Accès réservé : connectez-vous avec Cloudflare Access.', { status: 403 });
  const { store, config } = deps;
  const url = new URL(request.url);
  const { pathname: path } = url;
  const method = request.method;
  const now = deps.now ? deps.now() : new Date();
  const opts = { now };

  try {
    if (method === 'GET' && (path === '/' || path === '/index.html')) return new Response(deps.assets.html, { headers: { 'content-type': 'text/html; charset=utf-8', ...PAGE_HEADERS } });
    if (method === 'GET' && path === '/app.css') return new Response(deps.assets.css, { headers: { 'content-type': 'text/css; charset=utf-8' } });
    if (method === 'GET' && path === '/app.js') return new Response(deps.assets.js, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });

    if (method === 'GET' && path === '/api/config') {
      return json({
        name: config.name, timeZone: config.timeZone, fields: config.fields, sources: config.sources,
        stages: config.stages.map((s) => ({ ...s, temperature: temperatureOf(config, s.id) })),
      });
    }
    if (method === 'GET' && path === '/api/board') return json({ deals: (await store.board(opts)).map((d) => withTemperature(config, d)) });
    if (method === 'GET' && path === '/api/tasks') return json({ tasks: await store.openTasks(), idle: await store.idleDeals() });
    if (method === 'GET' && path === '/api/search') return json({ results: (await store.search(url.searchParams.get('q'))).map((d) => withTemperature(config, d)) });

    if (method === 'POST' && path === '/api/deals') return createDeal(await readJson(request), deps, opts);
    if (method === 'POST' && path === '/api/import') return importCsv(await readJson(request), deps, opts);
    if (method === 'POST' && path === '/api/digest') {
      const { sendEmail, to, appUrl, log } = deps;
      return json({ digest: await sendDigest({ store, config, now, sendEmail, to, appUrl, log }) });
    }

    let m = path.match(/^\/api\/deals\/([\w-]+)$/);
    if (m && method === 'GET') {
      const view = await store.deal(m[1]);
      return view ? json({ ...view, deal: withTemperature(config, view.deal) }) : json({ error: 'Introuvable' }, 404);
    }
    if (m && method === 'PATCH') return updateDeal(m[1], await readJson(request), deps, opts);

    m = path.match(/^\/api\/deals\/([\w-]+)\/activities$/);
    if (m && method === 'POST') {
      const body = await readJson(request);
      const kind = ACTIVITY_KINDS.has(body?.kind) ? body.kind : null;
      const text = String(body?.body ?? '').trim().slice(0, 5000);
      if (!kind || !text) return json({ error: 'Écrivez la note et choisissez son type.' }, 400);
      return (await store.addActivity(m[1], { kind, body: text }, opts)) ? json({ ok: true }, 201) : json({ error: 'Introuvable' }, 404);
    }

    m = path.match(/^\/api\/deals\/([\w-]+)\/tasks$/);
    if (m && method === 'POST') {
      const body = await readJson(request);
      const title = clean(body?.title, 200);
      const dueAt = isoDate(body?.dueAt);
      if (!title || !dueAt) return json({ error: 'Indiquez l’action et sa date.' }, 400);
      const task = await store.addTask(m[1], { title, dueAt }, opts);
      return task ? json({ task }, 201) : json({ error: 'Introuvable' }, 404);
    }

    m = path.match(/^\/api\/tasks\/([\w-]+)$/);
    if (m && method === 'PATCH') {
      const body = await readJson(request) ?? {};
      const dueAt = body.dueAt === undefined ? undefined : isoDate(body.dueAt);
      if (body.dueAt !== undefined && !dueAt) return json({ error: 'Date invalide.' }, 400);
      const task = await store.updateTask(m[1], { done: body.done === undefined ? undefined : Boolean(body.done), dueAt, title: clean(body.title, 200) ?? undefined }, opts);
      return task ? json({ task }) : json({ error: 'Introuvable' }, 404);
    }

    m = path.match(/^\/api\/contacts\/([\w-]+)$/);
    if (m && method === 'PATCH') {
      const body = await readJson(request) ?? {};
      const normalized = contactOf(body);
      if (body.phone && !normalized.phone) return json({ error: 'Numéro de téléphone invalide.' }, 400);
      if (body.email && !normalized.email) return json({ error: 'Email invalide.' }, 400);
      const set = Object.fromEntries(Object.keys(body).filter((k) => k in normalized).map((k) => [k, normalized[k]]));
      const contact = await store.updateContact(m[1], set, opts);
      return contact ? json({ contact }) : json({ error: 'Introuvable' }, 404);
    }

    return json({ error: 'Introuvable' }, 404);
  } catch (error) {
    (deps.log ?? console.error)('[open-pipeline]', error);
    return json({ error: 'Erreur interne' }, 500);
  }
}

async function createDeal(body, { store, config }, opts) {
  if (!body) return json({ error: 'Requête invalide.' }, 400);
  const contact = contactOf(body);
  if (!contact.name && !contact.phone && !contact.email) return json({ error: 'Indiquez au moins un nom, un téléphone ou un email.' }, 400);
  const stage = body.stage ?? config.sources.manuel.stage;
  if (stageIndex(config, stage) < 0) return json({ error: 'Étape inconnue.' }, 400);
  const { fields, errors } = coerceFields(config, body.fields);
  if (errors.length) return json({ error: errors.join(' ; ') }, 400);
  const next = body.nextAction && clean(body.nextAction.title, 200) && isoDate(body.nextAction.dueAt)
    ? { title: clean(body.nextAction.title, 200), dueAt: isoDate(body.nextAction.dueAt) }
    : null;
  const result = await store.applyIntake({
    source: 'manuel', sourceRef: null, at: opts.now.toISOString(), contact,
    fields: {
      ...(contact.trade && config.fields.some((f) => f.id === 'metier') ? { metier: contact.trade } : {}),
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)),
    },
    stage,
    activity: { kind: 'note', body: String(body.note ?? '').trim().slice(0, 5000) || 'Créé à la main.' },
    task: next,
  }, opts);
  return json(result, 201);
}

async function updateDeal(id, body, { store, config }, opts) {
  if (!body) return json({ error: 'Requête invalide.' }, 400);
  if (body.stage !== undefined && stageIndex(config, body.stage) < 0) return json({ error: 'Étape inconnue.' }, 400);
  const lostReason = clean(body.lostReason, 300);
  if (body.stage === lostStage(config).id && !lostReason) return json({ error: 'Indiquez la raison : perdu, ou à recontacter plus tard.' }, 400);
  const { fields, errors } = coerceFields(config, body.fields);
  if (errors.length) return json({ error: errors.join(' ; ') }, 400);
  const deal = await store.updateDeal(id, { stage: body.stage, title: clean(body.title, 120) ?? undefined, fields, lostReason: lostReason ?? undefined }, opts);
  if (!deal) return json({ error: 'Introuvable' }, 404);
  const recontactAt = isoDate(body.recontactAt);
  if (recontactAt) await store.addTask(id, { title: `Recontacter : ${deal.title}`, dueAt: recontactAt }, opts);
  return json({ deal: withTemperature(config, deal) });
}

async function importCsv(body, { store, config }, opts) {
  const { headers, rows } = parseCsv(String(body?.csv ?? '').slice(0, 2_000_000));
  if (!headers.length) return json({ error: 'Le fichier est vide.' }, 400);
  if (rows.length > MAX_IMPORT_ROWS) return json({ error: `Au plus ${MAX_IMPORT_ROWS} lignes par import.` }, 400);
  let created = 0;
  let merged = 0;
  const skipped = [];
  for (const [i, row] of rows.entries()) {
    const { intake, error } = fromCsvRow(headers, row, config, { at: opts.now.toISOString() });
    if (error) { skipped.push({ line: i + 2, error }); continue; }
    const result = await store.applyIntake(intake, opts);
    if (result.createdContact) created++; else merged++;
  }
  return json({ created, merged, skipped });
}
