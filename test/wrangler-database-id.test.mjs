// The database id that `npm run db:id` writes into wrangler.toml and wrangler.intake.toml, from
// `wrangler d1 list --json`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planDatabaseId } from '../src/setup/wrangler-database-id.mjs';

const TOML = [
  'name = "open-pipeline-intake"',
  '[[d1_databases]]',
  'binding = "DB"',
  'database_name = "open-pipeline"',
  'database_id = "REPLACE_WITH_D1_DATABASE_ID"',
  'migrations_dir = "migrations"',
  '',
  '[vars]',
  'FORM_ORIGINS = "https://www.example.com"',
  '',
].join('\n');
const ID = '0f8c2b1e-5d4a-4c3b-9a2f-6e7d8c9b0a1f';
const EU = { uuid: ID, name: 'open-pipeline', jurisdiction: 'eu' };
const withId = (id) => TOML.replace('REPLACE_WITH_D1_DATABASE_ID', id);

test('the id of the database named in the file replaces the placeholder, nothing else changes, and the message names the file', () => {
  const other = { uuid: '11111111-2222-3333-4444-555555555555', name: 'other', jurisdiction: 'eu' };
  const plan = planDatabaseId({ toml: TOML, databases: [other, EU], file: 'wrangler.intake.toml' });
  assert.equal(plan.toml, withId(ID));
  assert.equal(plan.message, `wrangler.intake.toml: database_id = "${ID}" (open-pipeline).`);
  assert.equal(plan.warning, undefined);
});

test('Windows line endings survive', () => {
  const crlf = TOML.replace(/\n/g, '\r\n');
  assert.equal(planDatabaseId({ toml: crlf, databases: [EU] }).toml, crlf.replace('REPLACE_WITH_D1_DATABASE_ID', ID));
});

test('a database recreated under the same name replaces the old id; the same id changes nothing', () => {
  assert.equal(planDatabaseId({ toml: withId('00000000-0000-0000-0000-000000000000'), databases: [EU] }).toml, withId(ID));
  const same = planDatabaseId({ toml: withId(ID), databases: [EU] });
  assert.equal(same.toml, withId(ID));
  assert.match(same.message, /already/);
});

test('a database outside the EU jurisdiction is written, with a warning saying which one and how to recreate it', () => {
  const plan = planDatabaseId({ toml: TOML, databases: [{ ...EU, jurisdiction: null, created_at: '2026-10-26T09:55:12.526Z' }] });
  assert.equal(plan.toml, withId(ID));
  assert.match(plan.warning, /created 2026-10-26 09:55 UTC/);
  assert.match(plan.warning, /A database with that name already exists/);
  assert.match(plan.warning, /npx wrangler d1 delete open-pipeline, then npx wrangler d1 create open-pipeline --jurisdiction eu/);
});

test('with no database of that name, it says how to create one and writes nothing', () => {
  const plan = planDatabaseId({ toml: TOML, databases: [{ ...EU, name: 'other' }] });
  assert.match(plan.error, /npx wrangler d1 create open-pipeline --jurisdiction eu/);
  assert.equal(plan.toml, undefined);
});

test('a file without a database section is refused', () => {
  assert.match(planDatabaseId({ toml: 'name = "x"\n', databases: [EU], file: 'wrangler.toml' }).error, /wrangler\.toml needs a database_name and a database_id/);
});
