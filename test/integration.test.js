import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSheetRows, findSheetByPrefix } from '../src/reader.js';
import { buildFiles } from '../src/engine.js';
import { SHEET } from '../src/constants.js';

const PROW = join(process.cwd(), 'Prowizje');
const PLAY = join(PROW, 'Play_dealer_za_okres_202604_2026-05-12-09-34-50 %.xlsx');
const ANAL = join(PROW, 'Analiza-strumieni-prowizji-POS-DB-202604.xlsx');
const hasData = existsSync(PLAY) && existsSync(ANAL);

test('integracja: FIRMA ALFA ma poprawne SID i niepuste szczegóły', { skip: !hasData }, async () => {
  const detName = await findSheetByPrefix(PLAY, SHEET.DETAIL);
  const posName = await findSheetByPrefix(ANAL, SHEET.SUMMARY_POS);
  const { rows: detail } = await readSheetRows(PLAY, detName);
  const { rows: summary } = await readSheetRows(ANAL, posName);
  const files = buildFiles(summary.slice(1), detail.slice(1), 'POS');
  const ml = files.find(f => f.organizacja === 'FIRMA ALFA');
  assert.ok(ml, 'jest plik FIRMA ALFA');
  assert.deepEqual(ml.sidy, ['D000111']);
  assert.ok(ml.details.length > 100, `ma dużo szczegółów, jest ${ml.details.length}`);
});

test('integracja: D000444 z apostrofem ma spójne SID i szczegóły', { skip: !hasData }, async () => {
  // SID "D000444'" (trailing apostrophe) appears identically in both the summary and detail file.
  // The engine performs an exact-string match, so the 9 detail rows keyed "D000444'" ARE matched.
  // This test verifies that the apostrophe is preserved consistently and matching works correctly.
  const detName = await findSheetByPrefix(PLAY, SHEET.DETAIL);
  const posName = await findSheetByPrefix(ANAL, SHEET.SUMMARY_POS);
  const { rows: detail } = await readSheetRows(PLAY, detName);
  const { rows: summary } = await readSheetRows(ANAL, posName);
  const files = buildFiles(summary.slice(1), detail.slice(1), 'POS');
  const bartek = files.find(f => f.organizacja === 'FIRMA GAMMA');
  assert.ok(bartek, 'jest plik FIRMA GAMMA');
  assert.deepEqual(bartek.sidy, ["D000444'"], 'SID z apostrofem zachowany bez zmian');
  assert.equal(bartek.details.length, 9, 'dokładne dopasowanie klucza z apostrofem → 9 wierszy');
});
