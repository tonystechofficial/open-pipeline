// The morning email: follow-ups overdue and due today, and open deals left without a next action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../src/core/digest.mjs';

const NOW = new Date('2026-10-26T06:00:00Z'); // lundi, 7 h à Paris
const base = { now: NOW, timeZone: 'Europe/Paris', appUrl: 'https://pipeline.example' };
const TASKS = [
  { id: 't1', title: 'Rappeler Sophie Durand', dueAt: '2026-10-23T09:00:00Z', dealId: 'd1', dealTitle: 'Salon Sophie' },
  { id: 't2', title: 'RDV avec Jean Martin', dueAt: '2026-10-26T08:00:00Z', dealId: 'd2', dealTitle: 'Plomberie Martin' },
  { id: 't3', title: 'Envoyer le devis', dueAt: '2026-10-27T08:00:00Z', dealId: 'd3', dealTitle: 'Garage Paul' },
];
const IDLE = [{ id: 'd4', title: 'Élec Bernard', stageLabel: 'Contacté' }];

test('overdue, today and deals without a next action, each with a link; later tasks wait', () => {
  const { subject, text } = buildDigest({ ...base, tasks: TASKS, idleDeals: IDLE });
  assert.equal(subject, "Pipeline : 1 à faire aujourd'hui, 1 en retard, 1 sans prochaine action");
  assert.match(text, /En retard[\s\S]*Rappeler Sophie Durand · Salon Sophie · vendredi 23 octobre à 11 h\n  https:\/\/pipeline\.example\/#\/deal\/d1/);
  assert.match(text, /Aujourd'hui[\s\S]*RDV avec Jean Martin · Plomberie Martin · à 9 h/);
  assert.match(text, /Sans prochaine action[\s\S]*Élec Bernard \(Contacté\)\n  https:\/\/pipeline\.example\/#\/deal\/d4/);
  assert.doesNotMatch(text, /Envoyer le devis/);
});

test('a quiet morning sends nothing', () => {
  assert.equal(buildDigest({ ...base, tasks: [TASKS[2]], idleDeals: [] }), null);
});
