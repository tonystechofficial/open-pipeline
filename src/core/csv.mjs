// A CSV file as Excel, Google Sheets or Brevo export it: comma, semicolon or tab separated, quoted
// values with separators, quotes ("") and line breaks inside, an optional byte order mark. Pure.

function delimiterOf(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
}

/** @returns {{headers: string[], rows: string[][]}} blank lines skipped, values trimmed. */
export function parseCsv(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  if (!text.trim()) return { headers: [], rows: [] };
  const d = delimiterOf(text);
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === d) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); records.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); records.push(row); }
  const kept = records.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ''));
  return { headers: kept[0] ?? [], rows: kept.slice(1) };
}
