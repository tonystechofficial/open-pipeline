// npm run deploy: checks config/pipeline.json, deploys the intake Worker, then the app; writes the
// app's address into APP_URL (the links of the morning email), deploying the app once more when it
// changed; then README.local.md with both addresses. Wrangler's own questions still reach the terminal.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePipeline } from '../src/core/pipeline.mjs';
import { deployedUrl, setVar, databaseIdMissing, localReadme } from '../src/setup/deploy.mjs';

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { errors } = validatePipeline(JSON.parse(readFileSync(path('config/pipeline.json'), 'utf8')));
if (errors.length) fail(`config/pipeline.json: ${errors.join(' ; ')}`);
for (const file of ['wrangler.toml', 'wrangler.intake.toml']) {
  if (!existsSync(path(file)) || databaseIdMissing(readFileSync(path(file), 'utf8'))) {
    fail(`${file} has no database id yet: npx wrangler d1 create open-pipeline --jurisdiction eu, then npm run db:id`);
  }
}

function deploy(args, output) {
  mkdirSync(path('.wrangler'), { recursive: true });
  rmSync(output, { force: true });
  const run = spawnSync(`npx wrangler deploy ${args}`.trim(), { shell: true, stdio: 'inherit', env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: output } });
  if (run.status !== 0) process.exit(run.status ?? 1);
  return deployedUrl(existsSync(output) ? readFileSync(output, 'utf8') : '');
}

const intakeUrl = deploy('-c wrangler.intake.toml', path('.wrangler/deploy-intake.ndjson'));
const appUrl = deploy('', path('.wrangler/deploy-app.ndjson'));
if (!appUrl || !intakeUrl) fail('Deployed, but wrangler printed no address: is workers_dev = true in both files?');

const plan = setVar(readFileSync(path('wrangler.toml'), 'utf8'), 'APP_URL', appUrl);
if (plan.error) fail(plan.error);
if (plan.changed) {
  writeFileSync(path('wrangler.toml'), plan.toml);
  console.log(`\nwrangler.toml: APP_URL = "${appUrl}". Deploying the app again so the morning email links to it.\n`);
  deploy('', path('.wrangler/deploy-app.ndjson'));
}

writeFileSync(path('README.local.md'), localReadme({ appUrl, intakeUrl }));
console.log(`\nApp:    ${appUrl}\nIntake: ${intakeUrl}\nThe next steps, with these addresses: README.local.md`);
