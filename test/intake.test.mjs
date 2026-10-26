// What each source brings into the pipeline: a Cal.com booking, a receptionist call, the website form,
// a CSV row. Each becomes one intake: who, their business, the stage it implies, what happened, and
// the next action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromCalBooking, fromReceptionistCall, fromForm, fromCsvRow } from '../src/core/intake.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));

const BOOKING = {
  triggerEvent: 'BOOKING_CREATED',
  createdAt: '2026-10-26T09:00:00.000Z',
  payload: {
    uid: 'bk_1',
    title: 'Appel découverte entre Tony et Jean Martin',
    startTime: '2026-10-28T08:00:00Z',
    endTime: '2026-10-28T08:20:00Z',
    type: 'appel-decouverte',
    attendees: [{ name: 'Jean Martin', email: 'Jean@Martin.FR', timeZone: 'Europe/Paris' }],
    responses: {
      name: { value: 'Jean Martin' },
      email: { value: 'Jean@Martin.FR' },
      attendeePhoneNumber: { value: '06 12 34 56 78' },
      metier: { label: 'Votre métier ?', value: 'Plombier' },
      'appels-manques': { label: "Combien d'appels manquez-vous par semaine ?", value: '8' },
      notes: { value: 'Je rate des appels sur les chantiers' },
    },
  },
};

test('a Cal.com booking: the contact, their answers as fields, RDV pris, and the call as next action', () => {
  const { intake } = fromCalBooking(BOOKING, config);
  assert.equal(intake.source, 'calcom');
  assert.equal(intake.sourceRef, 'BOOKING_CREATED:bk_1');
  assert.deepEqual(intake.contact, { name: 'Jean Martin', phone: '+33612345678', email: 'jean@martin.fr', company: null, trade: 'Plombier', town: null });
  assert.deepEqual(intake.fields, { metier: 'Plombier', appels_manques: 8 });
  assert.equal(intake.stage, 'rdv_pris');
  assert.equal(intake.activity.kind, 'booking');
  assert.match(intake.activity.body, /mercredi 28 octobre à 9 h/); // 8 h UTC is 9 h in Paris after the clock change
  assert.match(intake.activity.body, /Je rate des appels sur les chantiers/);
  assert.deepEqual(intake.task, { title: 'RDV avec Jean Martin', dueAt: '2026-10-28T08:00:00Z' });
});

test('a rescheduled booking moves the next action; a cancelled one asks for a follow-up, stage unchanged', () => {
  const moved = fromCalBooking({ ...BOOKING, triggerEvent: 'BOOKING_RESCHEDULED', payload: { ...BOOKING.payload, uid: 'bk_2', startTime: '2026-10-29T13:00:00Z' } }, config).intake;
  assert.match(moved.activity.body, /RDV déplacé au jeudi 29 octobre à 14 h/);
  assert.deepEqual(moved.task, { title: 'RDV avec Jean Martin', dueAt: '2026-10-29T13:00:00Z' });

  const cancelled = fromCalBooking({ ...BOOKING, triggerEvent: 'BOOKING_CANCELLED' }, config).intake;
  assert.equal(cancelled.sourceRef, 'BOOKING_CANCELLED:bk_1');
  assert.equal(cancelled.stage, null);
  assert.match(cancelled.activity.body, /RDV annulé/);
  assert.deepEqual(cancelled.task, { title: 'Relancer Jean Martin (RDV annulé)', dueAt: '2026-10-26T09:00:00.000Z' });
});

test('other Cal.com events are ignored', () => {
  assert.deepEqual(fromCalBooking({ triggerEvent: 'MEETING_ENDED', payload: {} }, config), { ignored: true });
});

const CALL = {
  callId: 'call_1',
  endedAt: '2026-10-26T10:00:00Z',
  caller: { nom: 'Sophie Durand', telephone: '+33698765432', email: null, besoin: 'Un site pour son salon', urgence: 'normale', ville: 'Pessac' },
  status: 'a_rappeler',
  appointment: null,
  summary: 'Souhaite un devis.',
};

