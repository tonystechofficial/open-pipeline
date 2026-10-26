// Links open-receptionist to this pipeline: the end of each call goes to the intake Worker, signed
// with a shared secret. It gives both Workers the same new secret (never shown) and writes
// CRM_WEBHOOK_URL into open-receptionist's wrangler.toml; open-receptionist is deployed after.
//
//   npm run link:receptionist -- ../open-receptionist          after npm run deploy
//   npm run link:receptionist -- ../open-receptionist --url=https://open-pipeline-intake.<you>.workers.dev
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { putSecret, intakeUrl } from './lib.mjs';
import { setVar } from '../src/setup/deploy.mjs';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '../open-receptionist');
const toml = join(dir, 'wrangler.toml');
if (!existsSync(toml)) fail(`No wrangler.toml in ${dir}. Give open-receptionist's folder: npm run link:receptionist -- ../open-receptionist`);
const base = intakeUrl();
if (!base) fail('No intake address: run npm run deploy first, or add --url=https://open-pipeline-intake.<you>.workers.dev');

const url = `${base}/intake/receptionist`;
const plan = setVar(readFileSync(toml, 'utf8'), 'CRM_WEBHOOK_URL', url);
if (plan.error) fail(`${toml}: ${plan.error}`);

const secret = randomBytes(32).toString('hex');
if (!putSecret('RECEPTIONIST_SECRET', secret, { config: 'wrangler.intake.toml' })) fail('wrangler secret put failed: nothing changed.');
if (!putSecret('CRM_WEBHOOK_SECRET', secret, { cwd: dir })) {
  fail('The intake has the new secret, open-receptionist does not: run this command again.');
}
if (plan.changed) writeFileSync(toml, plan.toml);
console.log(`\n${toml}: CRM_WEBHOOK_URL = "${url}"`);
console.log('Both Workers share a new secret. Now, in open-receptionist: npm run deploy');
