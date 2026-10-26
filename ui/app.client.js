// The pipeline's pages: one module, hash routes, the app Worker's JSON API. No dependency, no inline
// script (the page's content security policy allows none). Everything shown goes through esc().

const view = document.getElementById('view');
const $ = (sel, root = view) => root.querySelector(sel);
let config = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { note: 'Note', call: 'Appel', meeting: 'Rendez-vous', email: 'Email', booking: 'Réservation', form: 'Formulaire', import: 'Import', stage: 'Étape' };

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

const tz = () => config?.timeZone || 'Europe/Paris';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const fmtDate = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const money = (n) => (n == null ? '' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n));
const stageLabel = (id) => config.stages.find((s) => s.id === id)?.label ?? id;
const lostStage = () => config.stages.find((s) => s.lost);
const flash = (msg, ok = false) => `<p class="flash flash--${ok ? 'ok' : 'bad'}">${esc(msg)}</p>`;
/** +33612345678 as 06 12 34 56 78; any other number as it is. */
const phoneFr = (p) => (/^\+33\d{9}$/.test(p ?? '') ? `0${p.slice(3)}`.match(/\d{2}/g).join(' ') : p ?? '');
/** A local date and time typed in the page, as the instant the server stores. */
const toIso = (local) => (local ? new Date(local).toISOString() : null);
function tomorrowAt9() {
  const d = new Date(Date.now() + 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

function nextBadge(due, title) {
  if (!due) return '<span class="next next--none">Aucune prochaine action</span>';
  const d = dayKey(due);
  const today = dayKey(new Date());
  const cls = d < today ? 'late' : d === today ? 'today' : 'later';
  return `<span class="next next--${cls}">${esc(title)} · ${esc(fmtDate(due))}</span>`;
}

function offerLine(fields = {}) {
  const option = config.fields.find((f) => f.id === 'offre')?.options?.find((o) => o.id === fields.offre);
  return [option?.label, fields.montant_installation != null && money(fields.montant_installation), fields.montant_mensuel != null && `${money(fields.montant_mensuel)}/mois`].filter(Boolean).join(' · ');
}

// ---- Tableau ----------------------------------------------------------------------------------

async function board() {
  const { deals } = await api('GET', '/api/board');
  const legend = [['froid', 'Froid'], ['tiede', 'Tiède'], ['chaud', 'Chaud'], ['gagne', 'Gagné']].map(([t, l]) => `<span><span class="temp temp--${t}"></span>${l}</span>`).join('');
  view.innerHTML = `<p class="legend muted">${legend}<span>Glissez une carte vers une autre colonne, ou ouvrez-la pour changer d'étape.</span></p>
  <div class="board">${config.stages.map((s) => {
    const items = deals.filter((d) => d.stage === s.id);
    const monthly = items.reduce((t, d) => t + (Number(d.fields?.montant_mensuel) || 0), 0);
    return `<section class="col ${s.closed ? 'col--closed' : ''}" data-stage="${esc(s.id)}">
      <div class="col__head"><h2>${esc(s.label)} <span class="muted">${items.length}</span></h2>${monthly ? `<span class="col__sum">${esc(money(monthly))}/mois</span>` : ''}</div>
      ${items.map(card).join('') || '<p class="muted">—</p>'}
    </section>`;
  }).join('')}</div>`;
  wireDrag();
}

function card(d) {
  const meta = [d.contact_name && d.contact_name !== d.title ? d.contact_name : null, offerLine(d.fields)].filter(Boolean).join(' · ');
  return `<a class="card" draggable="true" data-id="${esc(d.id)}" href="#/deal/${esc(d.id)}">
    <span class="card__title"><span class="temp temp--${esc(d.temperature)}" title="${esc(d.temperature)}"></span>${esc(d.title)}</span>
    ${meta ? `<span class="card__meta">${esc(meta)}</span>` : ''}
    ${d.closed_at ? '' : nextBadge(d.next_due, d.next_title)}
  </a>`;
}

// Drag and drop is for a mouse; on a phone, the stage is changed from the deal page.
function wireDrag() {
  let dragged = null;
  for (const el of view.querySelectorAll('.card')) {
    el.addEventListener('dragstart', (e) => {
      dragged = { id: el.dataset.id, stage: el.closest('.col').dataset.stage };
      e.dataTransfer.setData('text/plain', el.dataset.id);
    });
  }
  for (const col of view.querySelectorAll('.col')) {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('is-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('is-over');
      if (dragged && dragged.stage !== col.dataset.stage) await moveDeal(dragged.id, col.dataset.stage);
      dragged = null;
    });
  }
}

async function moveDeal(id, stage) {
  const body = { stage };
  if (stage === lostStage().id) {
    const answer = await askLost();
    if (!answer) return;
    Object.assign(body, answer);
  }
  try { await api('PATCH', `/api/deals/${id}`, body); } catch (e) { alert(e.message); }
  render();
}

/** The reason a deal is lost or put off, and when to get back in touch; null if cancelled. */
function askLost() {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.innerHTML = `<form class="form" method="dialog">
    <h2>${esc(lostStage().label)}</h2>
    <label>Raison<input name="lostReason" required placeholder="Pas de budget, rappeler au printemps…"></label>
    <label>Recontacter le (facultatif)<input type="date" name="recontactAt"></label>
    <div class="actions"><button class="btn btn--primary" value="ok">Valider</button><button class="btn" value="cancel" formnovalidate>Annuler</button></div>
  </form>`;
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      const f = dialog.querySelector('form');
      const reason = f.lostReason.value.trim();
      dialog.remove();
      if (dialog.returnValue !== 'ok' || !reason) return resolve(null);
      resolve({ lostReason: reason, ...(f.recontactAt.value ? { recontactAt: toIso(`${f.recontactAt.value}T09:00`) } : {}) });
    });
  });
}