test('a receptionist call to call back: Nouveau, the need and the summary, and a call-back as next action', () => {
  const { intake } = fromReceptionistCall(CALL, config);
  assert.equal(intake.source, 'receptionniste');
  assert.equal(intake.sourceRef, 'receptionniste:call_1');
  assert.deepEqual(intake.contact, { name: 'Sophie Durand', phone: '+33698765432', email: null, company: null, trade: null, town: 'Pessac' });
  assert.equal(intake.stage, 'nouveau');
  assert.equal(intake.activity.kind, 'call');
  assert.match(intake.activity.body, /Un site pour son salon/);
  assert.match(intake.activity.body, /Souhaite un devis\./);
  assert.deepEqual(intake.task, { title: 'Rappeler Sophie Durand', dueAt: '2026-10-26T10:00:00Z' });
});

test('a receptionist call that booked: RDV pris, and the appointment as next action', () => {
  const booked = { ...CALL, status: 'rdv', appointment: { at: '2026-10-29T13:00:00Z', label: 'jeudi 29 octobre à 14 h' } };
  const { intake } = fromReceptionistCall(booked, config);
  assert.equal(intake.stage, 'rdv_pris');
  assert.deepEqual(intake.task, { title: 'RDV avec Sophie Durand', dueAt: '2026-10-29T13:00:00Z' });
});

test('an urgent call says so; a caller with no name is called by their number; nobody to call back is ignored', () => {
  const urgent = fromReceptionistCall({ ...CALL, caller: { ...CALL.caller, urgence: 'immediate' } }, config).intake;
  assert.equal(urgent.task.title, 'URGENT : Rappeler Sophie Durand');
  const anonymous = fromReceptionistCall({ ...CALL, caller: { ...CALL.caller, nom: null } }, config).intake;
  assert.equal(anonymous.task.title, 'Rappeler 06 98 76 54 32');
  assert.deepEqual(fromReceptionistCall({ ...CALL, caller: { besoin: 'Un renseignement' } }, config), { ignored: true });
});

test('the website form: a name and a way to answer are required, the message is kept', () => {
  const at = '2026-10-26T11:00:00Z';
  const { intake } = fromForm({ name: ' Paul ', email: 'Paul@Garage.fr', phone: '', company: 'Garage Paul', trade: 'garage', message: 'Bonjour, je rate des appels.' }, config, { at });
  assert.deepEqual(intake.contact, { name: 'Paul', phone: null, email: 'paul@garage.fr', company: 'Garage Paul', trade: 'garage', town: null });
  assert.deepEqual(intake.fields, { metier: 'garage' });
  assert.equal(intake.stage, 'nouveau');
  assert.deepEqual(intake.activity, { kind: 'form', body: 'Bonjour, je rate des appels.' });
  assert.deepEqual(intake.task, { title: 'Répondre à Paul', dueAt: at });
  assert.match(fromForm({ email: 'a@b.fr' }, config, { at }).error, /nom/);
  assert.match(fromForm({ name: 'Paul' }, config, { at }).error, /téléphone ou un email/);
  assert.equal(fromForm({ name: 'Paul', phone: '0612345678', message: 'x'.repeat(5000) }, config, { at }).intake.activity.body.length, 2000);
});

test('a CSV row, whatever the headers are called: contact, business and trade, no next action', () => {
  const headers = ['Nom', 'Société', 'Téléphone', 'E-mail', 'Métier', 'Ville', 'Notes'];
  const { intake } = fromCsvRow(headers, ['Jean Martin', 'Plomberie Martin', '06 12 34 56 78', 'JEAN@MARTIN.FR', 'plombier', 'Mérignac', 'Vu au salon'], config, { at: '2026-10-26T12:00:00Z' });
  assert.equal(intake.source, 'import');
  assert.deepEqual(intake.contact, { name: 'Jean Martin', phone: '+33612345678', email: 'jean@martin.fr', company: 'Plomberie Martin', trade: 'plombier', town: 'Mérignac' });
  assert.deepEqual(intake.fields, { metier: 'plombier' });
  assert.deepEqual(intake.activity, { kind: 'import', body: 'Vu au salon' });
  assert.equal(intake.task, null);
  assert.match(fromCsvRow(['Nom', 'Ville'], ['', 'Pessac'], config, { at: '2026-10-26T12:00:00Z' }).error, /ni nom/);
});
