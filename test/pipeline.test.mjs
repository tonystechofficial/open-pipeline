// The pipeline's configuration: stages in order, their temperature, and the custom fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePipeline, temperatureOf, stageIndex, isClosed, openStages, lostStage } from '../src/core/pipeline.mjs';

const config = JSON.parse(readFileSync(new URL('../config/pipeline.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(config));

test('the shipped configuration is valid', () => {
  assert.deepEqual(validatePipeline(config), { ok: true, errors: [] });
});

test('cold, warm and hot follow from the stage; won and lost stages say so', () => {
  assert.equal(temperatureOf(config, 'nouveau'), 'froid');
  assert.equal(temperatureOf(config, 'rdv_pris'), 'tiede');
  assert.equal(temperatureOf(config, 'proposition'), 'chaud');
  assert.equal(temperatureOf(config, 'pilote_signe'), 'gagne');
  assert.equal(temperatureOf(config, 'perdu'), 'perdu');
  assert.equal(temperatureOf(config, 'inconnu'), null);
});

test('stages keep their order; closed ones leave the open board', () => {
  assert.ok(stageIndex(config, 'nouveau') < stageIndex(config, 'rdv_pris'));
  assert.equal(stageIndex(config, 'inconnu'), -1);
  assert.equal(isClosed(config, 'en_service'), true);
  assert.equal(isClosed(config, 'perdu'), true);
  assert.equal(isClosed(config, 'pilote_signe'), false);
  assert.deepEqual(openStages(config).map((s) => s.id), ['nouveau', 'contacte', 'rdv_pris', 'qualifie', 'proposition', 'pilote_signe']);
  assert.equal(lostStage(config).id, 'perdu');
});

test('a broken configuration is refused, with every reason', () => {
  const bad = clone();
  bad.stages.push({ id: 'nouveau', label: 'Doublon' });
  bad.stages[1].temperature = 'brulant';
  bad.sources.calcom.stage = 'inconnu';
  bad.fields.push({ id: 'x', label: 'X', type: 'select' }, { id: 'y', label: 'Y', type: 'date-heure' });
  const { ok, errors } = validatePipeline(bad);
  assert.equal(ok, false);
  for (const reason of [/nouveau.*twice/, /brulant/, /calcom.*inconnu/, /x.*options/, /date-heure/]) {
    assert.ok(errors.some((e) => reason.test(e)), `${reason}: ${errors.join(' | ')}`);
  }
});

test('exactly one lost stage is required: deals that fall through need somewhere to go', () => {
  const none = clone();
  none.stages = none.stages.filter((s) => !s.lost);
  assert.match(validatePipeline(none).errors.join(' '), /one lost stage/);
});
