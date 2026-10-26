// Reading a CSV file as exported by Excel, Google Sheets or Brevo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/core/csv.mjs';

test('a French Excel export: semicolons, a byte order mark, Windows line endings', () => {
  assert.deepEqual(parseCsv('﻿nom;entreprise;téléphone\r\nJean;Plomberie;0612345678\r\n'), {
    headers: ['nom', 'entreprise', 'téléphone'],
    rows: [['Jean', 'Plomberie', '0612345678']],
  });
});

test('commas, quoted values with commas, quotes and line breaks inside', () => {
  const text = 'name,notes\n"Martin, Jean","Il a dit ""oui""\npuis rappelé"\n';
  assert.deepEqual(parseCsv(text).rows, [['Martin, Jean', 'Il a dit "oui"\npuis rappelé']]);
});

test('blank lines are skipped and values trimmed', () => {
  assert.deepEqual(parseCsv('a,b\n\n 1 , 2 \n\n').rows, [['1', '2']]);
});

test('an empty file has no headers and no rows', () => {
  assert.deepEqual(parseCsv(''), { headers: [], rows: [] });
});
