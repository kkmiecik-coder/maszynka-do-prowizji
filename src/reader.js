import ExcelJS from 'exceljs';

function cellValue(v) {
  if (v && typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(p => p.text).join('');
    if (v.text !== undefined) return v.text;        // hyperlink {text, hyperlink}
    if (v.result !== undefined) return v.result;    // formuła {formula, result}
    if (v.error !== undefined) return null;         // błąd {error}
  }
  return v ?? null;
}

export async function findSheetByPrefix(path, prefix) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets.find(w => w.name.startsWith(prefix));
  return ws ? ws.name : null;
}

// Nagłówki każdego arkusza — do walidacji struktury pliku.
// Czytamy wiersz 1 (typowe nagłówki) ORAZ wiersz 3 (surowa zakładka "dane"
// Play_dealer trzyma tam nagłówki — wiersze 1-2 są puste).
export async function readAllHeaders(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb.worksheets.map((ws) => {
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellValue(cell.value); });
    const headersRow3 = [];
    ws.getRow(3).eachCell({ includeEmpty: true }, (cell, col) => { headersRow3[col - 1] = cellValue(cell.value); });
    return { name: ws.name, headers, headersRow3 };
  });
}

export async function readSheetRows(path, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Brak arkusza: ${sheetName}`);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { arr[col - 1] = cellValue(cell.value); });
    rows.push(arr);
  });
  return { name: ws.name, rows };
}
