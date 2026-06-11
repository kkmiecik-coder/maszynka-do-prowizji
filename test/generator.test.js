import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWorkbook } from '../src/generator.js';

// mini-szablon: wiersz1 nagłówki summary, wiersz2 styl, wiersz5 nagłówki detail, wiersz6 styl.
// Blok szczegółów zaczyna się od "Nazwa Firmy" i kończy na "DO WYPŁATY" — bez "Nazwa Partnera"
// (tej kolumny nie ma w danych źródłowych "dane do plików").
async function miniTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Arkusz1');
  ws.getRow(1).values = ['Organizacja', 'SID ID', 'Nazwa', 'KANAŁ', 'DO WYPŁATY'];
  ws.getRow(2).values = ['x', 'x', 'x', 'x', 0];
  ws.getCell('E2').numFmt = '#,##0.00 "zł"';
  ws.getRow(5).values = ['Nazwa Firmy', 'Nazwa Prowizji', 'DO WYPŁATY'];
  ws.getRow(6).values = ['x', 'x', 0];
  const dir = mkdtempSync(join(tmpdir(), 'tpl-'));
  const p = join(dir, 'tpl.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

test('generateWorkbook: wstawia podsumowania i szczegóły', async () => {
  const tpl = await miniTemplate();
  // Wiersze szczegółów z silnika mają z przodu klucze (kol 1-2: SID POS, SID Sprzed.),
  // potem kol 3.. = Nazwa Firmy, Nazwa Prowizji, DO WYPŁATY, ... a na końcu (źródło: kol 44/45)
  // doklejone Struktura ("DB"/"Play Own") i Firma — które generator MUSI odciąć.
  // Mini-szablon ma 3 kolumny wyjścia (Nazwa Firmy, Nazwa Prowizji, DO WYPŁATY),
  // więc realne źr. kol 3,4,5 mapują się na te trzy.
  const mkDetail = (firma, prow, wyplata) => {
    const r = new Array(45).fill(null);
    r[0] = 'D1'; r[1] = 'D1a';            // klucze (kol 1-2)
    r[2] = firma; r[3] = prow; r[4] = wyplata; // Nazwa Firmy/Nazwa Prowizji/DO WYPŁATY (kol 3-5)
    r[43] = 'DB'; r[44] = 'WŁASNY';       // Struktura (kol44), Firma (kol45) — NIE do wyjścia
    return r;
  };
  const file = {
    organizacja: 'FirmaDelta', kanal: 'POS',
    summaries: [['FirmaDelta', 'D1', 'Lesko', 'POS', 100], ['FirmaDelta', 'D2', 'Sanok', 'POS', 200]],
    details: [mkDetail('firmaA', 'p1', 11), mkDetail('firmaB', 'p2', 22), mkDetail('firmaC', 'p3', 33)],
  };
  const wb = await generateWorkbook(file, tpl);
  const ws = wb.worksheets[0];

  // Dwa wiersze summary zaczynają się od wiersza 2
  assert.equal(ws.getCell('A2').value, 'FirmaDelta');
  assert.equal(ws.getCell('A3').value, 'FirmaDelta'); // drugi SID

  // Styl (numFmt) zachowany z szablonu na komórce E2
  assert.equal(ws.getCell('E2').numFmt, '#,##0.00 "zł"');

  // Z 2 wierszami summary (extraSummary=1) wstawiamy 1 dodatkowy wiersz po wierszu 2,
  // więc blok detail przesuwa się o 1: nagłówek detail → wiersz 6, dane → wiersz 7..9
  assert.equal(ws.getCell('A6').value, 'Nazwa Firmy'); // nagłówek detali przesunięty z wiersza 5
  assert.equal(ws.getCell('A7').value, 'firmaA');
  assert.equal(ws.getCell('B7').value, 'p1');          // Nazwa Prowizji na drugiej pozycji
  assert.equal(ws.getCell('A8').value, 'firmaB');
  assert.equal(ws.getCell('A9').value, 'firmaC');

  // "DO WYPŁATY" (kol3 wyjścia w mini-szablonie) = 11, NIE "DB"/Struktura
  assert.equal(ws.getCell('C7').value, 11);
  // Struktura/Firma nie mogą pojawić się nigdzie w wierszu danych szczegółów
  const row7 = [];
  for (let c = 1; c <= 6; c++) row7.push(ws.getRow(7).getCell(c).value);
  assert.ok(!row7.includes('DB'), 'Struktura ("DB") nie powinna trafić do wyjścia');
  assert.ok(!row7.includes('WŁASNY'), 'Firma nie powinna trafić do wyjścia');
});
