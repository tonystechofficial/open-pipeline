// Where an intake lands: the same person is found again and their open deal grows, or a new deal opens.
// Nothing written by hand is overwritten, and a deal never goes back a stage on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planIntake } from '../src/core/merge.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));
const INTAKE = {
  source: 'calcom',
  sourceRef: 'BOOKING_CREATED:bk_1',
  at: '2026-10-26T09:00:00Z',
  contact: { name: 'Jean Martin', phone: '+33612345678', email: 'jean@martin.fr', company: null, trade: 'Plombier', town: null },
  fields: { metier: 'Plombier', appels_manques: 8 },
  stage: 'rdv_pris',
  activity: { kind: 'booking', body: 'RDV le mercredi 28 octobre à 9 h' },
  task: { title: 'RDV avec Jean Martin', dueAt: '2026-10-28T08:00:00Z' },
};

test('a new person: a contact and a deal at the stage the source implies', () => {
  const plan = planIntake({ intake: INTAKE, contact: null, deals: [], config });
  assert.deepEqual(plan.contact, { id: null, set: INTAKE.contact });
  assert.deepEqual(plan.deal, { id: null, set: { title: 'Jean Martin', stage: 'rdv_pris', source: 'calcom' }, fields: INTAKE.fields });
  assert.deepEqual(plan.activity, INTAKE.activity);
  assert.deepEqual(plan.task, INTAKE.task);
});

test('a known person: only what is missing is filled in, on the contact and in the fields', () => {
  const contact = { id: 'c1', name: 'Jean', phone: null, email: 'jean@martin.fr', company: 'Plomberie Martin', trade: null, town: 'Mérignac' };
  const deals = [{ id: 'd1', stage: 'nouveau', fields: { metier: 'Plomberie' } }];
  const plan = planIntake({ intake: INTAKE, contact, deals, config });
  assert.deepEqual(plan.contact, { id: 'c1', set: { phone: '+33612345678', trade: 'Plombier' } });
  assert.deepEqual(plan.deal, { id: 'd1', set: { stage: 'rdv_pris' }, fields: { appels_manques: 8 } });
});

test('a deal further along keeps its stage', () => {
  const plan = planIntake({ intake: INTAKE, contact: { id: 'c1', ...INTAKE.contact }, deals: [{ id: 'd1', stage: 'proposition', fields: {} }], config });
  assert.deepEqual(plan.deal.set, {});
});

test('a person whose deals are all closed starts a new deal', () => {
  const plan = planIntake({ intake: INTAKE, contact: { id: 'c1', ...INTAKE.contact }, deals: [{ id: 'd0', stage: 'perdu', fields: {} }], config });
  assert.equal(plan.deal.id, null);
  assert.equal(plan.deal.set.stage, 'rdv_pris');
});

test('an intake without a stage (a cancellation) opens a deal at the source stage only if none is open', () => {
  const cancel = { ...INTAKE, stage: null, sourceRef: 'BOOKING_CANCELLED:bk_1' };
  assert.deepEqual(planIntake({ intake: cancel, contact: { id: 'c1', ...INTAKE.contact }, deals: [{ id: 'd1', stage: 'rdv_pris', fields: {} }], config }).deal.set, {});
  assert.equal(planIntake({ intake: cancel, contact: null, deals: [], config }).deal.set.stage, 'rdv_pris');
});

test('the deal is named after the business when there is one', () => {
  const plan = planIntake({ intake: { ...INTAKE, contact: { ...INTAKE.contact, company: 'Plomberie Martin' } }, contact: null, deals: [], config });
  assert.equal(plan.deal.set.title, 'Plomberie Martin');
});
