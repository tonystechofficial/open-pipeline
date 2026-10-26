// The app Worker's morning run: the reminder email, then the retention purge. A failed email never
// stops the purge. The email alone is also sent on demand, from the tasks page.
import { buildDigest } from '../core/digest.mjs';

/** 'sent', 'quiet' (nothing to say), 'not sent: …' or 'failed: …'. */
export async function sendDigest({ store, config, now = new Date(), sendEmail, to, appUrl, log = console.error }) {
  const digest = buildDigest({ now, timeZone: config.timeZone, appUrl, tasks: await store.openTasks(), idleDeals: await store.idleDeals() });
  if (!digest) return 'quiet';
  if (!sendEmail || !to) return 'not sent: no email key or recipient';
  try {
    await sendEmail({ to, subject: digest.subject, text: digest.text });
    return 'sent';
  } catch (error) {
    log('[open-pipeline] morning email failed', error);
    return `failed: ${error.message}`;
  }
}

export async function runDaily(deps) {
  const { store, config, now = new Date() } = deps;
  const digest = await sendDigest(deps);
  const days = Number(config.retentionDays) || 1095;
  return { digest, purged: await store.purge(new Date(now.getTime() - days * 86_400_000).toISOString()) };
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
