# Maszynka do prowizji — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikacja Electron (Win+Mac), która z dwóch plików źródłowych Excela generuje ~40 sformatowanych plików prowizyjnych 1:1 (po jednym na Organizację) i wysyła je sekwencyjnie mailem.

**Architecture:** Czysta logika (reader/engine/generator/config/mailer/csv/period) w osobnych modułach Node testowanych przez `node:test`, niezależnych od Electrona. Electron (main + preload + renderer) jest cienką powłoką: natywne dialogi plików, IPC, dwa okna (główne + konfiguracja). Pliki wyjściowe powstają przez klon szablonu `.xlsx` wyciętego z wzorca klienta → wierność 1:1.

**Tech Stack:** Electron, ExcelJS, nodemailer, Electron `safeStorage`, `node:test` (wbudowany), electron-builder (paczki).

---

## File Structure

```
Circus/
  package.json
  electron-builder.yml
  src/
    period.js        # 202604 -> "04.2026", wykrycie okresu
    csv.js           # parse CSV mapowania (Organizacja;SID;email)
    reader.js        # odczyt arkuszy źródłowych (ExcelJS) -> tablice wierszy
    engine.js        # grupowanie po Organizacji, dopasowanie szczegółów wg kanału
    generator.js     # klon szablonu + wstrzyknięcie danych + zapis (ExcelJS)
    config.js        # JSON config + safeStorage (wstrzykiwane zależności)
    mailer.js        # nodemailer, kolejka sekwencyjna z odstępem
    constants.js     # nazwy arkuszy, indeksy kolumn klucza/szczegółów
  templates/
    pos-template.xlsx
    db-template.xlsx
  scripts/
    build-templates.js   # buduje szablony z plików wzorcowych
  electron/
    main.js
    preload.js
    ipc.js           # rejestracja handlerów IPC (spina src/* z UI)
  renderer/
    index.html       # ekran główny
    config.html      # okno konfiguracji
    main.ui.js
    config.ui.js
    styles.css
  test/
    period.test.js
    csv.test.js
    reader.test.js
    engine.test.js
    generator.test.js
    config.test.js
    fixtures/        # małe .xlsx generowane w testach
  docs/superpowers/...
```

Mapowanie kolumn (zweryfikowane na wzorcach):
- **Szczegóły** (output, 42 kol.) = arkusz `dane do plików`, kolumny źródłowe **3..44** (`Nazwa Firmy` … `DO WYPŁATY`).
- **Klucz dopasowania** w `dane do plików`: kol. **1** = `SID POS` (kanał POS), kol. **2** = `SID Sprzed.` (kanał DB).
- **Podsumowanie POS** = `dane do plików POS *` (13 kol.), **DB** = `dane do plików DB *` (15 kol.). Kol. 1=Organizacja, 2=SID ID, 3=Nazwa, 4=KANAŁ.
- **Okres** = `dane do plików`, kol. **9** = `Okres Rozl.` (`202604`).

---

## Task 0: Inicjalizacja projektu

**Files:**
- Create: `package.json`, `.gitignore`, `src/constants.js`

- [ ] **Step 1: Init repo i package.json**

Run:
```bash
cd "ścieżka/do/projektu"
git init
npm init -y
npm pkg set type="module"
npm pkg set scripts.test="node --test"
npm install exceljs nodemailer
npm install --save-dev electron electron-builder
```

- [ ] **Step 2: .gitignore**

```
node_modules/
dist/
Prowizje/*.xlsx
!templates/*.xlsx
.DS_Store
```

- [ ] **Step 3: src/constants.js**

```javascript
export const SHEET = {
  DETAIL: 'dane do plików',          // w pliku Play_dealer
  SUMMARY_POS: 'dane do plików POS',  // prefiks
  SUMMARY_DB: 'dane do plików DB',    // prefiks
};

// kolumny 1-based w arkuszu 'dane do plików'
export const DETAIL_KEY_COL = { POS: 1, DB: 2 }; // SID POS / SID Sprzed.
export const DETAIL_FIRST_COL = 3;   // Nazwa Firmy
export const DETAIL_LAST_COL = 44;   // DO WYPŁATY  (42 kolumny)
export const PERIOD_COL = 9;         // Okres Rozl.

// kolumny w arkuszach podsumowań (POS i DB wspólne pierwsze 4)
export const SUMMARY = { ORG: 1, SID: 2, NAZWA: 3, KANAL: 4 };
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: init projekt maszynka-prowizji"
```

---

## Task 1: period.js — wykrycie i formatowanie okresu

**Files:**
- Create: `src/period.js`
- Test: `test/period.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod, detectPeriod } from '../src/period.js';

test('formatPeriod: 202604 -> 04.2026', () => {
  assert.equal(formatPeriod('202604'), '04.2026');
  assert.equal(formatPeriod(202604), '04.2026');
});

test('formatPeriod: błędny okres rzuca wyjątek', () => {
  assert.throws(() => formatPeriod('abc'));
});

test('detectPeriod: jeden okres', () => {
  assert.deepEqual(detectPeriod(['202604', '202604']), { period: '202604', multiple: false });
});

test('detectPeriod: wiele okresów zwraca flagę', () => {
  const r = detectPeriod(['202604', '202605']);
  assert.equal(r.multiple, true);
  assert.equal(r.period, '202604'); // najczęstszy/pierwszy
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/period.test.js`
Expected: FAIL ("Cannot find module ../src/period.js")

- [ ] **Step 3: Write minimal implementation**

```javascript
export function formatPeriod(yyyymm) {
  const s = String(yyyymm).trim();
  if (!/^\d{6}$/.test(s)) throw new Error(`Nieprawidłowy okres: ${yyyymm}`);
  return `${s.slice(4, 6)}.${s.slice(0, 4)}`;
}

export function detectPeriod(values) {
  const counts = new Map();
  for (const v of values) {
    const s = String(v).trim();
    if (/^\d{6}$/.test(s)) counts.set(s, (counts.get(s) || 0) + 1);
  }
  if (counts.size === 0) throw new Error('Brak prawidłowego okresu w danych');
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { period: sorted[0][0], multiple: counts.size > 1 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/period.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/period.js test/period.test.js && git commit -m "feat: period.js — wykrycie i format okresu"
```

---

## Task 2: csv.js — parser mapowania adresatów

