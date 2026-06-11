import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWorkbook } from '../src/generator.js';

// mini-szablon: wiersz1 nagłówki summary, wiersz2 styl, wiersz5 nagłówki detail (bank stylów),
// wiersz6 styl danych. Generator NADPISUJE nagłówki szczegółów dynamicznie z planu —
// szablon służy tu tylko jako bank stylów per nazwa kolumny.
async function miniTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Arkusz1');
  ws.getRow(1).values = ['Organizacja', 'SID ID', 'Nazwa', 'KANAŁ', 'DO WYPŁATY'];
  ws.getRow(2).values = ['x', 'x', 'x', 'x', 0];
  ws.getCell('E2').numFmt = '#,##0.00 "zł"';
  // Bank stylów: nazwy kolumn, których styl chcemy zachować (Data Kontraktu, DO WYPŁATY).
  ws.getRow(5).values = ['Nazwa Firmy', 'Nazwa Prowizji', 'Data Kontraktu', 'DO WYPŁATY'];
  ws.getRow(6).values = ['x', 'x', 'x', 0];
  const dir = mkdtempSync(join(tmpdir(), 'tpl-'));
  const p = join(dir, 'tpl.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

// Pełny nagłówek źródła "dane do plików" — MARZEC (bez "Nazwa Partnera"), DO WYPŁATY na idx 42.
const HDR_MARZEC = [
  'SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Prowizji', 'Typ Usługi', 'Data Kontraktu',
  'Okres Kontr.', 'Okres Rozl.', 'Poprz. Okres Rozl.', 'Nr Kontraktu', 'Nr Zamówienia (CRM)',
  'REGON', 'MSISDN', 'SID Dealer', 'ID Rekordu', 'SID POS', 'SID Sprzed.', 'Typ Partnera',
  'Taryfa', 'Czas Trwania', 'Promocja', 'Licznik - MEMBER', 'MSISDN Ownera', 'Typ Aneksu',
  'Taryfa Rekomendowana', 'Umowa - Kurier', 'Produkt - Kurier', 'Zn. Sprzedaży Ratalnej',
  'Model Telefonu', 'Numer IMEI', 'Status', 'Status - Opis Pełny', 'Weryfik.', 'Weryfik. - Opis',
  'Typ Zdarzenia', 'Zn. CHURN', 'CHURN MSISDN', 'Mnożnik POS', 'Mnożnik Rek.', 'Mnożnik - MEMBER',
  'Taryfa Rekomendowana - Mnoznik', 'Mnożnik Realizacji Planu', 'DO WYPŁATY', 'Struktura', 'Firma',
];
// KWIECIEŃ — z "Nazwa Partnera" na idx 3, DO WYPŁATY na idx 43.
const HDR_KWIECIEN = [
  'SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Partnera', 'Nazwa Prowizji', 'Typ Usługi',
  'Data Kontraktu', 'Okres Kontr.', 'Okres Rozl.', 'Poprz. Okres Rozl.', 'Nr Kontraktu',
  'Nr Zamówienia (CRM)', 'REGON', 'MSISDN', 'SID Dealer', 'ID Rekordu', 'SID POS', 'SID Sprzed.',
  'Typ Partnera', 'Taryfa', 'Czas Trwania', 'Promocja', 'Licznik - MEMBER', 'MSISDN Ownera',
  'Typ Aneksu', 'Taryfa Rekomendowana', 'Umowa - Kurier', 'Produkt - Kurier', 'Zn. Sprzedaży Ratalnej',
  'Model Telefonu', 'Numer IMEI', 'Status', 'Status - Opis Pełny', 'Weryfik.', 'Weryfik. - Opis',
  'Typ Zdarzenia', 'Zn. CHURN', 'CHURN MSISDN', 'Mnożnik POS', 'Mnożnik Rek.', 'Mnożnik - MEMBER',
  'Taryfa Rekomendowana - Mnoznik', 'Mnożnik Realizacji Planu', 'DO WYPŁATY', 'Struktura', 'Firma',
];

// Buduje wiersz danych źródła o długości nagłówka, wpisuje wartości na podane indeksy.
function srcRow(len, values) {
  const r = new Array(len).fill(null);
  for (const [idx, val] of Object.entries(values)) r[Number(idx)] = val;
  return r;
}

test('generateWorkbook MARZEC: 41 kolumn wyjścia, DO WYPŁATY z wartością, bez Struktura/Firma', async () => {
  const tpl = await miniTemplate();
  // Wiersz danych marcowy: Nazwa Firmy(2), Data Kontraktu(5), DO WYPŁATY(42)=56, Struktura(43)/Firma(44).
  const d = srcRow(45, { 0: 'D1', 1: 'D1a', 2: 'firmaA', 3: 'Utrzymanie', 5: new Date('2026-03-13'), 42: 56, 43: 'DB', 44: 'WŁASNY' });
  const file = {
    organizacja: 'ML', kanal: 'POS',
    summaries: [['ML', 'D1', 'Nazwa', 'POS', 100]],
    details: [d],
  };
  const wb = await generateWorkbook(file, tpl, HDR_MARZEC);
  const ws = wb.worksheets[0];

  // Nagłówek szczegółów (wiersz 5, brak extraSummary bo 1 summary) = 41 kolumn, ostatnia DO WYPŁATY.
  let hdrCols = 0; for (let c = 1; c <= 50; c++) if (ws.getRow(5).getCell(c).value != null) hdrCols = c;
  assert.equal(hdrCols, 41, 'marzec → 41 kolumn wyjścia');
  assert.equal(ws.getRow(5).getCell(1).value, 'Nazwa Firmy');
  assert.equal(ws.getRow(5).getCell(41).value, 'DO WYPŁATY');
  // Dane (wiersz 6): firmaA w kol1, DO WYPŁATY=56 w kol41 z numFmt waluty.
  assert.equal(ws.getRow(6).getCell(1).value, 'firmaA');
  assert.equal(ws.getRow(6).getCell(41).value, 56);
  assert.equal(ws.getRow(6).getCell(41).numFmt, '#,##0.00');
  // Data Kontraktu (kol 4 wyjścia) ma numFmt daty
  assert.equal(ws.getRow(5).getCell(4).value, 'Data Kontraktu');
  assert.equal(ws.getRow(6).getCell(4).numFmt, 'dd-mm-yyyy');
  // Struktura/Firma nieobecne
  const row = []; for (let c = 1; c <= 41; c++) row.push(ws.getRow(6).getCell(c).value);
  assert.ok(!row.includes('DB'), 'Struktura nie trafia do wyjścia');
  assert.ok(!row.includes('WŁASNY'), 'Firma nie trafia do wyjścia');
});

test('generateWorkbook KWIECIEŃ: 42 kolumny z Nazwa Partnera, DO WYPŁATY z wartością (regresja buga)', async () => {
  const tpl = await miniTemplate();
  // Wiersz kwietniowy: Nazwa Firmy(2), Nazwa Partnera(3), Data Kontraktu(6), DO WYPŁATY(43)=16, Struktura(44)/Firma(45).
  const d = srcRow(46, { 0: 'D1', 1: 'D1a', 2: 'firmaA', 3: 'PARTNER X', 4: 'Utrzymanie', 6: new Date('2026-04-08'), 43: 16, 44: 'DB', 45: 'WŁASNY' });
  const file = {
    organizacja: 'ML', kanal: 'POS',
    summaries: [['ML', 'D1', 'Nazwa', 'POS', 100]],
    details: [d],
  };
  const wb = await generateWorkbook(file, tpl, HDR_KWIECIEN);
  const ws = wb.worksheets[0];

  // 42 kolumny, kol2 = Nazwa Partnera, ostatnia = DO WYPŁATY.
  let hdrCols = 0; for (let c = 1; c <= 50; c++) if (ws.getRow(5).getCell(c).value != null) hdrCols = c;
  assert.equal(hdrCols, 42, 'kwiecień → 42 kolumny wyjścia');
  assert.equal(ws.getRow(5).getCell(2).value, 'Nazwa Partnera');
  assert.equal(ws.getRow(5).getCell(42).value, 'DO WYPŁATY');
  // Dane: Nazwa Partnera w kol2, DO WYPŁATY=16 w kol42 (NIE urwane — to był bug).
  assert.equal(ws.getRow(6).getCell(1).value, 'firmaA');
  assert.equal(ws.getRow(6).getCell(2).value, 'PARTNER X');
  assert.equal(ws.getRow(6).getCell(42).value, 16);
  assert.equal(ws.getRow(6).getCell(42).numFmt, '#,##0.00');
  // Struktura/Firma nieobecne
  const row = []; for (let c = 1; c <= 42; c++) row.push(ws.getRow(6).getCell(c).value);
  assert.ok(!row.includes('DB'));
  assert.ok(!row.includes('WŁASNY'));
});

test('generateWorkbook: wiele SID przesuwa blok szczegółów w dół, summary nietknięte', async () => {
  const tpl = await miniTemplate();
  const d1 = srcRow(45, { 2: 'firmaA', 42: 11, 43: 'DB' });
  const d2 = srcRow(45, { 2: 'firmaB', 42: 22, 43: 'DB' });
  const file = {
    organizacja: 'ACME', kanal: 'POS',
    summaries: [['ACME', 'D1', 'Lesko', 'POS', 100], ['ACME', 'D2', 'Sanok', 'POS', 200]],
    details: [d1, d2],
  };
  const wb = await generateWorkbook(file, tpl, HDR_MARZEC);
  const ws = wb.worksheets[0];
  // Dwa summary: wiersz 2 i 3
  assert.equal(ws.getCell('A2').value, 'ACME');
  assert.equal(ws.getCell('A3').value, 'ACME');
  assert.equal(ws.getCell('E2').numFmt, '#,##0.00 "zł"'); // styl summary zachowany
  // extraSummary=1 → nagłówek szczegółów na wierszu 6, dane od 7
  assert.equal(ws.getRow(6).getCell(1).value, 'Nazwa Firmy');
  assert.equal(ws.getRow(7).getCell(1).value, 'firmaA');
  assert.equal(ws.getRow(8).getCell(1).value, 'firmaB');
});
