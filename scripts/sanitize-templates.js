// Jednorazowa anonimizacja szablonów przed upublicznieniem repozytorium.
// Pliki templates/*.xlsx to realne pliki-wzorce klienta i zawierają PRAWDZIWE
// dane (nazwiska, SID-y, numery umów/telefonów, kwoty). Repo ma być publiczne,
// więc podmieniamy wartości przykładowe (wiersz 2 = podsumowanie, wiersz 6 =
// szczegóły) na fikcyjne — ZACHOWUJĄC formatowanie/styl/numFmt każdej komórki
// (generator.js używa stylu wiersza 6 jako wzorca, więc styl jest nietykalny).
//
// Podmieniamy tylko .value; .style, .numFmt, szerokości kolumn, nagłówki — bez zmian.
// Liczby zostają liczbami, daty datami, teksty tekstami (typy muszą się zgadzać).
//
// Uruchom: node scripts/sanitize-templates.js
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(__dirname, '..', 'templates');

// Anonimowe wartości wg pozycji kolumny (1-based) dla wiersza PODSUMOWANIA (r2).
// Klucz = numer kolumny; brak klucza = komórkę zostawiamy bez zmian.
const SUMMARY_TEXT = {
  1: 'PRZYKŁADOWA FIRMA',     // Organizacja
  2: 'D000000',               // SID ID
  3: 'Przykładowa Nazwa',     // Nazwa
  // 4: KANAŁ (POS/DB) — zostawiamy, to nie dane osobowe
};

// Anonimowe wartości dla wiersza SZCZEGÓŁÓW (r6).
const DETAIL_TEXT = {
  1: 'PRZYKŁADOWA FIRMA',     // Nazwa Firmy
  // 2: Nazwa Prowizji, 3: Typ Usługi — generyczne, zostawiamy
  8: 'UM00/D000000000/000000000', // Nr Kontraktu
  10: '000000000',            // MSISDN (telefon!)
  11: '480000000000',         // MSISDN (telefon!) — w DB to kol.11
  14: 'D000',                 // SID Dealer
  15: 'D000000',              // SID POS
  16: 'D000000000',           // SID Sprzed. (w r6 pos: 16=Franczyza? — patrz niżej)
};

// Telefony/identyfikatory numeryczne, które trzeba wyzerować bez zmiany typu.
// (numery wpisane jako liczby — zostawiamy jako liczby = 0)
const ZERO_IF_NUMBER = new Set([9, 13]); // ID Rekordu / Nr Zamówienia itp.

function sanitizeRow(ws, rowIdx, textMap) {
  const row = ws.getRow(rowIdx);
  for (let c = 1; c <= 44; c++) {
    const cell = row.getCell(c);
    const v = cell.value;
    if (v === null || v === undefined || v === '') continue;

    if (Object.prototype.hasOwnProperty.call(textMap, c)) {
      cell.value = textMap[c];
      continue;
    }
    // Liczby = wartości pieniężne/identyfikatory → zerujemy (typ liczbowy zachowany,
    // numFmt waluty nadal działa). Kanał/typ jako tekst zostają.
    if (typeof v === 'number') {
      cell.value = ZERO_IF_NUMBER.has(c) ? 0 : 0;
    }
    // Tekstowe identyfikatory wyglądające na numery umów/SID — podmieniamy ostrożnie.
    else if (typeof v === 'string' && /\d{4,}/.test(v) && !textMap[c]) {
      cell.value = '000000';
    }
    // Daty: ujednolicamy na neutralną datę, zachowując typ Date.
    else if (v instanceof Date) {
      cell.value = new Date('2026-01-01T00:00:00.000Z');
    }
  }
  row.commit?.();
}

async function sanitize(name) {
  const path = join(TPL_DIR, name);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  sanitizeRow(ws, 2, SUMMARY_TEXT);  // podsumowanie
  sanitizeRow(ws, 6, DETAIL_TEXT);   // szczegóły (wzorzec stylu — tylko .value!)
  await wb.xlsx.writeFile(path);
  console.log(`OK ${name}: r2 i r6 zanonimizowane (style/numFmt zachowane)`);
}

for (const t of ['pos-template.xlsx', 'db-template.xlsx']) {
  await sanitize(t);
}