// ---- Fiche affaire ------------------------------------------------------------------------------

function fieldInput(f, value) {
  const v = value ?? '';
  if (f.type === 'select') {
    return `<label>${esc(f.label)}<select name="${esc(f.id)}"><option value=""></option>${f.options.map((o) => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  }
  return `<label>${esc(f.label)}<input name="${esc(f.id)}" ${f.type === 'number' ? 'type="number" step="any"' : ''} value="${esc(v)}"></label>`;
}

async function deal(id) {
  const { deal: d, contact: c, tasks, activities } = await api('GET', `/api/deals/${id}`);
  const lost = lostStage();
  const contactFields = [['name', 'Nom'], ['phone', 'Téléphone'], ['email', 'Email'], ['company', 'Entreprise'], ['trade', 'Métier'], ['town', 'Ville']];
  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at);
  const taskItem = (t) => `<li><input type="checkbox" data-task="${esc(t.id)}" ${t.done_at ? 'checked' : ''} aria-label="Fait"><span class="${t.done_at ? 'done' : ''}">${esc(t.title)}</span><span class="muted">${esc(fmtDate(t.due_at))}</span></li>`;
  view.innerHTML = `
  <p><a href="#/">← Tableau</a></p>
  <div id="msg"></div>
  <div class="deal">
    <div>
      <section class="panel">
        <h1><span class="temp temp--${esc(d.temperature)}"></span> ${esc(d.title)}</h1>
        <p class="muted">${esc(stageLabel(d.stage))}${d.lost_reason ? ` · ${esc(d.lost_reason)}` : ''}${d.source ? ` · via ${esc(config.sources[d.source]?.label ?? d.source)}` : ''}</p>
        <p class="contact-links">${c.phone ? `<a href="tel:${esc(c.phone)}">Appeler ${esc(phoneFr(c.phone))}</a>` : ''}${c.email ? `<a href="mailto:${esc(c.email)}">Écrire</a>` : ''}</p>
        <form id="stageForm">
          <div class="row">
            <label>Étape<select name="stage">${config.stages.map((s) => `<option value="${esc(s.id)}" ${s.id === d.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
            <button class="btn btn--small" type="submit">Changer</button>
          </div>
          <div class="grid2" id="lostFields" hidden>
            <label>Raison<input name="lostReason" placeholder="Pas de budget, rappeler au printemps…"></label>
            <label>Recontacter le<input type="date" name="recontactAt"></label>
          </div>
        </form>
      </section>
      <section class="panel">
        <h2>Contact</h2>
        <form id="contactForm" class="grid2">${contactFields.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(k === 'phone' ? phoneFr(c.phone) : c[k] ?? '')}"></label>`).join('')}</form>
        <div class="actions"><button class="btn btn--small" form="contactForm" type="submit">Enregistrer le contact</button></div>
      </section>
      <section class="panel">
        <h2>Informations</h2>
        <form id="fieldsForm" class="grid2">${config.fields.map((f) => fieldInput(f, d.fields?.[f.id])).join('')}</form>
        <div class="actions"><button class="btn btn--small" form="fieldsForm" type="submit">Enregistrer</button></div>
      </section>
    </div>
    <div>
      <section class="panel">
        <h2>Prochaines actions</h2>
        <ul class="tasks">${open.map(taskItem).join('') || '<li class="muted">Aucune : ajoutez la prochaine action.</li>'}</ul>
        ${done.length ? `<details class="done-tasks"><summary class="muted">Faites (${done.length})</summary><ul class="tasks">${done.map(taskItem).join('')}</ul></details>` : ''}
        <form id="taskForm" class="row">
          <label>Action<input name="title" required placeholder="Rappeler, envoyer le devis…"></label>
          <label>Quand<input type="datetime-local" name="dueAt" required value="${tomorrowAt9()}"></label>
          <button class="btn btn--primary btn--small" type="submit">Ajouter</button>
        </form>
      </section>
      <section class="panel">
        <h2>Historique</h2>
        <form id="noteForm">
          <div class="row"><label>Type<select name="kind"><option value="note">Note</option><option value="call">Appel</option><option value="meeting">Rendez-vous</option><option value="email">Email</option></select></label></div>
          <label>Ce qui s'est dit<textarea name="body" required placeholder="Besoins, objections, budget, échéance, qui décide…"></textarea></label>
          <div class="actions"><button class="btn btn--primary btn--small" type="submit">Ajouter à l'historique</button></div>
        </form>
        <ul class="timeline">${activities.map((a) => `<li><span class="kind">${esc(KIND[a.kind] ?? a.kind)}</span><span class="when">${esc(fmtDate(a.at))}</span><p>${esc(a.body)}</p></li>`).join('')}</ul>
      </section>
    </div>
  </div>`;

  const save = (fn) => async (e) => {
    e.preventDefault();
    try { await fn(e.target); await render(); } catch (err) { $('#msg').innerHTML = flash(err.message); window.scrollTo(0, 0); }
  };
  const stageForm = $('#stageForm');
  const lostFields = $('#lostFields');
  stageForm.stage.addEventListener('change', () => { lostFields.hidden = stageForm.stage.value !== lost.id; });
  stageForm.addEventListener('submit', save((f) => {
    const body = { stage: f.stage.value };
    if (body.stage === lost.id) {
      body.lostReason = f.lostReason.value;
      if (f.recontactAt.value) body.recontactAt = toIso(`${f.recontactAt.value}T09:00`);
    }
    return api('PATCH', `/api/deals/${id}`, body);
  }));
  $('#contactForm').addEventListener('submit', save((f) => api('PATCH', `/api/contacts/${c.id}`, Object.fromEntries(new FormData(f)))));
  $('#fieldsForm').addEventListener('submit', save((f) => api('PATCH', `/api/deals/${id}`, { fields: Object.fromEntries(new FormData(f)) })));
  $('#taskForm').addEventListener('submit', save((f) => api('POST', `/api/deals/${id}/tasks`, { title: f.title.value, dueAt: toIso(f.dueAt.value) })));
  $('#noteForm').addEventListener('submit', save((f) => api('POST', `/api/deals/${id}/activities`, { kind: f.kind.value, body: f.body.value })));
  wireTaskChecks();
}

function wireTaskChecks() {
  for (const box of view.querySelectorAll('[data-task]')) {
    box.addEventListener('change', async () => {
      try { await api('PATCH', `/api/tasks/${box.dataset.task}`, { done: box.checked }); } catch (e) { alert(e.message); }
      render();
    });
  }
}

// ---- Tâches -------------------------------------------------------------------------------------

async function tasks() {
  const { tasks: open, idle } = await api('GET', '/api/tasks');
  const today = dayKey(new Date());
  const item = (t) => `<li><span><input type="checkbox" data-task="${esc(t.id)}" aria-label="Fait"> <a href="#/deal/${esc(t.dealId)}">${esc(t.title)}</a> · ${esc(t.dealTitle)}</span><span class="muted">${esc(fmtDate(t.dueAt))}</span></li>`;
  const section = (title, items) => `<h2>${esc(title)} <span class="muted">${items.length}</span></h2><ul>${items.map(item).join('') || '<li class="muted">Rien.</li>'}</ul>`;
  view.innerHTML = `<div class="list"><h1>Tâches</h1>
    ${section('En retard', open.filter((t) => dayKey(t.dueAt) < today))}
    ${section("Aujourd'hui", open.filter((t) => dayKey(t.dueAt) === today))}
    ${section('À venir', open.filter((t) => dayKey(t.dueAt) > today))}
    <h2>Sans prochaine action <span class="muted">${idle.length}</span></h2>
    <ul>${idle.map((d) => `<li><a href="#/deal/${esc(d.id)}">${esc(d.title)}</a><span class="muted">${esc(d.stageLabel)}</span></li>`).join('') || '<li class="muted">Toutes les affaires ont une prochaine action.</li>'}</ul>
    <h2>Récapitulatif du matin</h2>
    <p class="muted">Chaque matin vers 7 h, cette liste part par email. Pour vérifier qu'il arrive :</p>
    <div id="msg"></div>
    <button class="btn btn--small" id="digest">M'envoyer le récapitulatif maintenant</button>
  </div>`;
  wireTaskChecks();
  $('#digest').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { digest } = await api('POST', '/api/digest');
      const said = {
        sent: ['Envoyé : regardez votre boîte (et les indésirables la première fois).', true],
        quiet: ["Rien en retard, rien aujourd'hui, aucune affaire sans prochaine action : pas d'email.", true],
      }[digest] ?? [digest.startsWith('not sent')
        ? "Pas d'email : la clé RESEND_API_KEY ou REMINDER_EMAIL manque (voir README.local.md)."
        : `L'envoi a échoué : ${digest.replace(/^failed: /, '')}`, false];
      $('#msg').innerHTML = flash(...said);
    } catch (err) { $('#msg').innerHTML = flash(err.message); }
    e.target.disabled = false;
  });
}

