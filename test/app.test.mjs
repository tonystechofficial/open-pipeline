// The app's routes, on the real store and SQLite: closed without Cloudflare Access, and the API the
// pages use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApp } from '../src/server/app.mjs';
import { d1Store } from '../src/db/store.mjs';
import { d1Binding } from '../test-support/d1.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-26T09:00:00Z');
const assets = { html: '<!doctype html><title>Pipeline</title>', css: 'body{}', js: 'console.log(1)' };

function app({ access = true } = {}) {
  const deps = { store: d1Store(d1Binding(), config), config, now: () => NOW, assets, access: access ? { aud: 'x' } : undefined, log: () => {} };
  const call = async (method, path, body) => {
    const res = await handleApp(new Request(`https://pipeline.example${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), deps);
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { call, deps };
}

const JEAN = { name: 'Jean Martin', phone: '06 12 34 56 78', company: 'Plomberie Martin', trade: 'plombier', note: 'Vu au salon', fields: { appels_manques: '8', offre: 'receptionniste' }, nextAction: { title: 'Appeler Jean', dueAt: '2026-10-27T08:00:00Z' } };

test('without a Cloudflare Access identity, every page and every API call is refused', async () => {
  const { call } = app({ access: false });
  for (const path of ['/', '/app.js', '/api/board', '/api/config']) assert.equal((await call('GET', path)).status, 403, path);
  assert.equal((await call('POST', '/api/deals', JEAN)).status, 403);
});

test('the page is served with a strict content security policy', async () => {
  const { call } = app();
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/);
});

test('a deal created by hand: contact, typed fields, first note and next action, then on the board', async () => {
  const { call } = app();
  const created = await call('POST', '/api/deals', JEAN);
  assert.equal(created.status, 201);
  const { body } = await call('GET', `/api/deals/${created.body.dealId}`);
  assert.equal(body.deal.title, 'Plomberie Martin');
  assert.equal(body.deal.stage, 'nouveau');
  assert.equal(body.deal.temperature, 'froid');
  assert.deepEqual(body.deal.fields, { metier: 'plombier', appels_manques: 8, offre: 'receptionniste' }); // the trade fills Métier, as with the other intakes
  assert.equal(body.contact.phone, '+33612345678');
  assert.equal(body.activities[0].body, 'Vu au salon');
  assert.equal(body.tasks[0].title, 'Appeler Jean');
  const board = await call('GET', '/api/board');
  assert.equal(board.body.deals.length, 1);
  assert.equal(board.body.deals[0].next_title, 'Appeler Jean');
});

test('what the API refuses: nobody to follow, an unknown stage or field, a number that is not one', async () => {
  const { call } = app();
  assert.equal((await call('POST', '/api/deals', { note: 'rien' })).status, 400);
  assert.equal((await call('POST', '/api/deals', { ...JEAN, stage: 'inconnue' })).status, 400);
  assert.match((await call('POST', '/api/deals', { ...JEAN, fields: { couleur: 'bleu' } })).body.error, /Champ inconnu/);
  assert.match((await call('POST', '/api/deals', { ...JEAN, fields: { appels_manques: 'beaucoup' } })).body.error, /nombre/);
});

test('losing a deal needs a reason, and can set a date to get back in touch', async () => {
  const { call } = app();
  const { body: { dealId } } = await call('POST', '/api/deals', JEAN);
  assert.equal((await call('PATCH', `/api/deals/${dealId}`, { stage: 'perdu' })).status, 400);
  const lost = await call('PATCH', `/api/deals/${dealId}`, { stage: 'perdu', lostReason: 'Plus tard', recontactAt: '2027-03-01T08:00:00Z' });
  assert.equal(lost.status, 200);
  assert.equal(lost.body.deal.temperature, 'perdu');
  const tasks = (await call('GET', '/api/tasks')).body.tasks;
  assert.deepEqual(tasks.map((t) => t.title), ['Recontacter : Plomberie Martin']); // "Appeler Jean" was completed by the close
});

test('notes, tasks and contacts: added, completed, corrected', async () => {
  const { call } = app();
  const { body: { dealId, contactId } } = await call('POST', '/api/deals', JEAN);
  assert.equal((await call('POST', `/api/deals/${dealId}/activities`, { kind: 'call', body: 'Il rappelle lundi' })).status, 201);
  assert.equal((await call('POST', `/api/deals/${dealId}/activities`, { kind: 'fax', body: 'x' })).status, 400);
  assert.equal((await call('POST', `/api/deals/${dealId}/tasks`, { title: 'Devis', dueAt: 'demain' })).status, 400);
  const { body: { task } } = await call('POST', `/api/deals/${dealId}/tasks`, { title: 'Envoyer le devis', dueAt: '2026-10-28' });
  assert.equal((await call('PATCH', `/api/tasks/${task.id}`, { done: true })).body.task.done_at, NOW.toISOString());
  assert.equal((await call('PATCH', `/api/contacts/${contactId}`, { phone: '12' })).status, 400);
  assert.equal((await call('PATCH', `/api/contacts/${contactId}`, { email: 'Jean@Martin.fr' })).body.contact.email, 'jean@martin.fr');
});

test('the morning email on demand, to check it arrives: sent with what needs doing, or why it was not', async () => {
  const { call, deps } = app();
  assert.equal((await call('POST', '/api/digest')).body.digest, 'quiet');
  await call('POST', '/api/deals', { name: 'Sophie', phone: '06 98 76 54 32' }); // no next action
  assert.match((await call('POST', '/api/digest')).body.digest, /^not sent/);
  const sent = [];
  Object.assign(deps, { sendEmail: async (m) => sent.push(m), to: 'tony@example.com', appUrl: 'https://p.example' });
  assert.equal((await call('POST', '/api/digest')).body.digest, 'sent');
  assert.equal(sent[0].to, 'tony@example.com');
  assert.match(sent[0].subject, /1 sans prochaine action/);
  assert.equal((await app({ access: false }).call('POST', '/api/digest')).status, 403);
});

test('a CSV import: rows created, the same person merged, an empty row reported with its line', async () => {
  const { call } = app();
  const csv = 'Nom;Téléphone;Ville\nJean Martin;06 12 34 56 78;Mérignac\n;;Pessac\nJ. Martin;0612345678;Mérignac\nSophie;0698765432;Pessac\n';
  const { status, body } = await call('POST', '/api/import', { csv });
  assert.equal(status, 200);
  assert.deepEqual(body, { created: 2, merged: 1, skipped: [{ line: 3, error: 'Ligne ignorée : ni nom, ni téléphone, ni email.' }] });
  assert.equal((await call('GET', '/api/search?q=Pessac')).body.results.length, 1);
});
