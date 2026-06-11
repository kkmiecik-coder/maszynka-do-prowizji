import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSheetRows, findSheetByPrefix } from '../src/reader.js';

async function makeFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('dane do plików POS 04');
  ws.addRow(['Organizacja', 'SID ID', 'Nazwa', 'KANAŁ']);
  ws.addRow(['FIRMA ALFA', 'D000111', 'Przykładowa Nazwa', 'POS']);
  const dir = mkdtempSync(join(tmpdir(), 'prow-'));
  const p = join(dir, 'f.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

test('findSheetByPrefix: znajduje arkusz po prefiksie', async () => {
  const p = await makeFixture();
  assert.equal(await findSheetByPrefix(p, 'dane do plików POS'), 'dane do plików POS 04');
});

test('readSheetRows: zwraca wiersze jako tablice 1-based przez indeks', async () => {
  const p = await makeFixture();
  const { rows } = await readSheetRows(p, 'dane do plików POS 04');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'FIRMA ALFA'); // kol 1
  assert.equal(rows[1][1], 'D000111');           // kol 2
});

test('findSheetByPrefix: zwraca null gdy brak arkusza z prefiksem', async () => {
  const p = await makeFixture();
  assert.equal(await findSheetByPrefix(p, 'NIEISTNIEJACY'), null);
});

test('readSheetRows: rzuca gdy arkusz nie istnieje', async () => {
  const p = await makeFixture();
  await assert.rejects(() => readSheetRows(p, 'NIEISTNIEJACY'), /Brak arkusza/);
});