**Files:**
- Create: `src/csv.js`
- Test: `test/csv.test.js`

Format: kolumny `Organizacja;SID;email`. Auto-wykrycie separatora `;` lub `,`. Pierwszy wiersz może być nagłówkiem (wykrycie po słowie "email"/"organizacja").

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMappingCsv } from '../src/csv.js';

test('parseMappingCsv: separator średnik + nagłówek', () => {
  const csv = 'Organizacja;SID;email\nFIRMA ALFA;D000111;ml@x.pl\n';
  assert.deepEqual(parseMappingCsv(csv), [
    { organizacja: 'FIRMA ALFA', sid: 'D000111', email: 'ml@x.pl' },
  ]);
});

test('parseMappingCsv: separator przecinek bez nagłówka', () => {
  const csv = 'FIRMA BETA,D000222399,m@x.pl';
  assert.deepEqual(parseMappingCsv(csv), [
    { organizacja: 'FIRMA BETA', sid: 'D000222399', email: 'm@x.pl' },
  ]);
});

test('parseMappingCsv: pomija puste linie i przycina spacje', () => {
  const csv = 'A;D1; a@x.pl \n\n B ;D2;b@x.pl\n';
  assert.equal(parseMappingCsv(csv).length, 2);
  assert.equal(parseMappingCsv(csv)[0].email, 'a@x.pl');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/csv.test.js`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Write minimal implementation**

```javascript
export function parseMappingCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const isHeader = /organizacja|email/i.test(lines[0]);
  const rows = isHeader ? lines.slice(1) : lines;
  return rows.map(line => {
    const [organizacja = '', sid = '', email = ''] = line.split(sep).map(c => c.trim());
    return { organizacja, sid, email };
  }).filter(r => r.email);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/csv.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/csv.js test/csv.test.js && git commit -m "feat: csv.js — parser mapowania adresatów"
```

---

## Task 3: reader.js — odczyt arkuszy źródłowych

**Files:**
- Create: `src/reader.js`, `test/reader.test.js`

`reader` zwraca surowe wiersze jako tablice (1-based dostęp przez indeks). Używamy ExcelJS streaming reader dla dużego pliku. Funkcje: `readSheetRows(path, sheetNameOrPrefix)` → `{ name, rows }` gdzie `rows` to tablica tablic (komórka [colIndex-1]).

- [ ] **Step 1: Write the failing test (buduje własny fixture przez ExcelJS)**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/reader.test.js`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Write minimal implementation**

```javascript
import ExcelJS from 'exceljs';

function cellValue(v) {
  if (v && typeof v === 'object') {
    if (v.text !== undefined) return v.text;          // rich text / hyperlink
    if (v.result !== undefined) return v.result;       // formuła
    if (v.error !== undefined) return null;
  }
  return v ?? null;
}

export async function findSheetByPrefix(path, prefix) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets.find(w => w.name.startsWith(prefix));
  return ws ? ws.name : null;
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
```

> Uwaga implementacyjna: dla pliku `Play_dealer` (~11MB) docelowo użyć `ExcelJS` z opcją
> `{ worksheets: 'emit', ... }` streaming readera, jeśli pełny odczyt jest za wolny. Najpierw
> zmierz na realnym pliku w Task 8; zwykła `readFile` zwykle wystarcza.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/reader.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/reader.js test/reader.test.js && git commit -m "feat: reader.js — odczyt arkuszy źródłowych"
```

---

## Task 4: engine.js — grupowanie i dopasowanie

**Files:**
- Create: `src/engine.js`, `test/engine.test.js`

Wejście: `summaryRows` (z POS lub DB, bez nagłówka), `detailRows` (z `dane do plików`, bez nagłówka), `kanal` ('POS'|'DB'). Wyjście: tablica obiektów `{ organizacja, kanal, ssummaries: [row...], details: [row...], sidy: [...], doWyplaty }` — po jednym na Organizację.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFiles } from '../src/engine.js';

// summary: [Organizacja, SID, Nazwa, KANAŁ, ...]
const summary = [
  ['FIRMA DELTA', 'D000475', 'Lesko', 'POS'],
  ['FIRMA DELTA', 'D000179', 'Sanok', 'POS'],
  ['FIRMA ALFA', 'D000111', 'Brzozów', 'POS'],
  ['FIRMA GAMMA', "D000444'", 'Turek', 'POS'], // apostrof -> brak szczegółów
];
// detail: kol1=SID POS, kol2=SID Sprzed., kol3.. = dane
const detail = [
  ['D000475', 'D000475001', 'firmaA', /*...*/],
  ['D000179', 'D000179001', 'firmaB'],
  ['D000111', 'D000111006', 'firmaC'],
  ['D000444', 'D000444028', 'firmaD'], // pasuje do MARTA, nie do D000444'
];

test('buildFiles: grupuje po Organizacji i scala SID-y', () => {
  const files = buildFiles(summary, detail, 'POS');
  const firmaDelta = files.find(f => f.organizacja === 'FIRMA DELTA');
  assert.deepEqual(firmaDelta.sidy, ['D000475', 'D000179']);
  assert.equal(firmaDelta.summaries.length, 2);
  assert.equal(firmaDelta.details.length, 2); // po jednym z każdego SID
});

test('buildFiles: apostrof daje pusty blok szczegółów', () => {
  const files = buildFiles(summary, detail, 'POS');
  const bartek = files.find(f => f.organizacja === 'FIRMA GAMMA');
  assert.equal(bartek.summaries.length, 1);
  assert.equal(bartek.details.length, 0);
});

test('buildFiles: DB dopasowuje po SID Sprzed. (kol2)', () => {
  const sum = [['FIRMA BETA', 'D000222399', 'x', 'DB']];
  const det = [['D000222', 'D000222399', 'firmaM'], ['D000222', 'D999', 'inny']];
  const files = buildFiles(sum, det, 'DB');
  assert.equal(files[0].details.length, 1);
  assert.equal(files[0].details[0][2], 'firmaM');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine.test.js`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Write minimal implementation**

```javascript
import { DETAIL_KEY_COL, SUMMARY } from './constants.js';

export function buildFiles(summaryRows, detailRows, kanal) {
  const keyCol = DETAIL_KEY_COL[kanal]; // 1 (POS) lub 2 (DB)
  // index szczegółów po kluczu (dokładny string)
  const byKey = new Map();
  for (const row of detailRows) {
    const k = String(row[keyCol - 1] ?? '');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(row);
  }
  // grupowanie podsumowań po Organizacji (dokładny string)
  const groups = new Map();
  for (const row of summaryRows) {
    const org = row[SUMMARY.ORG - 1];
    if (org == null || org === '') continue;
    if (!groups.has(org)) groups.set(org, []);
    groups.get(org).push(row);
  }
  const files = [];
  for (const [organizacja, summaries] of groups) {
    const sidy = summaries.map(r => String(r[SUMMARY.SID - 1] ?? ''));
    const details = [];
    for (const sid of sidy) {
      const matched = byKey.get(sid);   // dokładny match, z apostrofem
      if (matched) details.push(...matched);
    }
    files.push({ organizacja, kanal, sidy, summaries, details });
  }
  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine.js test/engine.test.js && git commit -m "feat: engine.js — grupowanie po Organizacji + dopasowanie wg kanału"
```

---

## Task 5: scripts/build-templates.js — szablony z wzorców

**Files:**
- Create: `scripts/build-templates.js`

Skrypt jednorazowy: z `Prowizje/FIRMA ALFA 04.2026.xlsx` (POS) i `Prowizje/FIRMA BETA 04.2026.xlsx` (DB) tworzy `templates/pos-template.xlsx` i `templates/db-template.xlsx`, zachowując style. Zostawia: wiersz 1 (nagłówki podsumowania), wiersz 2 (wzorcowy styl danych podsumowania), wiersz 5 (nagłówki szczegółów), wiersz 6 (wzorcowy styl danych szczegółów). Usuwa pozostałe wiersze danych. Zachowuje szerokości kolumn.

- [ ] **Step 1: Implementacja skryptu**

```javascript
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function buildTemplate(srcPath, outPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(srcPath);
  const ws = wb.worksheets[0];
  // zostaw wiersze 1,2,5,6 — usuń resztę danych (od 7 w górę oraz 3-4 puste zostają)
  const last = ws.rowCount;
  if (last > 6) ws.spliceRows(7, last - 6); // usuń wiersze 7..last
  // wiersze 3,4 zostawiamy puste (gap). wiersz 2 i 6 to wzorce stylu danych.
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
```

- [ ] **Step 2: Uruchom i zweryfikuj wizualnie**

Run:
```bash
mkdir -p templates && node scripts/build-templates.js
```
Expected: powstają `templates/pos-template.xlsx` i `templates/db-template.xlsx`.
Otwórz oba w Excelu/LibreOffice i potwierdź: nagłówki (fiolet), szerokości kolumn, format „zł" — zachowane; brak wierszy danych poza wzorcowym (wiersz 2 i 6).

- [ ] **Step 3: Commit**

```bash
git add scripts/build-templates.js templates/pos-template.xlsx templates/db-template.xlsx
git commit -m "feat: szablony POS/DB wycięte z wzorców (1:1)"
```

---

## Task 6: generator.js — generowanie pliku 1:1

**Files:**
- Create: `src/generator.js`, `test/generator.test.js`

`generateWorkbook(file, templatePath)` → ExcelJS Workbook. Klonuje szablon, wstawia
podsumowania od wiersza 2 (kopiując styl wiersza 2 szablonu), szczegóły od wiersza 6
(kopiując styl wiersza 6). `saveFile(file, templatePath, outPath)` zapisuje na dysk.

Reguła wstawiania wiersza ze stylem: dla i-tego wiersza danych użyj stylu wiersza wzorcowego;
dla wierszy ponad wzorzec — duplikuj styl wzorcowego wiersza komórka po komórce
(`cell.style = { ...styleRef }`, `cell.numFmt`, `cell.font`, `cell.fill`, `cell.alignment`, `cell.border`).

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWorkbook } from '../src/generator.js';

// mini-szablon: wiersz1 nagłówki summary, wiersz2 styl, wiersz5 nagłówki detail, wiersz6 styl
async function miniTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Arkusz1');
  ws.getRow(1).values = ['Organizacja', 'SID ID', 'Nazwa', 'KANAŁ', 'DO WYPŁATY'];
  ws.getRow(2).values = ['x', 'x', 'x', 'x', 0];
  ws.getCell('E2').numFmt = '#,##0.00 "zł"';
  ws.getRow(5).values = ['Nazwa Firmy', 'Nazwa Partnera'];
  ws.getRow(6).values = ['x', 'x'];
  const dir = mkdtempSync(join(tmpdir(), 'tpl-'));
  const p = join(dir, 'tpl.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

test('generateWorkbook: wstawia podsumowania i szczegóły', async () => {
  const tpl = await miniTemplate();
  const file = {
    organizacja: 'FirmaDelta', kanal: 'POS',
    summaries: [['FirmaDelta', 'D1', 'Lesko', 'POS', 100], ['FirmaDelta', 'D2', 'Sanok', 'POS', 200]],
    details: [['firmaA', 'p1'], ['firmaB', 'p2'], ['firmaC', 'p3']],
  };
  const wb = await generateWorkbook(file, tpl);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A2').value, 'FirmaDelta');
  assert.equal(ws.getCell('A3').value, 'FirmaDelta'); // drugi SID
  assert.equal(ws.getCell('E2').numFmt, '#,##0.00 "zł"'); // styl zachowany
  // szczegóły zaczynają się w wierszu 6
  assert.equal(ws.getCell('A6').value, 'firmaA');
  assert.equal(ws.getCell('A8').value, 'firmaC');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/generator.test.js`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Write minimal implementation**

```javascript
import ExcelJS from 'exceljs';

const SUMMARY_HEADER_ROW = 1;
const SUMMARY_FIRST_DATA_ROW = 2;
const DETAIL_HEADER_ROW = 5;
const DETAIL_FIRST_DATA_ROW = 6;

function copyRowStyle(srcRow, dstRow, width) {
  for (let c = 1; c <= width; c++) {
    const s = srcRow.getCell(c);
    const d = dstRow.getCell(c);
    d.style = { ...s.style };
  }
}

function writeBlock(ws, headerRowIdx, firstDataRow, dataRows) {
  const styleRow = ws.getRow(firstDataRow); // wzorcowy styl danych z szablonu
  const width = ws.getRow(headerRowIdx).cellCount || 1;
  // styl wzorcowy zachowujemy, kopiując go do każdego wiersza danych
  const refStyle = [];
  for (let c = 1; c <= width; c++) refStyle[c] = { ...styleRow.getCell(c).style };
  dataRows.forEach((data, i) => {
    const r = ws.getRow(firstDataRow + i);
    for (let c = 1; c <= Math.max(width, data.length); c++) {
      const cell = r.getCell(c);
      cell.value = data[c - 1] ?? null;
      if (refStyle[c]) cell.style = { ...refStyle[c] };
    }
    r.commit?.();
  });
}

export async function generateWorkbook(file, templatePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const ws = wb.worksheets[0];
  // szczegóły najpierw (niżej), bo wstawianie podsumowań może przesuwać wiersze gdy >1 SID
  // tutaj nie przesuwamy — piszemy wprost po indeksach, summary od 2, detail od 6.
  // Jeśli summary ma >1 wiersz, a to nachodzi na gap/detail header — wstaw wiersze.
  const extraSummary = Math.max(0, file.summaries.length - 1);
  if (extraSummary > 0) ws.spliceRows(SUMMARY_FIRST_DATA_ROW + 1, 0, ...Array.from({ length: extraSummary }, () => []));
  const detailHeader = DETAIL_HEADER_ROW + extraSummary;
  const detailFirst = DETAIL_FIRST_DATA_ROW + extraSummary;
  writeBlock(ws, SUMMARY_HEADER_ROW, SUMMARY_FIRST_DATA_ROW, file.summaries);
  writeBlock(ws, detailHeader, detailFirst, file.details);
  return wb;
}

export async function saveFile(file, templatePath, outPath) {
  const wb = await generateWorkbook(file, templatePath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}
```

> Uwaga: `spliceRows` z pustymi wierszami przesuwa nagłówek szczegółów i jego styl w dół,
> zachowując styl. Po wstawieniu kopiujemy styl wzorcowego wiersza danych do każdego wiersza.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/generator.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/generator.js test/generator.test.js && git commit -m "feat: generator.js — generowanie pliku ze stylem szablonu"
```

---

## Task 7: config.js — konfiguracja + mapowanie adresatów

**Files:**
- Create: `src/config.js`, `test/config.test.js`

Zależności wstrzykiwane (dla testowalności bez Electrona): `{ readFile, writeFile, encrypt, decrypt }`.
Struktura configu:
```
{ smtp: {host,port,secure,user,from, passwordEnc}, mail: {subject, body, footer, delaySeconds}, mapping: [{organizacja,sid,email}] }
```
Funkcje: `loadConfig(deps, path)`, `saveConfig(deps, path, cfg)`, `resolveRecipient(cfg, organizacja)` → `{ email } | { error }` (różne maile dla jednej org → error).

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipient, mergeMapping } from '../src/config.js';

const cfg = { mapping: [
  { organizacja: 'FIRMA ALFA', sid: 'D000111', email: 'ml@x.pl' },
  { organizacja: 'FirmaDelta', sid: 'D000475', email: 'p@x.pl' },
  { organizacja: 'FirmaDelta', sid: 'D000179', email: 'p@x.pl' },
  { organizacja: 'KONFLIKT', sid: 'A', email: 'a@x.pl' },
  { organizacja: 'KONFLIKT', sid: 'B', email: 'b@x.pl' },
]};

test('resolveRecipient: pojedynczy email', () => {
  assert.deepEqual(resolveRecipient(cfg, 'FIRMA ALFA'), { email: 'ml@x.pl' });
});

test('resolveRecipient: wiele SID, ten sam email', () => {
  assert.deepEqual(resolveRecipient(cfg, 'FirmaDelta'), { email: 'p@x.pl' });
});

test('resolveRecipient: konflikt maili', () => {
  assert.ok(resolveRecipient(cfg, 'KONFLIKT').error);
});

test('resolveRecipient: brak maila', () => {
  assert.ok(resolveRecipient(cfg, 'NIEMA').error);
});

test('mergeMapping: dokleja i nadpisuje po (organizacja,sid)', () => {
  const merged = mergeMapping(
    [{ organizacja: 'A', sid: 'D1', email: 'old@x.pl' }],
    [{ organizacja: 'A', sid: 'D1', email: 'new@x.pl' }, { organizacja: 'B', sid: 'D2', email: 'b@x.pl' }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find(m => m.sid === 'D1').email, 'new@x.pl');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Write minimal implementation**

```javascript
export function resolveRecipient(cfg, organizacja) {
  const entries = (cfg.mapping || []).filter(m => m.organizacja === organizacja && m.email);
  const emails = [...new Set(entries.map(m => m.email))];
  if (emails.length === 0) return { error: `Brak emaila dla: ${organizacja}` };
  if (emails.length > 1) return { error: `Różne maile dla: ${organizacja}` };
  return { email: emails[0] };
}

export function mergeMapping(existing, incoming) {
  const key = m => `${m.organizacja}||${m.sid}`;
  const map = new Map(existing.map(m => [key(m), m]));
  for (const m of incoming) map.set(key(m), m);
  return [...map.values()];
}

const DEFAULT = {
  smtp: { host: '', port: 587, secure: false, user: '', from: '', passwordEnc: null },
  mail: { subject: 'Prowizja {okres}', body: 'W załączniku rozliczenie prowizji dla {Organizacja} za {okres}.', footer: '', delaySeconds: 5 },
  mapping: [],
};

export async function loadConfig(deps, path) {
  let raw;
  try { raw = await deps.readFile(path, 'utf8'); } catch { return structuredClone(DEFAULT); }
  const cfg = { ...structuredClone(DEFAULT), ...JSON.parse(raw) };
  cfg.smtp.password = cfg.smtp.passwordEnc ? deps.decrypt(cfg.smtp.passwordEnc) : '';
  return cfg;
}

export async function saveConfig(deps, path, cfg) {
  const toSave = structuredClone(cfg);
  if (cfg.smtp?.password) toSave.smtp.passwordEnc = deps.encrypt(cfg.smtp.password);
  delete toSave.smtp.password;
  await deps.writeFile(path, JSON.stringify(toSave, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js && git commit -m "feat: config.js — konfiguracja, mapowanie, resolveRecipient"
```

---

## Task 8: mailer.js — wysyłka sekwencyjna z odstępem

**Files:**
- Create: `src/mailer.js`, `test/mailer.test.js`

Zależności wstrzykiwane: `{ createTransport, sleep }`. `sendBatch(deps, smtp, mail, jobs, onProgress)` gdzie
`jobs = [{ organizacja, email, attachmentPath, period }]`. Wysyła po kolei z odstępem `mail.delaySeconds`.
Podstawia `{Organizacja}` i `{okres}` w temacie/treści, dokleja stopkę. Zwraca `[{organizacja, ok, error}]`.

- [ ] **Step 1: Write the failing test (fake transport, sleep=noop)**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendBatch, renderTemplate } from '../src/mailer.js';

test('renderTemplate: podstawia zmienne i dokleja stopkę', () => {
  const out = renderTemplate('Cześć {Organizacja}, okres {okres}', 'STOPKA', { organizacja: 'ML', okres: '04.2026' });
  assert.equal(out, 'Cześć ML, okres 04.2026\n\nSTOPKA');
});

test('sendBatch: wysyła sekwencyjnie i raportuje', async () => {
  const sent = [];
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { sent.push(m.to); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [
    { organizacja: 'A', email: 'a@x.pl', attachmentPath: '/a.xlsx', period: '04.2026' },
    { organizacja: 'B', email: 'b@x.pl', attachmentPath: '/b.xlsx', period: '04.2026' },
  ];
  const res = await sendBatch(deps, { host: 'h' }, { subject: 'S {okres}', body: 'B {Organizacja}', footer: '', delaySeconds: 0 }, jobs);
  assert.deepEqual(sent, ['a@x.pl', 'b@x.pl']);
  assert.ok(res.every(r => r.ok));
});

test('sendBatch: błąd jednego nie blokuje reszty', async () => {
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { if (m.to === 'a@x.pl') throw new Error('boom'); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [{ organizacja: 'A', email: 'a@x.pl', attachmentPath: '/a', period: 'p' }, { organizacja: 'B', email: 'b@x.pl', attachmentPath: '/b', period: 'p' }];
  const res = await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 0 }, jobs);
  assert.equal(res[0].ok, false);
  assert.equal(res[1].ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mailer.test.js`
Expected: FAIL (brak modułu)

- [ ] **Step 3: Write minimal implementation**

```javascript
import { basename } from 'node:path';

export function renderTemplate(template, footer, vars) {
  let out = template
    .replaceAll('{Organizacja}', vars.organizacja ?? '')
    .replaceAll('{okres}', vars.okres ?? '');
  if (footer) out += `\n\n${footer}`;
  return out;
}

export async function sendBatch(deps, smtp, mail, jobs, onProgress = () => {}) {
  const transport = deps.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const vars = { organizacja: job.organizacja, okres: job.period };
    try {
      await transport.sendMail({
        from: smtp.from,
        to: job.email,
        subject: renderTemplate(mail.subject, '', vars),
        text: renderTemplate(mail.body, mail.footer, vars),
        attachments: [{ filename: basename(job.attachmentPath), path: job.attachmentPath }],
      });
      results.push({ organizacja: job.organizacja, ok: true });
    } catch (e) {
      results.push({ organizacja: job.organizacja, ok: false, error: e.message });
    }
    onProgress({ index: i + 1, total: jobs.length, last: results[i] });
    if (i < jobs.length - 1 && mail.delaySeconds > 0) await deps.sleep(mail.delaySeconds * 1000);
  }
  return results;
}

export async function verifySmtp(deps, smtp) {
  const t = deps.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined });
  await t.verify();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mailer.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mailer.js test/mailer.test.js && git commit -m "feat: mailer.js — wysyłka sekwencyjna z odstępem (antyspam)"
```

---

## Task 9: Test integracyjny na realnych plikach źródłowych

**Files:**
- Create: `test/integration.test.js`

Sprawdza pełny przepływ reader→engine→generator na PRAWDZIWYCH plikach z `Prowizje/`
i porównuje z wzorcem `FIRMA ALFA`. Test pomijany, jeśli plików nie ma (CI bez danych).

- [ ] **Step 1: Write the test**

```javascript
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

test('integracja: D000444 z apostrofem ma pusty blok', { skip: !hasData }, async () => {
  const detName = await findSheetByPrefix(PLAY, SHEET.DETAIL);
  const posName = await findSheetByPrefix(ANAL, SHEET.SUMMARY_POS);
  const { rows: detail } = await readSheetRows(PLAY, detName);
  const { rows: summary } = await readSheetRows(ANAL, posName);
  const files = buildFiles(summary.slice(1), detail.slice(1), 'POS');
  const bartek = files.find(f => f.organizacja === 'FIRMA GAMMA');
  assert.equal(bartek.details.length, 0);
});
```

- [ ] **Step 2: Run test**

Run: `node --test test/integration.test.js`
Expected: PASS (2 tests) — jeśli realne pliki są w `Prowizje/`. Zmierz czas odczytu dużego pliku; jeśli >~20s, wróć do Task 3 i włącz streaming reader.

- [ ] **Step 3: Wygeneruj realny plik i porównaj 1:1 wizualnie**

Run (skrypt ad-hoc):
```bash
node -e "
import('./src/reader.js').then(async R => {
  const E = await import('./src/engine.js');
  const G = await import('./src/generator.js');
  const C = await import('./src/constants.js');
  const PLAY='Prowizje/Play_dealer_za_okres_202604_2026-05-12-09-34-50 %.xlsx';
  const ANAL='Prowizje/Analiza-strumieni-prowizji-POS-DB-202604.xlsx';
  const dn=await R.findSheetByPrefix(PLAY,C.SHEET.DETAIL);
  const pn=await R.findSheetByPrefix(ANAL,C.SHEET.SUMMARY_POS);
  const {rows:det}=await R.readSheetRows(PLAY,dn);
  const {rows:sum}=await R.readSheetRows(ANAL,pn);
  const files=E.buildFiles(sum.slice(1),det.slice(1),'POS');
  const ml=files.find(f=>f.organizacja==='FIRMA ALFA');
  await G.saveFile(ml,'templates/pos-template.xlsx','/tmp/ML-test.xlsx');
  console.log('zapisano /tmp/ML-test.xlsx, szczegółów:', ml.details.length);
});
"
```
Otwórz `/tmp/ML-test.xlsx` obok wzorca `Prowizje/FIRMA ALFA 04.2026.xlsx`. Potwierdź wizualnie:
kolory nagłówków, format „zł", szerokości, wartości E2..M2 i bloku szczegółów — identyczne.
Jeśli coś się różni → popraw `generator.js`/`build-templates.js`, ponów.

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.js && git commit -m "test: integracja na realnych plikach + weryfikacja 1:1"
```

---

## Task 10: Electron — szkielet (main, preload, IPC)

**Files:**
- Create: `electron/main.js`, `electron/preload.js`, `electron/ipc.js`

IPC spina logikę `src/*` z UI. Hasło SMTP przez `safeStorage`. Config w `app.getPath('userData')/config.json`.

- [ ] **Step 1: electron/ipc.js — handlery**

```javascript
import { ipcMain, dialog, safeStorage, app } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { findSheetByPrefix, readSheetRows } from '../src/reader.js';
import { buildFiles } from '../src/engine.js';
import { saveFile } from '../src/generator.js';
import { loadConfig, saveConfig, resolveRecipient, mergeMapping } from '../src/config.js';
import { sendBatch, verifySmtp } from '../src/mailer.js';
import { parseMappingCsv } from '../src/csv.js';
import { detectPeriod, formatPeriod } from '../src/period.js';
import { SHEET, PERIOD_COL } from '../src/constants.js';

const CONFIG_PATH = () => join(app.getPath('userData'), 'config.json');
const TPL = (name) => join(app.getAppPath(), 'templates', name);
const cryptoDeps = {
  encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
  readFile, writeFile,
};

export function registerIpc() {
  ipcMain.handle('pick-file', async () => {
    const r = await dialog.showOpenDialog({ filters: [{ name: 'Excel', extensions: ['xlsx'] }], properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('config:load', async () => loadConfig(cryptoDeps, CONFIG_PATH()));
  ipcMain.handle('config:save', async (_e, cfg) => { await saveConfig(cryptoDeps, CONFIG_PATH(), cfg); return true; });
  ipcMain.handle('config:import-csv', async (_e, { text, existing }) => mergeMapping(existing || [], parseMappingCsv(text)));
  ipcMain.handle('smtp:test', async (_e, smtp) => {
    try { await verifySmtp({ createTransport: nodemailer.createTransport }, smtp); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('generate', async (_e, { playPath, analPath, outDir }) => {
    const detName = await findSheetByPrefix(playPath, SHEET.DETAIL);
    const posName = await findSheetByPrefix(analPath, SHEET.SUMMARY_POS);
    const dbName = await findSheetByPrefix(analPath, SHEET.SUMMARY_DB);
    const { rows: detail } = await readSheetRows(playPath, detName);
    const { rows: posSum } = await readSheetRows(analPath, posName);
    const { rows: dbSum } = await readSheetRows(analPath, dbName);
    const periodInfo = detectPeriod(detail.slice(1).map(r => r[PERIOD_COL - 1]).filter(Boolean));
    const period = formatPeriod(periodInfo.period);
    const files = [
      ...buildFiles(posSum.slice(1), detail.slice(1), 'POS'),
      ...buildFiles(dbSum.slice(1), detail.slice(1), 'DB'),
    ];
    const folder = join(outDir, `Prowizje ${period}`);
    await mkdir(folder, { recursive: true });
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    const out = [];
    for (const f of files) {
      const outPath = join(folder, `${f.organizacja} ${period}.xlsx`);
      await saveFile(f, TPL(f.kanal === 'POS' ? 'pos-template.xlsx' : 'db-template.xlsx'), outPath);
      const rec = resolveRecipient(cfg, f.organizacja);
      out.push({ organizacja: f.organizacja, kanal: f.kanal, sidy: f.sidy, path: outPath, email: rec.email || null, emailError: rec.error || null });
    }
    return { period, folder, files: out, multiplePeriods: periodInfo.multiple };
  });

  ipcMain.handle('send-all', async (e, { files, period }) => {
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    const jobs = files.map(f => ({ organizacja: f.organizacja, email: f.email, attachmentPath: f.path, period }));
    return sendBatch(
      { createTransport: nodemailer.createTransport, sleep: (ms) => new Promise(r => setTimeout(r, ms)) },
      { ...cfg.smtp }, cfg.mail, jobs,
      (p) => e.sender.send('send-progress', p),
    );
  });
}
```

- [ ] **Step 2: electron/preload.js**

```javascript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  importCsv: (text, existing) => ipcRenderer.invoke('config:import-csv', { text, existing }),
  testSmtp: (smtp) => ipcRenderer.invoke('smtp:test', smtp),
  generate: (args) => ipcRenderer.invoke('generate', args),
  sendAll: (args) => ipcRenderer.invoke('send-all', args),
  onSendProgress: (cb) => ipcRenderer.on('send-progress', (_e, p) => cb(p)),
});
```

- [ ] **Step 3: electron/main.js**

```javascript
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc } from './ipc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 720,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => { registerIpc(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 4: Dodaj skrypt startu**

Run:
```bash
npm pkg set main="electron/main.js"
npm pkg set scripts.start="electron ."
```

- [ ] **Step 5: Commit**

```bash
git add electron/ package.json && git commit -m "feat: szkielet Electron (main, preload, IPC)"
```

---

## Task 11: UI — ekran główny

**Files:**
- Create: `renderer/index.html`, `renderer/main.ui.js`, `renderer/styles.css`

Przepływ: 2 przyciski wyboru plików → przycisk folderu → „Generuj" → tabela wyników
(Organizacja | kanał | liczba SID | status email) → „Wyślij wszystkie" (aktywny tylko gdy
wszystkie maile OK) → pasek postępu wysyłki. Ikona ⚙ otwiera `config.html`.

- [ ] **Step 1: renderer/index.html**

```html
<!doctype html><html lang="pl"><head><meta charset="utf-8">
<link rel="stylesheet" href="styles.css"><title>Maszynka do prowizji</title></head>
<body>
  <header><h1>Maszynka do prowizji</h1><button id="cfg" title="Konfiguracja">⚙</button></header>
  <section class="pick">
    <button id="pickPlay">Wskaż plik Play_dealer</button><span id="playPath" class="path"></span>
    <button id="pickAnal">Wskaż plik Analiza</button><span id="analPath" class="path"></span>
    <button id="pickOut">Folder zapisu</button><span id="outPath" class="path"></span>
  </section>
  <section><button id="gen" disabled>Generuj pliki</button><span id="genStatus"></span></section>
  <table id="results"><thead><tr><th>Organizacja</th><th>Kanał</th><th>SID-y</th><th>Email</th></tr></thead><tbody></tbody></table>
  <section><button id="send" disabled>Wyślij wszystkie</button><progress id="prog" max="100" value="0" hidden></progress><span id="sendStatus"></span></section>
  <script src="main.ui.js"></script>
</body></html>
```

- [ ] **Step 2: renderer/main.ui.js**

```javascript
const state = { playPath: null, analPath: null, outPath: null, files: [], period: null };
const $ = (id) => document.getElementById(id);

function refreshGenButton() { $('gen').disabled = !(state.playPath && state.analPath && state.outPath); }

$('pickPlay').onclick = async () => { const p = await api.pickFile(); if (p) { state.playPath = p; $('playPath').textContent = p; refreshGenButton(); } };
$('pickAnal').onclick = async () => { const p = await api.pickFile(); if (p) { state.analPath = p; $('analPath').textContent = p; refreshGenButton(); } };
$('pickOut').onclick = async () => { const p = await api.pickFolder(); if (p) { state.outPath = p; $('outPath').textContent = p; refreshGenButton(); } };
$('cfg').onclick = () => { window.location.href = 'config.html'; };

$('gen').onclick = async () => {
  $('genStatus').textContent = 'Generuję...';
  const r = await api.generate({ playPath: state.playPath, analPath: state.analPath, outDir: state.outPath });
  state.files = r.files; state.period = r.period;
  $('genStatus').textContent = `Gotowe: ${r.files.length} plików → ${r.folder}` + (r.multiplePeriods ? ' ⚠ wiele okresów w danych!' : '');
  renderResults();
};

function renderResults() {
  const tb = $('results').querySelector('tbody');
  tb.innerHTML = '';
  let allOk = true;
  for (const f of state.files) {
    const tr = document.createElement('tr');
    const status = f.email ? `✓ ${f.email}` : `✗ ${f.emailError || 'brak emaila'}`;
    if (!f.email) { allOk = false; tr.classList.add('err'); }
    tr.innerHTML = `<td>${f.organizacja}</td><td>${f.kanal}</td><td>${f.sidy.join(', ')}</td><td>${status}</td>`;
    tb.appendChild(tr);
  }
  $('send').disabled = !allOk || state.files.length === 0;
  $('sendStatus').textContent = allOk ? '' : 'Uzupełnij brakujące maile w konfiguracji, aby wysłać.';
}

api.onSendProgress((p) => {
  $('prog').hidden = false; $('prog').value = Math.round((p.index / p.total) * 100);
  $('sendStatus').textContent = `Wysłano ${p.index}/${p.total} (${p.last.organizacja}: ${p.last.ok ? 'OK' : 'BŁĄD ' + p.last.error})`;
});

$('send').onclick = async () => {
  $('send').disabled = true;
  const res = await api.sendAll({ files: state.files, period: state.period });
  const fail = res.filter(r => !r.ok);
  $('sendStatus').textContent = fail.length ? `Zakończono z błędami: ${fail.length}` : 'Wysłano wszystkie ✓';
};
```

- [ ] **Step 3: renderer/styles.css**

```css
body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
header { display: flex; justify-content: space-between; align-items: center; }
header h1 { font-size: 20px; } #cfg { font-size: 22px; border: none; background: none; cursor: pointer; }
.pick { display: grid; grid-template-columns: 200px 1fr; gap: 8px; align-items: center; margin: 12px 0; }
.path { color: #555; font-size: 12px; word-break: break-all; }
button { padding: 8px 14px; cursor: pointer; } button:disabled { opacity: .5; cursor: not-allowed; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #ddd; padding: 6px; text-align: left; font-size: 13px; }
tr.err td { background: #fde8e8; }
```

- [ ] **Step 4: Uruchom i przetestuj ręcznie**

Run: `npm start`
Expected: okno się otwiera; wybór 3 ścieżek aktywuje „Generuj"; generowanie tworzy pliki
i tabelę; „Wyślij wszystkie" zablokowane gdy brak maili.

- [ ] **Step 5: Commit**

```bash
git add renderer/ && git commit -m "feat: UI ekran główny (wybór plików, generowanie, lista, wysyłka)"
```

---

## Task 12: UI — okno konfiguracji

**Files:**
- Create: `renderer/config.html`, `renderer/config.ui.js`

Pola SMTP + „Testuj połączenie", szablon maila (temat/treść/stopka) + odstęp, mapowanie
(import CSV + dodawanie pojedynczo + lista z usuwaniem). Zapis przez `api.saveConfig`.

- [ ] **Step 1: renderer/config.html**

```html
<!doctype html><html lang="pl"><head><meta charset="utf-8">
<link rel="stylesheet" href="styles.css"><title>Konfiguracja</title></head>
<body>
  <header><h1>Konfiguracja</h1><button id="back">← Powrót</button></header>
  <h2>Konto SMTP</h2>
  <div class="form">
    <label>Host <input id="host"></label><label>Port <input id="port" type="number"></label>
    <label>Szyfrowanie <select id="secure"><option value="false">STARTTLS/none</option><option value="true">SSL/TLS</option></select></label>
    <label>Login <input id="user"></label><label>Hasło <input id="password" type="password"></label>
    <label>Nadawca <input id="from"></label>
    <button id="testSmtp">Testuj połączenie</button><span id="smtpStatus"></span>
  </div>
  <h2>Szablon maila</h2>
  <div class="form">
    <label>Temat <input id="subject"></label>
    <label>Treść <textarea id="body" rows="4"></textarea></label>
    <label>Stopka <textarea id="footer" rows="3"></textarea></label>
    <label>Odstęp między mailami (s) <input id="delay" type="number" min="0"></label>
    <small>Zmienne: {Organizacja}, {okres}</small>
  </div>
  <h2>Mapowanie adresatów</h2>
  <div class="form">
    <button id="importCsv">Importuj CSV</button>
    <span>Dodaj: </span>
    <input id="mOrg" placeholder="Organizacja"><input id="mSid" placeholder="SID"><input id="mEmail" placeholder="email">
    <button id="addMap">Dodaj</button>
  </div>
  <table id="mapTable"><thead><tr><th>Organizacja</th><th>SID</th><th>Email</th><th></th></tr></thead><tbody></tbody></table>
  <input id="csvFile" type="file" accept=".csv" hidden>
  <section><button id="save">Zapisz</button><span id="saveStatus"></span></section>
  <script src="config.ui.js"></script>
</body></html>
```

- [ ] **Step 2: renderer/config.ui.js**

```javascript
const $ = (id) => document.getElementById(id);
let cfg = { smtp: {}, mail: {}, mapping: [] };

(async () => {
  cfg = await api.loadConfig();
  $('host').value = cfg.smtp.host || ''; $('port').value = cfg.smtp.port || 587;
  $('secure').value = String(!!cfg.smtp.secure); $('user').value = cfg.smtp.user || '';
  $('password').value = cfg.smtp.password || ''; $('from').value = cfg.smtp.from || '';
  $('subject').value = cfg.mail.subject || ''; $('body').value = cfg.mail.body || '';
  $('footer').value = cfg.mail.footer || ''; $('delay').value = cfg.mail.delaySeconds ?? 5;
  renderMap();
})();

function renderMap() {
  const tb = $('mapTable').querySelector('tbody'); tb.innerHTML = '';
  cfg.mapping.forEach((m, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.organizacja}</td><td>${m.sid}</td><td>${m.email}</td><td><button data-i="${i}">usuń</button></td>`;
    tr.querySelector('button').onclick = () => { cfg.mapping.splice(i, 1); renderMap(); };
    tb.appendChild(tr);
  });
}

$('addMap').onclick = () => {
  const m = { organizacja: $('mOrg').value.trim(), sid: $('mSid').value.trim(), email: $('mEmail').value.trim() };
  if (m.email) { cfg.mapping.push(m); $('mOrg').value = $('mSid').value = $('mEmail').value = ''; renderMap(); }
};
$('importCsv').onclick = () => $('csvFile').click();
$('csvFile').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();
  cfg.mapping = await api.importCsv(text, cfg.mapping);
  renderMap();
};
$('testSmtp').onclick = async () => {
  const smtp = collectSmtp();
  $('smtpStatus').textContent = 'Testuję...';
  const r = await api.testSmtp(smtp);
  $('smtpStatus').textContent = r.ok ? '✓ połączenie OK' : '✗ ' + r.error;
};
function collectSmtp() {
  return { host: $('host').value, port: Number($('port').value), secure: $('secure').value === 'true',
    user: $('user').value, password: $('password').value, from: $('from').value };
}
$('save').onclick = async () => {
  cfg.smtp = { ...cfg.smtp, ...collectSmtp() };
  cfg.mail = { subject: $('subject').value, body: $('body').value, footer: $('footer').value, delaySeconds: Number($('delay').value) };
  await api.saveConfig(cfg);
  $('saveStatus').textContent = 'Zapisano ✓';
};
$('back').onclick = () => { window.location.href = 'index.html'; };
```

- [ ] **Step 3: Uruchom i przetestuj ręcznie**

Run: `npm start` → ⚙ → uzupełnij SMTP, „Testuj połączenie", dodaj wpis mapowania, zaimportuj
CSV, Zapisz, Powrót, ⚙ ponownie → dane się utrzymały. Hasło zapisane szyfrowane (sprawdź,
że `config.json` nie zawiera jawnego hasła, tylko `passwordEnc`).

- [ ] **Step 4: Commit**

```bash
git add renderer/config.html renderer/config.ui.js && git commit -m "feat: UI okno konfiguracji (SMTP, szablon, mapowanie)"
```

---

## Task 13: Budowanie paczek (Win + Mac)

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: electron-builder.yml**

```yaml
appId: pl.rsholding.maszynka-prowizji
productName: Maszynka do prowizji
files:
  - electron/**
  - renderer/**
  - src/**
  - templates/**
  - package.json
extraResources:
  - templates/**
mac:
  target: dmg
  category: public.app-category.business
win:
  target: nsis
```

- [ ] **Step 2: Skrypty build**

Run:
```bash
npm pkg set scripts.dist="electron-builder"
npm pkg set scripts.dist:mac="electron-builder --mac"
npm pkg set scripts.dist:win="electron-builder --win"
```

- [ ] **Step 3: Zbuduj dla bieżącej platformy**

Run: `npm run dist`
Expected: w `dist/` powstaje instalator (.dmg na macOS). Zainstaluj, uruchom, przejdź pełny
przepływ na realnych plikach. (Build .exe pod Windows wykonać na maszynie Windows lub w CI.)

> Uwaga ścieżek: w paczce szablony są w `process.resourcesPath/templates`. Jeśli `app.getAppPath()`
> nie wskazuje szablonów w paczce, w `ipc.js` zmień `TPL` na:
> `app.isPackaged ? join(process.resourcesPath, 'templates', name) : join(app.getAppPath(), 'templates', name)`.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml package.json && git commit -m "build: paczki Electron (dmg/nsis) + ścieżka szablonów w paczce"
```

---

## Self-Review (wykonane)

- **Spec coverage:** stack (T0,T10,T13) ✓; reader (T3) ✓; engine: grupowanie/kanał/apostrof/okres (T1,T4,T9) ✓; generator 1:1 + stos + szablony (T5,T6,T9) ✓; config SMTP+safeStorage (T7,T10,T12) ✓; mapowanie CSV+pojedynczo (T2,T7,T12) ✓; resolveRecipient/konflikt (T7) ✓; wysyłka sekwencyjna+blokada braków (T8,T11) ✓; UX (T11,T12) ✓; nazwa pliku+podfolder (T10) ✓.
- **Placeholder scan:** brak TODO/TBD; każdy krok kodu ma pełny kod.
- **Type consistency:** kształt `file` (`{organizacja,kanal,sidy,summaries,details}`) spójny T4→T6→T10; `job` (`{organizacja,email,attachmentPath,period}`) spójny T8↔T10; deps config (`{readFile,writeFile,encrypt,decrypt}`) spójne T7↔T10.
- **Otwarte do potwierdzenia przy implementacji:** wydajność odczytu 11MB (T3/T9 — ewentualny streaming); wizualne 1:1 scalonego pliku (brak wzorca) — T9.
