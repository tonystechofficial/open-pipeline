// The morning run: the reminder email, then the retention purge, which a failed email never stops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDaily, resendSender } from '../src/server/daily.mjs';
import { d1Store } from '../src/db/store.mjs';
import { d1Binding } from '../test-support/d1.mjs';
import { fromReceptionistCall } from '../src/core/intake.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-27T05:00:00Z'); // mardi, 6 h à Paris

async function storeWithACallBack() {
  const store = d1Store(d1Binding(), config);
  const { intake } = fromReceptionistCall({ callId: 'c1', endedAt: '2026-10-26T15:00:00Z', status: 'a_rappeler', caller: { nom: 'Sophie', telephone: '0698765432' } }, config);
  await store.applyIntake(intake, { now: new Date('2026-10-26T15:00:00Z') });
  return store;
}

test('a follow-up overdue since yesterday: the email goes to the owner with it', async () => {
  const sent = [];
  const outcome = await runDaily({ store: await storeWithACallBack(), config, now: NOW, sendEmail: async (m) => sent.push(m), to: 'tony@example.com', appUrl: 'https://p.example' });
  assert.equal(outcome.digest, 'sent');
  assert.equal(sent[0].to, 'tony@example.com');
  assert.match(sent[0].subject, /1 en retard/);
  assert.match(sent[0].text, /Rappeler Sophie/);
});

test('a quiet morning sends nothing; a failed email is reported and the purge still runs', async () => {
  const quiet = await runDaily({ store: d1Store(d1Binding(), config), config, now: NOW, sendEmail: async () => assert.fail('nothing to send'), to: 'x@y.fr', appUrl: 'https://p.example' });
  assert.deepEqual(quiet, { digest: 'quiet', purged: 0 });
  const failed = await runDaily({ store: await storeWithACallBack(), config, now: NOW, sendEmail: async () => { throw new Error('Resend 403'); }, to: 'x@y.fr', appUrl: 'https://p.example', log: () => {} });
  assert.equal(failed.digest, 'failed: Resend 403');
  assert.equal(failed.purged, 0);
});

test("Resend gets the sender, the recipient and the text; a refusal throws with Resend's answer", async () => {
  let request;
  const send = resendSender({ apiKey: 're_test', from: 'Pipeline <onboarding@resend.dev>' }, async (url, init) => { request = { url, init }; return new Response('{}'); });
  await send({ to: 'tony@example.com', subject: 'S', text: 'T' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.init.headers.authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(request.init.body), { from: 'Pipeline <onboarding@resend.dev>', to: ['tony@example.com'], subject: 'S', text: 'T' });
  const refused = resendSender({ apiKey: 'k', from: 'f' }, async () => new Response('domain not verified', { status: 403 }));
  await assert.rejects(refused({ to: 'a', subject: 'b', text: 'c' }), /Resend 403: domain not verified/);
});
