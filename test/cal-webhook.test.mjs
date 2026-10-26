// The Cal.com webhook `npm run cal:webhook` creates, or updates when one already points at the intake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webhookPlan } from '../src/setup/cal-webhook.mjs';

const URL = 'https://open-pipeline-intake.tony.workers.dev/intake/calcom';

test('no webhook to the intake yet: one is created, signed, in the payload version the intake reads', () => {
  const plan = webhookPlan({ webhooks: [{ id: 7, subscriberUrl: 'https://other.example/hook' }], subscriberUrl: URL, secret: 's3cret' });
  assert.deepEqual(plan, {
    method: 'POST',
    path: '/webhooks',
    body: { active: true, subscriberUrl: URL, triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'], secret: 's3cret', version: '2021-10-20' },
  });
});

test('a webhook already pointing at the intake is updated with the new secret and turned on, not duplicated', () => {
  const plan = webhookPlan({ webhooks: [{ id: 42, subscriberUrl: URL, active: false, version: '2026-07-27' }], subscriberUrl: URL, secret: 'new' });
  assert.equal(plan.method, 'PATCH');
  assert.equal(plan.path, '/webhooks/42');
  assert.equal(plan.body.secret, 'new');
  assert.equal(plan.body.active, true);
  assert.equal(plan.body.version, '2021-10-20');
  assert.equal(plan.body.subscriberUrl, undefined);
});
