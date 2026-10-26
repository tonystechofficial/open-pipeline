// The pipeline's configuration (config/pipeline.json): stages in order, the custom fields of a deal,
// and the stage each intake source puts a new deal at. Pure.

const TEMPERATURES = new Set(['froid', 'tiede', 'chaud']);
const FIELD_TYPES = new Set(['text', 'number', 'select']);

/** @returns {{ok: boolean, errors: string[]}} every reason the configuration cannot be used. */
export function validatePipeline(config) {
  const errors = [];
  const stages = Array.isArray(config?.stages) ? config.stages : [];
  if (!stages.length) errors.push('the pipeline needs stages');
  const seen = new Set();
  for (const s of stages) {
    if (!s?.id || !s.label) errors.push('every stage needs an id and a label');
    if (seen.has(s.id)) errors.push(`stage ${s.id} appears twice`);
    seen.add(s.id);
    if (s.temperature !== undefined && !TEMPERATURES.has(s.temperature)) {
      errors.push(`stage ${s.id}: temperature "${s.temperature}" is not froid, tiede or chaud`);
    }
  }
  if (stages.filter((s) => s.lost).length !== 1) errors.push('the pipeline needs exactly one lost stage');

  for (const [id, source] of Object.entries(config?.sources ?? {})) {
    for (const key of ['stage', 'bookedStage']) {
      if (source[key] !== undefined && !seen.has(source[key])) errors.push(`source ${id}: unknown stage "${source[key]}"`);
    }
  }

  const fieldIds = new Set();
  for (const f of Array.isArray(config?.fields) ? config.fields : []) {
    if (fieldIds.has(f.id)) errors.push(`field ${f.id} appears twice`);
    fieldIds.add(f.id);
    if (!FIELD_TYPES.has(f.type)) errors.push(`field ${f.id}: type "${f.type}" is not text, number or select`);
    else if (f.type === 'select' && !(Array.isArray(f.options) && f.options.length)) errors.push(`field ${f.id}: a select needs options`);
  }
  return { ok: errors.length === 0, errors };
}

const stageOf = (config, id) => config.stages.find((s) => s.id === id);

/** froid, tiede or chaud; gagne for a won stage, perdu for the lost one; null for an unknown stage. */
export function temperatureOf(config, id) {
  const s = stageOf(config, id);
  if (!s) return null;
  if (s.lost) return 'perdu';
  if (s.won) return 'gagne';
  return s.temperature ?? null;
}

export function stageIndex(config, id) {
  return config.stages.findIndex((s) => s.id === id);
}

export function isClosed(config, id) {
  return Boolean(stageOf(config, id)?.closed);
}

/** The stages on the board: everything but the closed ones. */
export function openStages(config) {
  return config.stages.filter((s) => !s.closed);
}

export function lostStage(config) {
  return config.stages.find((s) => s.lost);
}
