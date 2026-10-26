// Creates the Cal.com webhook that sends each booking to the intake Worker, or updates the one already
// there, with a new signing secret given to the intake Worker first. The API key is asked for, masked,
// unless CALCOM_API_KEY is set; it is used for this run only, never stored or printed.
//
//   npm run cal:webhook                 after npm run deploy
//   npm run cal:webhook -- --url=https://open-pipeline-intake.<you>.workers.dev
import { randomBytes } from 'node:crypto';
import { askSecret, putSecret, intakeUrl } from './lib.mjs';
import { webhookPlan } from '../src/setup/cal-webhook.mjs';

const base = intakeUrl();
if (!base) {
  console.error('No intake address: run npm run deploy first, or pass --url=https://open-pipeline-intake.<you>.workers.dev');
  process.exit(1);
}
const subscriberUrl = `${base}/intake/calcom`;

const key = process.env.CALCOM_API_KEY || await askSecret('Cal.com API key (Settings > Developer > API keys): ');
if (!key) {
  console.error('No key given: nothing done.');
  process.exit(1);
}

async function cal(method, path, payload) {
  const res = await fetch(`https://api.cal.com/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Cal.com refused ${method} ${path} (${res.status}): ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
    process.exit(1);
  }
  return data.data;
}

const webhooks = await cal('GET', '/webhooks?take=250'); // checks the key before anything changes
const secret = randomBytes(32).toString('hex');
if (!putSecret('CALCOM_WEBHOOK_SECRET', secret, { config: 'wrangler.intake.toml' })) {
  console.error('wrangler secret put failed: nothing changed in Cal.com.');
  process.exit(1);
}
const plan = webhookPlan({ webhooks, subscriberUrl, secret });
const hook = await cal(plan.method, plan.path, plan.body);
console.log(`Cal.com webhook ${hook.id} ${plan.method === 'POST' ? 'created' : 'updated'}: ${subscriberUrl} (${plan.body.triggers.join(', ')}).`);
console.log('Book a test slot on your Cal.com page: the deal appears in the app under "RDV pris".');
