// Small text helpers shared by the intakes and the morning email: phone numbers, emails, French dates.

/** A phone number in a loose E.164 form, or null. French numbers written as usual are understood. */
export function normalizePhone(p) {
  if (!p) return null;
  const d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.startsWith('00') && d.length >= 12) return `+${d.slice(2)}`;
  if (d.startsWith('0') && d.length === 10) return `+33${d.slice(1)}`;
  return null;
}

/** +33612345678 as 06 12 34 56 78; other countries as given. */
export function formatPhoneFr(e164) {
  if (!e164) return null;
  if (/^\+33\d{9}$/.test(e164)) return `0${e164.slice(3)}`.replace(/(\d{2})(?=\d)/g, '$1 ');
  return e164;
}

export function normalizeEmail(e) {
  const v = String(e ?? '').trim().toLowerCase();
  return /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(v) ? v : null;
}

/** A trimmed one-line text, cut at `max`, or null when empty. */
export function clean(v, max = 200) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function parts(iso, timeZone) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const minutes = p.minute === '00' ? '' : ` ${p.minute}`;
  return { day: `${p.weekday} ${p.day} ${p.month}`, time: `à ${Number(p.hour)} h${minutes}` };
}

/** « mercredi 28 octobre à 9 h », in the given time zone. */
export function formatDateTimeFr(iso, timeZone = 'Europe/Paris') {
  const { day, time } = parts(iso, timeZone);
  return `${day} ${time}`;
}

/** « à 9 h 30 », in the given time zone. */
export function formatTimeFr(iso, timeZone = 'Europe/Paris') {
  return parts(iso, timeZone).time;
}

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayKey(iso, timeZone = 'Europe/Paris') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
