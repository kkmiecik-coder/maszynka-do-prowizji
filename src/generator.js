import ExcelJS from 'exceljs';
import { DETAIL_FIRST_COL, DETAIL_LAST_COL } from './constants.js';

const SUMMARY_HEADER_ROW = 1;
const SUMMARY_FIRST_DATA_ROW = 2;
const DETAIL_HEADER_ROW = 5;
const DETAIL_FIRST_DATA_ROW = 6;

function deepStyleCopy(s) { return JSON.parse(JSON.stringify(s)); }

function writeBlock(ws, headerRowIdx, firstDataRow, dataRows) {
  const styleRow = ws.getRow(firstDataRow); // wzorcowy styl danych z szablonu
  const width = ws.getRow(headerRowIdx).cellCount || 1;
  const refStyle = [];
  // głęboka kopia stylu wzorcowego, by żadne dwie komórki nie współdzieliły zagnieżdżonych obiektów
  for (let c = 1; c <= width; c++) refStyle[c] = deepStyleCopy(styleRow.getCell(c).style);
  dataRows.forEach((data, i) => {
    const r = ws.getRow(firstDataRow + i);
    for (let c = 1; c <= Math.max(width, data.length); c++) {
      const cell = r.getCell(c);
      cell.value = data[c - 1] ?? null;
      if (refStyle[c]) cell.style = deepStyleCopy(refStyle[c]); // niezależna kopia na komórkę
    }
    r.commit?.();
  });
}

export async function generateWorkbook(file, templatePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const ws = wb.worksheets[0];
  const extraSummary = Math.max(0, file.summaries.length - 1);
  if (extraSummary > 0) {
    ws.spliceRows(SUMMARY_FIRST_DATA_ROW + 1, 0, ...Array.from({ length: extraSummary }, () => []));
  }
  const detailHeader = DETAIL_HEADER_ROW + extraSummary;
  const detailFirst = DETAIL_FIRST_DATA_ROW + extraSummary;
  writeBlock(ws, SUMMARY_HEADER_ROW, SUMMARY_FIRST_DATA_ROW, file.summaries);
  // Slice detail rows to output columns only: drop key cols 1-2 (SID POS, SID Sprzed.)
  // and stop at DETAIL_LAST_COL, keeping only the 42 columns that appear in the output.
  const detailOut = file.details.map(r => r.slice(DETAIL_FIRST_COL - 1, DETAIL_LAST_COL));
  writeBlock(ws, detailHeader, detailFirst, detailOut);
  return wb;
}

export async function saveFile(file, templatePath, outPath) {
  const wb = await generateWorkbook(file, templatePath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}
