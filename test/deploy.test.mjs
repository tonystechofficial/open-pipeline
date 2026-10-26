// What `npm run deploy` reads and writes: the addresses wrangler published, APP_URL in wrangler.toml,
// and README.local.md with this deployment's addresses in every remaining step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deployedUrl, setVar, databaseIdMissing, localReadme } from '../src/setup/deploy.mjs';

test('the address wrangler published: the last deploy entry, workers.dev first', () => {
  const ndjson = [
    '{"type":"wrangler-session","version":1}',
    '{"type":"deploy","targets":["https://old.example.workers.dev"]}',
    'not json',
    '{"type":"deploy","targets":["https://pipeline.example.com","https://open-pipeline.tony.workers.dev"]}',
    '',
  ].join('\n');
  assert.equal(deployedUrl(ndjson), 'https://open-pipeline.tony.workers.dev');
  assert.equal(deployedUrl('{"type":"deploy","targets":["https://pipeline.example.com/"]}'), 'https://pipeline.example.com');
  assert.equal(deployedUrl('{"type":"deploy","targets":[]}'), null);
  assert.equal(deployedUrl(''), null);
});

const TOML = [
  '[vars]',
  'REMINDER_EMAIL = "you@example.com"   # who gets the morning email',
  'APP_URL = ""                         # written by npm run deploy',
  '',
].join('\r\n');

test('APP_URL is written in place, its comment and line endings kept; the same value changes nothing', () => {
  const first = setVar(TOML, 'APP_URL', 'https://open-pipeline.tony.workers.dev');
  assert.equal(first.changed, true);
  assert.equal(first.toml, TOML.replace('APP_URL = ""', 'APP_URL = "https://open-pipeline.tony.workers.dev"'));
  assert.deepEqual(setVar(first.toml, 'APP_URL', 'https://open-pipeline.tony.workers.dev'), { toml: first.toml, changed: false });
});

test('a missing variable is an error, not a silent no-op', () => {
  assert.match(setVar('[vars]\n', 'APP_URL', 'https://x.example').error, /APP_URL = "" under \[vars\]/);
});

test('a database id still a placeholder stops the deploy before wrangler runs', () => {
  assert.equal(databaseIdMissing('database_id = "REPLACE_WITH_D1_DATABASE_ID"'), true);
  assert.equal(databaseIdMissing('database_id = "0f8c2b1e-5d4a-4c3b-9a2f-6e7d8c9b0a1f"'), false);
});

test('README.local.md: both addresses in the commands, the Access trap spelled out, no secret written', () => {
  const md = localReadme({ appUrl: 'https://open-pipeline.tony.workers.dev', intakeUrl: 'https://open-pipeline-intake.tony.workers.dev' });
  assert.match(md, /Open https:\/\/open-pipeline\.tony\.workers\.dev/);
  assert.match(md, /curl https:\/\/open-pipeline-intake\.tony\.workers\.dev\/health/);
  assert.match(md, /All traffic/);
  assert.match(md, /Cloudflare account/);
  assert.match(md, /never .*Email domain.*gmail\.com/i);
  assert.match(md, /never .*Protect all Workers/i);
  assert.match(md, /npm run cal:webhook/);
  assert.match(md, /npm run link:receptionist/);
  assert.match(md, /npx wrangler secret put TURNSTILE_SECRET -c wrangler\.intake\.toml/);
  assert.doesNotMatch(md, /re_[A-Za-z0-9]{8}/);
});
