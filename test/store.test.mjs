// The D1 store on real SQLite (node:sqlite), through a wrapper shaped like a D1 binding: the real
// migration and the real SQL, as D1 runs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1Binding } from '../test-support/d1.mjs';
import { d1Store } from '../src/db/store.mjs';
import { fromCalBooking, fromReceptionistCall } from '../src/core/intake.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));

const NOW = new Date('2026-10-26T09:00:00Z');
const BOOKING = {
  triggerEvent: 'BOOKING_CREATED',
  createdAt: '2026-10-26T09:00:00.000Z',
  payload: {
    uid: 'bk_1', startTime: '2026-10-28T08:00:00Z',
    attendees: [{ name: 'Jean Martin', email: 'jean@martin.fr' }],
    responses: { name: { value: 'Jean Martin' }, email: { value: 'jean@martin.fr' }, attendeePhoneNumber: { value: '+33612345678' }, metier: { value: 'Plombier' } },
  },
};
const booking = () => fromCalBooking(BOOKING, config).intake;
const call = (extra = {}) => fromReceptionistCall({
  callId: 'call_1', endedAt: '2026-10-26T10:00:00Z', status: 'a_rappeler', summary: 'Rappelle pour un devis.',
  caller: { nom: 'Jean M.', telephone: '06 12 34 56 78', besoin: 'Un devis', urgence: 'normale', ville: 'Mérignac' }, ...extra,
}, config).intake;

test('a booking writes the contact, a deal at RDV pris, the timeline and the next action; a redelivery nothing', async () => {
  const store = d1Store(d1Binding(), config);
  const first = await store.applyIntake(booking(), { now: NOW });
  assert.equal(first.createdContact, true);
  assert.equal(first.createdDeal, true);
  const { deal, contact, tasks, activities } = await store.deal(first.dealId);
  assert.equal(deal.stage, 'rdv_pris');
  assert.deepEqual(deal.fields, { metier: 'Plombier' });
  assert.equal(contact.phone, '+33612345678');
  assert.deepEqual(tasks.map((t) => [t.title, t.due_at]), [['RDV avec Jean Martin', '2026-10-28T08:00:00Z']]);
  assert.equal(activities.length, 1);
  assert.deepEqual(await store.applyIntake(booking(), { now: NOW }), { duplicate: true });
  assert.equal((await store.deal(first.dealId)).activities.length, 1);
});

test('the same person calling later is found by phone: same deal, stage kept, details completed', async () => {
  const store = d1Store(d1Binding(), config);
  const { dealId, contactId } = await store.applyIntake(booking(), { now: NOW });
  const again = await store.applyIntake(call(), { now: NOW });
  assert.equal(again.contactId, contactId);
  assert.equal(again.dealId, dealId);
  const view = await store.deal(dealId);
  assert.equal(view.deal.stage, 'rdv_pris');
  assert.equal(view.contact.name, 'Jean Martin'); // the name written first is kept
  assert.equal(view.contact.town, 'Mérignac');
  assert.equal(view.activities.length, 2);
  assert.equal(view.tasks.length, 2);
});

test('found by email when there is no phone', async () => {
  const store = d1Store(d1Binding(), config);
  const { contactId } = await store.applyIntake(booking(), { now: NOW });
  const form = { ...booking(), sourceRef: null, contact: { ...booking().contact, phone: null } };
  assert.equal((await store.applyIntake(form, { now: NOW })).contactId, contactId);
});

test('moving a deal logs the stage change; losing it closes it with the reason; the next intake opens a new deal', async () => {
  const store = d1Store(d1Binding(), config);
  const { dealId } = await store.applyIntake(booking(), { now: NOW });
  await store.updateDeal(dealId, { stage: 'qualifie', fields: { decideur: 'Le gérant', metier: '' } }, { now: NOW });
  let view = await store.deal(dealId);
  assert.deepEqual(view.deal.fields, { decideur: 'Le gérant' }); // an emptied field is removed
  assert.equal(view.activities[0].body, 'Étape : RDV pris → Qualifié');
  await store.updateDeal(dealId, { stage: 'perdu', lostReason: 'Pas de budget' }, { now: NOW });
  view = await store.deal(dealId);
  assert.equal(view.deal.closed_at, NOW.toISOString());
  assert.equal(view.deal.lost_reason, 'Pas de budget');
  assert.equal(view.activities[0].body, 'Étape : Qualifié → Perdu / Plus tard (Pas de budget)');
  const later = await store.applyIntake(call(), { now: NOW });
  assert.notEqual(later.dealId, dealId);
  assert.equal(later.createdDeal, true);
});

test('the board shows each deal with its next open task; tasks and idle deals feed the morning email', async () => {
  const store = d1Store(d1Binding(), config);
  const { dealId } = await store.applyIntake(booking(), { now: NOW });
  const [card] = await store.board({ now: NOW });
  assert.equal(card.id, dealId);
  assert.equal(card.next_title, 'RDV avec Jean Martin');
  const [task] = await store.openTasks();
  assert.equal(task.dealTitle, 'Jean Martin');
  assert.deepEqual(await store.idleDeals(), []);
  await store.updateTask(task.id, { done: true }, { now: NOW });
  assert.deepEqual((await store.idleDeals()).map((d) => [d.id, d.stageLabel]), [[dealId, 'RDV pris']]);
  assert.equal((await store.board({ now: NOW }))[0].next_title, null);
});

test('search finds a deal by company, name, phone fragment or town', async () => {
  const store = d1Store(d1Binding(), config);
  await store.applyIntake(call(), { now: NOW });
  for (const q of ['Jean', '612345', 'Mérignac']) assert.equal((await store.search(q)).length, 1, q);
  assert.deepEqual(await store.search('  '), []);
});

test('the retention purge deletes old prospects that went nowhere, never clients or recent ones', async () => {
  const store = d1Store(d1Binding(), config);
  const old = await store.applyIntake({ ...call(), sourceRef: 'old', at: '2023-01-01T00:00:00Z' }, { now: new Date('2023-01-01T00:00:00Z') });
  await store.updateDeal(old.dealId, { stage: 'perdu', lostReason: 'Pas intéressé' }, { now: new Date('2023-01-02T00:00:00Z') });
  const client = await store.applyIntake({ ...booking(), sourceRef: 'client', at: '2023-01-01T00:00:00Z', contact: { ...booking().contact, phone: '+33600000001', email: 'c@client.fr' } }, { now: new Date('2023-01-01T00:00:00Z') });
  await store.updateDeal(client.dealId, { stage: 'en_service' }, { now: new Date('2023-01-02T00:00:00Z') });
  const recent = await store.applyIntake({ ...booking(), sourceRef: 'recent', contact: { ...booking().contact, phone: '+33600000002', email: 'r@recent.fr' } }, { now: NOW });

  assert.equal(await store.purge('2024-01-01T00:00:00Z'), 1);
  assert.equal(await store.deal(old.dealId), null);
  assert.ok(await store.deal(client.dealId));
  assert.ok(await store.deal(recent.dealId));
});

test('an older event written later never makes a contact look older to the retention purge', async () => {
  const store = d1Store(d1Binding(), config);
  const { dealId } = await store.applyIntake(booking(), { now: NOW });
  await store.applyIntake({ ...call(), sourceRef: 'archive', at: '2023-01-01T00:00:00Z' }, { now: NOW });
  assert.equal((await store.deal(dealId)).contact.last_activity_at, '2026-10-26T09:00:00.000Z');
});