// ---- Nouveau ------------------------------------------------------------------------------------

function newDeal() {
  const offre = config.fields.find((f) => f.id === 'offre');
  view.innerHTML = `<form class="form panel" id="newForm"><h1>Nouvelle affaire</h1><div id="msg"></div>
    <div class="grid2">
      <label>Nom<input name="name" autocomplete="off"></label>
      <label>Téléphone<input name="phone" type="tel"></label>
      <label>Email<input name="email" type="email"></label>
      <label>Entreprise<input name="company"></label>
      <label>Métier<input name="trade"></label>
      <label>Ville<input name="town"></label>
      <label>Étape<select name="stage">${config.stages.filter((s) => !s.closed).map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select></label>
      ${offre ? fieldInput(offre) : ''}
    </div>
    <label>Note<textarea name="note" placeholder="Comment vous l'avez connu, son besoin…"></textarea></label>
    <div class="row">
      <label>Prochaine action<input name="nextTitle" value="Appeler"></label>
      <label>Quand<input type="datetime-local" name="nextDue" value="${tomorrowAt9()}"></label>
    </div>
    <div class="actions"><button class="btn btn--primary" type="submit">Créer</button></div>
  </form>`;
  $('#newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.name.value, phone: f.phone.value, email: f.email.value, company: f.company.value, trade: f.trade.value, town: f.town.value,
      stage: f.stage.value, note: f.note.value, fields: f.offre?.value ? { offre: f.offre.value } : {},
      nextAction: f.nextTitle.value && f.nextDue.value ? { title: f.nextTitle.value, dueAt: toIso(f.nextDue.value) } : null,
    };
    try {
      const { dealId } = await api('POST', '/api/deals', body);
      location.hash = `#/deal/${dealId}`;
    } catch (err) { $('#msg').innerHTML = flash(err.message); }
  });
}

