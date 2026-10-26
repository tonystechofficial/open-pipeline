// The Cal.com webhook `npm run cal:webhook` creates, or updates when one already points at the
// intake, so a rerun rotates the secret instead of adding a second webhook. Pure; the script calls
// Cal.com's API v2 (https://cal.com/docs/api-reference/v2/webhooks).

const TRIGGERS = ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'];
// The payload shape src/core/intake.mjs reads ({ triggerEvent, payload: { uid, startTime, ... } }).
const VERSION = '2021-10-20';

export function webhookPlan({ webhooks, subscriberUrl, secret }) {
  const existing = (webhooks ?? []).find((w) => w.subscriberUrl === subscriberUrl);
  const body = { active: true, triggers: TRIGGERS, secret, version: VERSION };
  return existing
    ? { method: 'PATCH', path: `/webhooks/${existing.id}`, body }
    : { method: 'POST', path: '/webhooks', body: { active: true, subscriberUrl, triggers: TRIGGERS, secret, version: VERSION } };
}
