// What each source brings into the pipeline, as one intake: who (and their business), the custom
// fields they answered, the stage it implies, what happened, and the next action. Pure.
//
// Cal.com: webhook payloads as documented on 2026-10-25
// (https://cal.com/docs/developing/guides/automation/webhooks): { triggerEvent, createdAt,
// payload: { uid, startTime, attendees: [{ name, email }], responses: { name, email,
// attendeePhoneNumber, notes, <question slug> } } }. Booking questions whose slug matches a field id
// (dashes read as underscores) fill that field.
import { normalizePhone, normalizeEmail, formatPhoneFr, clean, formatDateTimeFr } from './text.mjs';

const BOOKING_EVENTS = new Set(['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED']);
const URGENCE = { immediate: 'immédiate', haute: 'sous 48 h', normale: 'normale' };

const keyOf = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const who = (c) => c.name ?? formatPhoneFr(c.phone) ?? c.email;

/** A field value as its type wants it, or undefined when it does not fit. */
function fieldValue(field, raw) {
  const text = clean(Array.isArray(raw) ? raw.join(', ') : raw, 500);
  if (text === null) return undefined;
  if (field.type === 'number') {
    const n = Number(text.replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && /\d/.test(text) ? n : undefined;
  }
  if (field.type === 'select') {
    const option = field.options.find((o) => keyOf(o.id) === keyOf(text) || keyOf(o.label) === keyOf(text));
    return option?.id;
  }
  return text;
}

function fieldsFrom(entries, config) {
  const fields = {};
  for (const [key, raw] of entries) {
    const field = config.fields?.find((f) => f.id === keyOf(key));
    const value = field && fieldValue(field, raw);
    if (value !== undefined) fields[field.id] = value;
  }
  return fields;
}

function contactOf({ name, phone, email, company = null, trade = null, town = null }) {
  return { name: clean(name, 100), phone: normalizePhone(phone), email: normalizeEmail(email), company: clean(company, 120), trade: clean(trade, 80), town: clean(town, 80) };
}

/** A Cal.com booking webhook. Other triggers are ignored. */
export function fromCalBooking(event, config) {
  if (!BOOKING_EVENTS.has(event?.triggerEvent)) return { ignored: true };
  const p = event.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const r = p.responses ?? {};
  const nameValue = r.name?.value;
  const name = typeof nameValue === 'object' && nameValue ? [nameValue.firstName, nameValue.lastName].filter(Boolean).join(' ') : (nameValue ?? attendee.name);
  const fields = fieldsFrom(Object.entries(r).map(([k, v]) => [k, v?.value]), config);
  const contact = contactOf({ name, phone: r.attendeePhoneNumber?.value ?? attendee.phoneNumber, email: r.email?.value ?? attendee.email, trade: fields.metier });
  if (!contact.name && !contact.phone && !contact.email) return { ignored: true };

  const tz = config.timeZone ?? 'Europe/Paris';
  const when = p.startTime ? formatDateTimeFr(p.startTime, tz) : 'une date inconnue';
  const notes = clean(r.notes?.value ?? p.additionalNotes, 2000);
  const lines = {
    BOOKING_CREATED: `RDV le ${when}`,
    BOOKING_RESCHEDULED: `RDV déplacé au ${when}`,
    BOOKING_CANCELLED: `RDV annulé (il était prévu le ${when})${p.cancellationReason ? ` : ${clean(p.cancellationReason, 500)}` : ''}`,
  };
  const cancelled = event.triggerEvent === 'BOOKING_CANCELLED';
  return {
    intake: {
      source: 'calcom',
      sourceRef: `${event.triggerEvent}:${p.uid}`,
      at: event.createdAt ?? new Date().toISOString(),
      contact,
      fields,
      stage: cancelled ? null : config.sources.calcom.stage,
      activity: { kind: 'booking', body: [lines[event.triggerEvent], notes].filter(Boolean).join('\n') },
      task: cancelled
        ? { title: `Relancer ${who(contact)} (RDV annulé)`, dueAt: event.createdAt }
        : { title: `RDV avec ${who(contact)}`, dueAt: p.startTime },
    },
  };
}

/** The end of an open-receptionist call, as its Worker forwards it. Nobody to call back is ignored. */
export function fromReceptionistCall(call, config) {
  const c = call?.caller ?? {};
  const contact = contactOf({ name: c.nom, phone: c.telephone, email: c.email, town: c.ville });
  if (!contact.name && !contact.phone && !contact.email) return { ignored: true };
  const source = config.sources.receptionniste;
  const booked = call.status === 'rdv' && call.appointment?.at;
  const body = [
    'Appel reçu par le réceptionniste.',
    c.besoin && `Besoin : ${clean(c.besoin, 500)}`,
    c.urgence && `Urgence : ${URGENCE[c.urgence] ?? c.urgence}`,
    booked ? `RDV : ${call.appointment.label ?? call.appointment.at}` : 'À rappeler.',
    call.summary && `Résumé : ${clean(call.summary, 2000)}`,
  ].filter(Boolean).join('\n');
  const urgent = c.urgence === 'immediate' ? 'URGENT : ' : '';
  return {
    intake: {
      source: 'receptionniste',
      sourceRef: `receptionniste:${call.callId}`,
      at: call.endedAt ?? new Date().toISOString(),
      contact,
      fields: {},
      stage: booked ? (source.bookedStage ?? source.stage) : source.stage,
      activity: { kind: 'call', body },
      task: booked
        ? { title: `RDV avec ${who(contact)}`, dueAt: call.appointment.at }
        : { title: `${urgent}Rappeler ${who(contact)}`, dueAt: call.endedAt },
    },
  };
}

/** The website contact form. A name and a way to answer are required; the message is kept. */
export function fromForm(form, config, { at }) {
  const contact = contactOf({ name: form?.name, phone: form?.phone, email: form?.email, company: form?.company, trade: form?.trade });
  if (!contact.name) return { error: 'Indiquez votre nom.' };
  if (!contact.phone && !contact.email) return { error: 'Indiquez un téléphone ou un email pour la réponse.' };
  const message = String(form.message ?? '').trim().slice(0, 2000);
  return {
    intake: {
      source: 'formulaire',
      sourceRef: null,
      at,
      contact,
      fields: contact.trade && config.fields?.some((f) => f.id === 'metier') ? { metier: contact.trade } : {},
      stage: config.sources.formulaire.stage,
      activity: { kind: 'form', body: message || 'Message envoyé depuis le site.' },
      task: { title: `Répondre à ${contact.name}`, dueAt: at },
    },
  };
}

const COLUMNS = {
  name: ['nom', 'name', 'contact', 'nom_complet', 'full_name', 'prenom_nom'],
  company: ['societe', 'entreprise', 'company', 'raison_sociale', 'organisation', 'organization'],
  phone: ['telephone', 'tel', 'phone', 'mobile', 'portable', 'numero'],
  email: ['email', 'e_mail', 'mail', 'courriel', 'adresse_email', 'email_address'],
  trade: ['metier', 'activite', 'trade', 'secteur', 'profession'],
  town: ['ville', 'town', 'city', 'commune'],
  notes: ['notes', 'note', 'commentaire', 'commentaires', 'remarques'],
};

/** One CSV row, whatever its headers are called. No next action: an import is a list, not a request. */
export function fromCsvRow(headers, row, config, { at }) {
  const value = (column) => {
    const i = headers.findIndex((h) => COLUMNS[column].includes(keyOf(h)));
    return i >= 0 ? row[i] : null;
  };
  const contact = contactOf({ name: value('name'), phone: value('phone'), email: value('email'), company: value('company'), trade: value('trade'), town: value('town') });
  if (!contact.name && !contact.phone && !contact.email) return { error: 'Ligne ignorée : ni nom, ni téléphone, ni email.' };
  return {
    intake: {
      source: 'import',
      sourceRef: null,
      at,
      contact,
      fields: contact.trade && config.fields?.some((f) => f.id === 'metier') ? { metier: contact.trade } : {},
      stage: config.sources.import.stage,
      activity: { kind: 'import', body: clean(value('notes'), 2000) ?? 'Importé' },
      task: null,
    },
  };
}
