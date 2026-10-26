// The public intake Worker: each endpoint checks its own proof before touching anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { handleIntake, verifyTurnstile } from '../src/server/intake-http.mjs';
import { d1Store } from '../src/db/store.mjs';
import { d1Binding } from '../test-support/d1.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-26T09:00:00Z');
const SITE = 'https://tonys-tech-ia.vercel.app';

function intake({ secrets = { calcom: 'cal-secret', receptionist: 'rec-secret', turnstile: 'ts-secret' }, human = true } = {}) {
  const store = d1Store(d1Binding(), config);
  const deps = { store, config, now: () => NOW, secrets, formOrigins: [SITE], verifyTurnstile: async () => human, log: () => {} };
  const send = (method, path, body, headers = {}) => handleIntake(new Request(`https://intake.example${path}`, { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }), deps);
  return { send, store };
}

const BOOKING = JSON.stringify({
  triggerEvent: 'BOOKING_CREATED', createdAt: '2026-10-26T09:00:00Z',
  payload: { uid: 'bk_1', startTime: '2026-10-28T08:00:00Z', attendees: [{ name: 'Jean Martin', email: 'jean@martin.fr' }], responses: {} },
});
const signed = (body, secret = 'cal-secret') => ({ 'x-cal-signature-256': createHmac('sha256', secret).update(body).digest('hex') });

test('Cal.com: a signed booking lands in the pipeline once; a bad signature or a missing secret changes nothing', async () => {
  const { send, store } = intake();
  assert.equal((await send('POST', '/intake/calcom', BOOKING, signed(BOOKING, 'wrong'))).status, 401);
  assert.equal((await send('POST', '/intake/calcom', BOOKING)).status, 401);
  assert.equal((await store.board({ now: NOW })).length, 0);
  const ok = await send('POST', '/intake/calcom', BOOKING, signed(BOOKING));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).createdDeal, true);
  assert.deepEqual(await (await send('POST', '/intake/calcom', BOOKING, signed(BOOKING))).json(), { duplicate: true });
  const unset = intake({ secrets: {} });
  assert.equal((await unset.send('POST', '/intake/calcom', BOOKING, signed(BOOKING))).status, 503);
});

test('Cal.com: events other than bookings are acknowledged and ignored', async () => {
  const { send } = intake();
  const ended = JSON.stringify({ triggerEvent: 'MEETING_ENDED' });
  assert.deepEqual(await (await send('POST', '/intake/calcom', ended, signed(ended))).json(), { ignored: true });
});

test('the receptionist: its shared secret, or nothing', async () => {
  const { send, store } = intake();
  const call = { callId: 'call_1', endedAt: '2026-10-26T10:00:00Z', status: 'a_rappeler', caller: { nom: 'Sophie', telephone: '0698765432' } };
  assert.equal((await send('POST', '/intake/receptionist', call, { 'x-pipeline-secret': 'nope' })).status, 401);
  assert.equal((await send('POST', '/intake/receptionist', call, { 'x-pipeline-secret': 'rec-secret' })).status, 200);
  assert.equal((await store.openTasks())[0].title, 'Rappeler Sophie');
});

test('the website form: only from the site, only for humans, and the honeypot writes nothing', async () => {
  const { send, store } = intake();
  const preflight = await send('OPTIONS', '/intake/form', undefined, { origin: SITE });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);
  assert.equal((await send('OPTIONS', '/intake/form', undefined, { origin: 'https://evil.example' })).status, 403);

  const message = { name: 'Paul', email: 'paul@garage.fr', message: 'Bonjour', turnstileToken: 't' };
  assert.equal((await send('POST', '/intake/form', message, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await intake({ human: false }).send('POST', '/intake/form', message, { origin: SITE })).status, 403);
  assert.equal((await send('POST', '/intake/form', { ...message, website: 'http://spam' }, { origin: SITE })).status, 200);
  assert.equal((await store.board({ now: NOW })).length, 0);
  assert.match(await (await send('POST', '/intake/form', { ...message, name: '' }, { origin: SITE })).text(), /nom/);

  const ok = await send('POST', '/intake/form', message, { origin: SITE });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.equal((await store.openTasks())[0].title, 'Répondre à Paul');
});

test("Turnstile's check sends the secret and the token, and trusts only success: true", async () => {
  let sent;
  const fake = async (url, init) => { sent = { url, body: String(init.body) }; return new Response(JSON.stringify({ success: true })); };
  assert.equal(await verifyTurnstile('ts', 'tok', '1.2.3.4', fake), true);
  assert.match(sent.url, /turnstile\/v0\/siteverify/);
  assert.match(sent.body, /secret=ts&response=tok&remoteip=1\.2\.3\.4/);
  assert.equal(await verifyTurnstile('ts', 'tok', null, async () => new Response('{"success":false}')), false);
  assert.equal(await verifyTurnstile('', 'tok', null, fake), false);
});

test('health answers', async () => {
  assert.equal((await intake().send('GET', '/health')).status, 200);
});