// ---- Import -------------------------------------------------------------------------------------

/** French Excel saves "CSV (point-virgule)" in Windows-1252, not UTF-8: read either with its accents. */
function decode(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('windows-1252').decode(buffer); }
}

function importPage() {
  view.innerHTML = `<div class="form panel"><h1>Importer un fichier CSV</h1>
    <p class="muted">Export Excel, Google Sheets ou Brevo. Colonnes reconnues : nom, entreprise (ou société), téléphone, email, métier, ville, notes. Une personne déjà connue (même téléphone ou même email) est complétée, pas dupliquée.</p>
    <div id="msg"></div>
    <label>Fichier<input type="file" id="file" accept=".csv,text/csv"></label>
    <label>Ou collez le contenu<textarea id="csv" placeholder="nom;entreprise;téléphone"></textarea></label>
    <pre class="preview" id="preview" hidden></pre>
    <div class="actions"><button class="btn btn--primary" id="go">Importer</button></div>
  </div>`;
  const csv = $('#csv');
  const preview = () => { const lines = csv.value.split(/\r?\n/).filter(Boolean); $('#preview').hidden = !lines.length; $('#preview').textContent = `${lines.slice(0, 6).join('\n')}${lines.length > 6 ? `\n… ${lines.length - 6} lignes de plus` : ''}`; };
  csv.addEventListener('input', preview);
  $('#file').addEventListener('change', async (e) => { const file = e.target.files[0]; if (file) { csv.value = decode(await file.arrayBuffer()); preview(); } });
  $('#go').addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/import', { csv: csv.value });
      const skipped = r.skipped.map((s) => `ligne ${s.line} : ${s.error}`).join(' ; ');
      $('#msg').innerHTML = flash(`${r.created} créés, ${r.merged} complétés${r.skipped.length ? `, ${r.skipped.length} ignorés (${skipped})` : ''}.`, true);
    } catch (err) { $('#msg').innerHTML = flash(err.message); }
  });
}

