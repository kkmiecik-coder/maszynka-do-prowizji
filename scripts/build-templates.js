import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function buildTemplate(srcPath, outPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(srcPath);
  const ws = wb.worksheets[0];
  // Obejście błędu ExcelJS spliceRows: dla usuwania "do końca" (count >= nEnd-start)
  // pętla przesuwająca wiersze nigdy się nie wykonuje, więc nic nie jest usuwane (no-op).
  // Usuwamy więc bezpośrednio z prywatnego _rows — OK dla jednorazowego skryptu budującego.
  if (ws._rows.length > 6) ws._rows.splice(6, ws._rows.length - 6);
  await wb.xlsx.writeFile(outPath);
  console.log('zapisano', outPath);
}

await buildTemplate(
  join(root, 'Prowizje/FIRMA ALFA 04.2026.xlsx'),
  join(root, 'templates/pos-template.xlsx'),
);
await buildTemplate(
  join(root, 'Prowizje/FIRMA BETA 04.2026.xlsx'),
  join(root, 'templates/db-template.xlsx'),
);
