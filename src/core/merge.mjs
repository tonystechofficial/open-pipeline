// Where an intake lands. The same person found again (by phone, then email, in the database) has
// their missing details filled in and their open deal extended; otherwise a deal opens at the stage the
// source implies. Nothing written by hand is overwritten, and no intake moves a deal backwards. Pure.
import { isClosed, stageIndex } from './pipeline.mjs';
import { formatPhoneFr } from './text.mjs';

const empty = (v) => v === null || v === undefined || v === '';

/**
 * @param {{intake: object, contact: object|null, deals: object[], config: object}} input `deals` are the
 *   contact's deals, newest first, with their `stage` and `fields`.
 */
export function planIntake({ intake, contact, deals, config }) {
  const contactPlan = contact
    ? { id: contact.id, set: Object.fromEntries(Object.entries(intake.contact).filter(([k, v]) => !empty(v) && empty(contact[k]))) }
    : { id: null, set: intake.contact };

  const open = (deals ?? []).find((d) => !isClosed(config, d.stage));
  let dealPlan;
  if (open) {
    const set = {};
    if (intake.stage && stageIndex(config, intake.stage) > stageIndex(config, open.stage)) set.stage = intake.stage;
    const fields = Object.fromEntries(Object.entries(intake.fields ?? {}).filter(([k]) => empty(open.fields?.[k])));
    dealPlan = { id: open.id, set, fields };
  } else {
    const c = intake.contact;
    dealPlan = {
      id: null,
      set: {
        title: c.company ?? c.name ?? formatPhoneFr(c.phone) ?? c.email,
        stage: intake.stage ?? config.sources[intake.source]?.stage ?? config.stages[0].id,
        source: intake.source,
      },
      fields: intake.fields ?? {},
    };
  }
  return { source: intake.source, sourceRef: intake.sourceRef, at: intake.at, contact: contactPlan, deal: dealPlan, activity: intake.activity, task: intake.task };
}
