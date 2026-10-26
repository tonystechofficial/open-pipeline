// The app Worker's morning run: the reminder email, then the retention purge. A failed email never
// stops the purge.
import { buildDigest } from '../core/digest.mjs';

export async function runDaily({ store, config, now = new Date(), sendEmail, to, appUrl, log = console.error }) {
  const outcome = { digest: 'quiet', purged: 0 };
  const digest = buildDigest({ now, timeZone: config.timeZone, appUrl, tasks: await store.openTasks(), idleDeals: await store.idleDeals() });
  if (digest) {
    if (!sendEmail || !to) outcome.digest = 'not sent: no email key or recipient';
    else {
      try {
        await sendEmail({ to, subject: digest.subject, text: digest.text });
        outcome.digest = 'sent';
      } catch (error) {
        outcome.digest = `failed: ${error.message}`;
        log('[open-pipeline] morning email failed', error);
      }
    }
  }
  const days = Number(config.retentionDays) || 1095;
  outcome.purged = await store.purge(new Date(now.getTime() - days * 86_400_000).toISOString());
  return outcome;
}

/** Resend's API. https://resend.com/docs/api-reference/emails/send-email */
export function resendSender({ apiKey, from }, fetchImpl = fetch) {
  return async ({ to, subject, text }) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}