// ---- Recherche ----------------------------------------------------------------------------------

async function search(q) {
  const { results } = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
  view.innerHTML = `<div class="list"><h1>Recherche : ${esc(q)}</h1><ul>${results.map((d) => `<li><a href="#/deal/${esc(d.id)}">${esc(d.title)}</a><span class="muted">${esc([d.contact_name, phoneFr(d.phone), d.town, stageLabel(d.stage)].filter(Boolean).join(' · '))}</span></li>`).join('') || '<li class="muted">Aucun résultat.</li>'}</ul></div>`;
}

// ---- Routes -------------------------------------------------------------------------------------

const routes = [
  [/^#?\/?$/, board],
  [/^#\/deal\/([\w-]+)$/, (m) => deal(m[1])],
  [/^#\/taches$/, tasks],
  [/^#\/nouveau$/, newDeal],
  [/^#\/import$/, importPage],
  [/^#\/recherche\?q=(.*)$/, (m) => search(decodeURIComponent(m[1]))],
];

async function refreshCount() {
  try {
    const { tasks: open } = await api('GET', '/api/tasks');
    const today = dayKey(new Date());
    const n = open.filter((t) => dayKey(t.dueAt) <= today).length;
    const badge = document.getElementById('taskCount');
    badge.hidden = !n;
    badge.textContent = String(n);
  } catch { /* the badge is a convenience */ }
}

async function render() {
  const hash = location.hash || '#/';
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('is-active', a.getAttribute('href') === hash);
  const route = routes.find(([re]) => re.test(hash));
  try {
    if (route) await route[1](hash.match(route[0]));
    else view.innerHTML = flash('Page introuvable.');
  } catch (e) {
    view.innerHTML = flash(e.message);
  }
  refreshCount();
}

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (q) location.hash = `#/recherche?q=${encodeURIComponent(q)}`;
});
window.addEventListener('hashchange', render);

try {
  config = await api('GET', '/api/config');
  document.getElementById('brand').textContent = `Pipeline · ${config.name}`;
  render();
} catch (e) {
  view.innerHTML = flash(`Impossible de charger : ${e.message}`);
}
