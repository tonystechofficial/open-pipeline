// The morning email: what is overdue, what is due today, and the open deals left without a next
// action (the one rule that keeps prospects from being forgotten). Null on a quiet morning. Pure.
import { dayKey, formatDateTimeFr, formatTimeFr } from './text.mjs';

export function buildDigest({ now, timeZone = 'Europe/Paris', appUrl, tasks = [], idleDeals = [] }) {
  const today = dayKey(now, timeZone);
  const byDue = (a, b) => String(a.dueAt).localeCompare(String(b.dueAt));
  const overdue = tasks.filter((t) => dayKey(t.dueAt, timeZone) < today).sort(byDue);
  const due = tasks.filter((t) => dayKey(t.dueAt, timeZone) === today).sort(byDue);
  if (!overdue.length && !due.length && !idleDeals.length) return null;

  const link = (dealId) => `  ${appUrl}/#/deal/${dealId}`;
  const section = (title, items) => (items.length ? [title, ...items, ''] : []);
  const text = [
    ...section('En retard', overdue.flatMap((t) => [`- ${t.title} · ${t.dealTitle} · ${formatDateTimeFr(t.dueAt, timeZone)}`, link(t.dealId)])),
    ...section("Aujourd'hui", due.flatMap((t) => [`- ${t.title} · ${t.dealTitle} · ${formatTimeFr(t.dueAt, timeZone)}`, link(t.dealId)])),
    ...section('Sans prochaine action', idleDeals.flatMap((d) => [`- ${d.title} (${d.stageLabel})`, link(d.id)])),
  ].join('\n');

  const counts = [
    due.length && `${due.length} à faire aujourd'hui`,
    overdue.length && `${overdue.length} en retard`,
    idleDeals.length && `${idleDeals.length} sans prochaine action`,
  ].filter(Boolean);
  return { subject: `Pipeline : ${counts.join(', ')}`, text };
}
