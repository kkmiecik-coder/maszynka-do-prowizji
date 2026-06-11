// Jednorazowa naprawa szablonów: usuwa nadmiarowy nagłówek "Nazwa Partnera"
// z bloku szczegółów. Tej kolumny nie ma w danych źródłowych "dane do plików",
// więc przez nią cały dolny blok był przesunięty o 1 (a "Struktura" wpadała do AP).
//
// Górny blok (podsumowania, wiersze 1-2) dzieli te same fizyczne kolumny arkusza,
// więc NIE wolno usuwać kolumny przez spliceColumns. Zamiast tego przesuwamy w lewo
// o 1 tylko wiersz nagłówków szczegółów (5) i wzorcowy wiersz stylu danych (6),
// dla kolumn 2..DETAIL_COUNT, i czyścimy ostatnią (zwolnioną) kolumnę.
//
// Uruchom: node scripts/fix-detail-header.js
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(__dirname, '..', 'templates');

const DETAIL_HEADER_ROW = 5;
const DETAIL_STYLE_ROW = 6;
const FIRST_DETAIL_COL = 1;          // "Nazwa Firmy"
const REMOVE_COL = 2;                // "Nazwa Partnera" — do usunięcia
const LAST_DETAIL_COL = 42;          // dotychczasowy zasięg nagłówków szczegółów

function shiftRowLeft(ws, rowIdx, fromCol, lastCol) {
  const row = ws.getRow(rowIdx);
  // Kopiujemy wartość + pełny styl z kolumny c+1 do c (od fromCol do lastCol-1).
  for (let c = fromCol; c < lastCol; c++) {
    const src = row.getCell(c + 1);
    const dst = row.getCell(c);
    dst.value = src.value;
    dst.style = JSON.parse(JSON.stringify(src.style)); // niezależna głęboka kopia
  }
  // Ostatnią (zwolnioną) kolumnę czyścimy: brak wartości i neutralny styl.
  const last = row.getCell(lastCol);
  last.value = null;
  last.style = {};
  row.commit?.();
}

async function fixTemplate(name) {
  const path = join(TPL_DIR, name);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];

  const before = [];
  for (let c = FIRST_DETAIL_COL; c <= LAST_DETAIL_COL; c++) before.push(ws.getRow(DETAIL_HEADER_ROW).getCell(c).value);

  if (before[REMOVE_COL - 1] !== 'Nazwa Partnera') {
    console.log(`POMIJAM ${name}: kol.${REMOVE_COL} = ${JSON.stringify(before[REMOVE_COL - 1])} (już naprawione?)`);
    return;
  }

  shiftRowLeft(ws, DETAIL_HEADER_ROW, REMOVE_COL, LAST_DETAIL_COL);
  shiftRowLeft(ws, DETAIL_STYLE_ROW, REMOVE_COL, LAST_DETAIL_COL);

  await wb.xlsx.writeFile(path);

  const after = [];
  for (let c = FIRST_DETAIL_COL; c <= LAST_DETAIL_COL; c++) after.push(ws.getRow(DETAIL_HEADER_ROW).getCell(c).value);
  console.log(`OK ${name}:`);
  console.log('  nagłówek 1:', after[0], '| 2:', after[1], '| ... | 41:', after[40], '| 42:', after[41]);
}

for (const t of ['pos-template.xlsx', 'db-template.xlsx']) {
  await fixTemplate(t);
}
