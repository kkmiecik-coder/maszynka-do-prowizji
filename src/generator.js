import ExcelJS from 'exceljs';
import { buildDetailPlan, normHeader } from './columns.js';

const SUMMARY_HEADER_ROW = 1;
const SUMMARY_FIRST_DATA_ROW = 2;
const DETAIL_HEADER_ROW = 5;
const DETAIL_FIRST_DATA_ROW = 6;

function deepStyleCopy(s) { return JSON.parse(JSON.stringify(s)); }

// Zapis bloku o STAŁYM układzie kolumn (górny blok: podsumowania).
// Kopiuje styl wzorcowego wiersza danych z szablonu per pozycja.
function writeBlock(ws, headerRowIdx, firstDataRow, dataRows) {
  const styleRow = ws.getRow(firstDataRow); // wzorcowy styl danych z szablonu
  const width = ws.getRow(headerRowIdx).cellCount || 1;
  const refStyle = [];
  for (let c = 1; c <= width; c++) refStyle[c] = deepStyleCopy(styleRow.getCell(c).style);
  dataRows.forEach((data, i) => {
    const r = ws.getRow(firstDataRow + i);
    for (let c = 1; c <= Math.max(width, data.length); c++) {
      const cell = r.getCell(c);
      cell.value = data[c - 1] ?? null;
      if (refStyle[c]) cell.style = deepStyleCopy(refStyle[c]);
    }
    r.commit?.();
  });
}

// Buduje bank stylów per NAZWA nagłówka z szablonu: { norm(nazwa) -> { header, data } }.
// header = styl komórki nagłówka (wiersz 5), data = styl komórki danych (wiersz 6).
// Dzięki temu styl trafia na właściwą kolumnę niezależnie od jej pozycji.
function templateStyleByName(ws, headerRowIdx, dataRowIdx) {
  const width = ws.getRow(headerRowIdx).cellCount || 1;
  const headerRow = ws.getRow(headerRowIdx);
  const dataRow = ws.getRow(dataRowIdx);
  const byName = new Map();
  let firstHeader = null, firstData = null;
  for (let c = 1; c <= width; c++) {
    const name = headerRow.getCell(c).value;
    const hStyle = deepStyleCopy(headerRow.getCell(c).style);
    const dStyle = deepStyleCopy(dataRow.getCell(c).style);
    if (firstHeader == null) { firstHeader = hStyle; firstData = dStyle; }
    if (name != null && name !== '') byName.set(normHeader(name), { header: hStyle, data: dStyle });
  }
  // Fallback (np. kolumna "Nazwa Partnera" nieobecna w szablonie) — styl pierwszej kolumny.
  return { byName, fallback: { header: firstHeader, data: firstData } };
}

// Zapis bloku szczegółów o DYNAMICZNYM układzie kolumn (zależnym od źródła danego okresu).
// Nagłówki wpisywane z planu (nazwy ze źródła), styl kotwiczony po nazwie ze szablonu,
// numFmt wymuszany z planu (waluta/data) niezależnie od pozycji.
function writeDetailBlock(ws, headerRowIdx, firstDataRow, plan, detailRows) {
  const styles = templateStyleByName(ws, headerRowIdx, firstDataRow);
  const refByCol = plan.columns.map((col) => styles.byName.get(normHeader(col.name)) || styles.fallback);

  // Nagłówki szczegółów — dynamicznie z planu.
  const hRow = ws.getRow(headerRowIdx);
  plan.columns.forEach((col, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = col.name;
    cell.style = deepStyleCopy(refByCol[i].header);
  });
  // Wyczyść ewentualne nadmiarowe kolumny nagłówka z szablonu (gdy szablon ma ich więcej).
  const oldWidth = ws.getRow(headerRowIdx).cellCount || 0;
  for (let c = plan.columns.length + 1; c <= oldWidth; c++) {
    const cell = hRow.getCell(c);
    cell.value = null;
    cell.style = {};
  }
  hRow.commit?.();

  // Wiersze danych — wartości po srcIndex, styl per-nazwa, numFmt wymuszony.
  detailRows.forEach((srcRow, ri) => {
    const r = ws.getRow(firstDataRow + ri);
    plan.columns.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      cell.value = srcRow[col.srcIndex] ?? null;
      cell.style = deepStyleCopy(refByCol[i].data);
      if (col.numFmt) cell.numFmt = col.numFmt; // wymuś walutę/datę po nazwie
    });
    for (let c = plan.columns.length + 1; c <= oldWidth; c++) {
      const cell = r.getCell(c);
      cell.value = null;
      cell.style = {};
    }
    r.commit?.();
  });
}

// detailHeader — tablica nagłówków arkusza źródła "dane do plików" (wiersz nagłówkowy).
export async function generateWorkbook(file, templatePath, detailHeader) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const ws = wb.worksheets[0];
  const plan = buildDetailPlan(detailHeader || []);

  const extraSummary = Math.max(0, file.summaries.length - 1);
  if (extraSummary > 0) {
    ws.spliceRows(SUMMARY_FIRST_DATA_ROW + 1, 0, ...Array.from({ length: extraSummary }, () => []));
  }
  const detailHeaderRow = DETAIL_HEADER_ROW + extraSummary;
  const detailFirstRow = DETAIL_FIRST_DATA_ROW + extraSummary;

  // Górny blok (podsumowania) — stały układ, bez zmian.
  writeBlock(ws, SUMMARY_HEADER_ROW, SUMMARY_FIRST_DATA_ROW, file.summaries);
  // Dolny blok (szczegóły) — dynamiczny układ wg nagłówka źródła.
  writeDetailBlock(ws, detailHeaderRow, detailFirstRow, plan, file.details);
  return wb;
}

export async function saveFile(file, templatePath, outPath, detailHeader) {
  const wb = await generateWorkbook(file, templatePath, detailHeader);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}
