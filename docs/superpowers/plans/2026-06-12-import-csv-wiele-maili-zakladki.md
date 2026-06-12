# Import CSV + wiele maili + zakładki konfiguracji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poprawić import CSV (kodowanie cp1250/UTF-8, wiele wartości w komórce), umożliwić wiele maili na organizację (osobna wiadomość do każdego), i podzielić konfigurację na zakładki.

**Architecture:** Czysta logika w `src/` (testowalna, bez Electrona) → `electron/ipc.js`+`preload.cjs` jako warstwa IO → `renderer/` UI. Model adresata pliku zmienia się z `email: string|null` na `emails: string[]`. Import CSV przekazuje surowe bajty z renderera, backend wykrywa kodowanie i rozbija komórki na płaskie wiersze mapowania.

**Tech Stack:** Node 18+ ESM, `node:test`, Electron, ExcelJS, nodemailer, `TextDecoder` (globalny w Node 18+).

Spec: `docs/superpowers/specs/2026-06-12-import-csv-wiele-maili-zakladki-design.md`

---

## Task 1: `src/encoding.js` — wykrywanie kodowania CSV

**Files:**
- Create: `src/encoding.js`
- Test: `test/encoding.test.js`

- [ ] **Step 1: Napisz failujący test**

`test/encoding.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsvBytes } from '../src/encoding.js';

test('decodeCsvBytes: UTF-8 z BOM — obcina BOM i dekoduje', () => {
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const body = Buffer.from('Łódź żółć;D1;a@x.pl', 'utf8');
  assert.equal(decodeCsvBytes(Buffer.concat([bom, body])), 'Łódź żółć;D1;a@x.pl');
});

test('decodeCsvBytes: czysty UTF-8 (bez BOM) z polskimi znakami', () => {
  const bytes = Buffer.from('Rafał Dłużniewski;D1;r@x.pl', 'utf8');
  assert.equal(decodeCsvBytes(bytes), 'Rafał Dłużniewski;D1;r@x.pl');
});

test('decodeCsvBytes: Windows-1250 (Excel "CSV") z polskimi znakami', () => {
  // "Rafał Dłużniewski" zakodowane w cp1250
  const cp1250 = Buffer.from([
    0x52, 0x61, 0x66, 0x61, 0xB3, 0x20, // "Rafał "  (ł = 0xB3)
    0x44, 0xB3, 0x75, 0xBF, 0x6E, 0x69, 0x65, 0x77, 0x73, 0x6B, 0x69, // "Dłużniewski" (ł=0xB3, ż=0xBF)
  ]);
  assert.equal(decodeCsvBytes(cp1250), 'Rafał Dłużniewski');
});

test('decodeCsvBytes: akceptuje Uint8Array, nie tylko Buffer', () => {
  const bytes = new Uint8Array(Buffer.from('Test ąć;D1;a@x.pl', 'utf8'));
  assert.equal(decodeCsvBytes(bytes), 'Test ąć;D1;a@x.pl');
});
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `node --test test/encoding.test.js`
Expected: FAIL — `Cannot find module '../src/encoding.js'`

- [ ] **Step 3: Zaimplementuj `src/encoding.js`**

```js
// Wykrywanie kodowania pliku CSV z Excela. Excel zapisuje "CSV" w Windows-1250
// (polski Windows), a "CSV UTF-8" w UTF-8 (opcjonalnie z BOM). Czytamy surowe
// bajty i dobieramy dekoder, żeby polskie znaki nie zamieniały się w "�".
export function decodeCsvBytes(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  // 1) UTF-8 BOM (EF BB BF) → UTF-8 bez BOM.
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  // 2) Spróbuj UTF-8 strict — jeśli bajty są poprawnym UTF-8, to jest UTF-8.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 3) Niepoprawny UTF-8 → to Windows-1250 (Excel "CSV").
    return new TextDecoder('windows-1250').decode(buf);
  }
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `node --test test/encoding.test.js`
Expected: PASS (4 testy)

- [ ] **Step 5: Commit**

```bash
git add src/encoding.js test/encoding.test.js
git commit -m "feat: encoding.js — autodetekcja kodowania CSV (UTF-8 BOM / UTF-8 / Windows-1250)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `src/csv.js` — rozbijanie komórek SID i e-mail

**Files:**
- Modify: `src/csv.js` (całość)
- Test: `test/csv.test.js` (dopisz testy, zachowaj zgodne istniejące)

- [ ] **Step 1: Napisz failujące testy**

Dopisz do `test/csv.test.js` (po istniejących testach):
```js
test('parseMappingCsv: wiele SID w jednej komórce → osobne wiersze', () => {
  const csv = 'Rafał;D001791, D001780;rafal@x.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.sid).sort(), ['D001780', 'D001791']);
  assert.ok(rows.every(r => r.email === 'rafal@x.pl'));
  assert.ok(rows.every(r => r.organizacja === 'Rafał'));
});

test('parseMappingCsv: wiele maili w jednej komórce → osobne wiersze', () => {
  const csv = 'MW Office;D100;magda@x.pl, kamil@x.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.email).sort(), ['kamil@x.pl', 'magda@x.pl']);
  assert.ok(rows.every(r => r.sid === 'D100'));
});

test('parseMappingCsv: iloczyn kartezjański SID × mail', () => {
  const csv = 'Org;D1, D2;a@x.pl, b@x.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 4); // 2 SID × 2 maile
});

test('parseMappingCsv: separator ; gdy przecinki są wewnątrz komórek', () => {
  // Linia z pliku klienta: org;SID-y-po-przecinku;mail
  const csv = 'Mtell sp. j.;D003033385, D003033427, D003033434; pc@mtell.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.email === 'pc@mtell.pl'));
  assert.ok(rows.every(r => r.organizacja === 'Mtell sp. j.'));
});

test('parseMappingCsv: wiersz bez poprawnego maila jest pomijany', () => {
  const csv = 'Org;D1;niepoprawny-bez-malpy';
  assert.equal(parseMappingCsv(csv).length, 0);
});
```

Zmień też istniejący test „organizacja zawierająca słowo email" — pozostaje aktualny (1 wiersz). Istniejące testy (separator ;, separator , bez nagłówka, puste linie) muszą nadal przechodzić — każdy ma 1 SID i 1 mail, więc dają po 1 wierszu (bez zmian).

- [ ] **Step 2: Uruchom test — ma failować**

Run: `node --test test/csv.test.js`
Expected: FAIL — nowe testy o wielu SID/mailach (obecny parser zwraca 1 wiersz z całą komórką jako SID)

- [ ] **Step 3: Zaimplementuj `src/csv.js`**

```js
// Parser CSV mapowania adresatów. Obsługuje:
//  - separator kolumn ; lub , (gdy jest ;, przecinek jest tylko wewnątrzkomórkowy),
//  - opcjonalny wiersz nagłówka,
//  - kilka SID-ów i/lub kilka maili w jednej komórce (po przecinku/średniku/spacji).
// Wynik jest PŁASKI: jeden wiersz = jeden SID + jeden mail (iloczyn kartezjański),
// żeby resolveRecipient, mergeMapping i tabela adresatów nie zmieniały struktury.

// Rozbija komórkę z wieloma wartościami (SID-y lub maile) na listę.
function splitCell(cell) {
  return String(cell ?? '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function parseMappingCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // Gdy w pierwszej linii jest średnik → ; jest separatorem kolumn
  // (przecinek wtedy wyłącznie wewnątrzkomórkowy, np. lista SID-ów).
  const sep = lines[0].includes(';') ? ';' : ',';
  const firstCells = lines[0].split(sep).map(c => c.trim());
  // Nagłówek, jeśli 3. kolumna nie wygląda na e-mail.
  const isHeader = !/\S+@\S+/.test(firstCells[2] ?? '');
  const rows = isHeader ? lines.slice(1) : lines;

  const out = [];
  for (const line of rows) {
    const cols = line.split(sep).map(c => c.trim());
    const organizacja = cols[0] ?? '';
    const sidy = splitCell(cols[1]);
    const emails = splitCell(cols[2]).filter(e => /\S+@\S+/.test(e));
    if (!sidy.length || !emails.length) continue;
    for (const sid of sidy) {
      for (const email of emails) {
        out.push({ organizacja, sid, email });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `node --test test/csv.test.js`
Expected: PASS (wszystkie, łącznie z istniejącymi)

- [ ] **Step 5: Commit**

```bash
git add src/csv.js test/csv.test.js
git commit -m "feat: csv.js — rozbijanie wielu SID i maili w komórce na płaskie wiersze

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `src/config.js` — `resolveRecipient` → `{ emails }`, klucz `mergeMapping`

**Files:**
- Modify: `src/config.js:6-22`
- Test: `test/config.test.js` (zaktualizuj testy resolveRecipient)

- [ ] **Step 1: Zaktualizuj testy (nowy kontrakt)**

W `test/config.test.js` zamień 5 testów `resolveRecipient` na poniższe (kontrakt zwraca `{ emails: string[] }`):
```js
test('resolveRecipient: pojedynczy email po SID', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['D000111'] }), { emails: ['ml@x.pl'] });
});

test('resolveRecipient: wiele SID jednej organizacji, ten sam email → dedup', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['D000475', 'D000179'] }), { emails: ['p@x.pl'] });
});

test('resolveRecipient: dopasowuje po SID mimo innej nazwy (polskie znaki)', () => {
  assert.deepEqual(resolveRecipient(cfg, { organizacja: 'FIRMA DELTA', sidy: ['D000475'] }), { emails: ['p@x.pl'] });
});

test('resolveRecipient: różne maile dla SID-ów → wiele adresatów (nie błąd)', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['A', 'B'] }), { emails: ['a@x.pl', 'b@x.pl'] });
});

test('resolveRecipient: brak maila dla SID-ów → pusta lista', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['NIEMA'] }), { emails: [] });
});

test('resolveRecipient: apostrof w SID jest znaczący', () => {
  const c = { mapping: [{ organizacja: 'X', sid: "D000444'", email: 'x@x.pl' }] };
  assert.deepEqual(resolveRecipient(c, { sidy: ['D000444'] }), { emails: [] });
  assert.deepEqual(resolveRecipient(c, { sidy: ["D000444'"] }), { emails: ['x@x.pl'] });
});
```

Dodaj też test na nowy klucz `mergeMapping` (ten sam SID, różne maile współistnieją):
```js
test('mergeMapping: ten sam SID z różnymi mailami współistnieje (klucz org|sid|email)', () => {
  const merged = mergeMapping(
    [{ organizacja: 'A', sid: 'D1', email: 'a@x.pl' }],
    [{ organizacja: 'A', sid: 'D1', email: 'b@x.pl' }],
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(m => m.email).sort(), ['a@x.pl', 'b@x.pl']);
});
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `node --test test/config.test.js`
Expected: FAIL — `resolveRecipient` zwraca `{ email }`/`{ error }`, nie `{ emails }`

- [ ] **Step 3: Zaimplementuj zmiany w `src/config.js`**

Zamień `resolveRecipient` (linie 1-15) na:
```js
// Dopasowanie maili po SAMYM SID — nazwa Organizacji bywa niespójna między
// źródłem a CSV (polskie znaki, drobne różnice w pisowni), więc SID jest
// jedynym pewnym kluczem. SID-y są porównywane dokładnym stringiem (apostrof
// znaczący). Zwraca WSZYSTKIE unikalne maile pasujące do SID-ów pliku —
// do jednej organizacji może być przypisanych kilka adresów (osobna wysyłka
// do każdego). Pusta lista = brak adresata (plik pominięty przy wysyłce).
// `file` to { organizacja?, sidy: string[] }.
export function resolveRecipient(cfg, file) {
  const sidSet = new Set((file?.sidy || []).map(s => String(s)));
  const entries = (cfg.mapping || []).filter(m => sidSet.has(String(m.sid)) && m.email?.trim());
  const emails = [...new Set(entries.map(m => m.email.trim()))];
  return { emails };
}
```

Zamień klucz w `mergeMapping` (linia 18) z:
```js
  const key = m => `${m.organizacja}||${m.sid}`;
```
na:
```js
  const key = m => `${m.organizacja}||${m.sid}||${m.email}`;
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `node --test test/config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: resolveRecipient zwraca wszystkie maile organizacji (wiele adresatów)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `src/mailer.js` — `sendBatch` wysyła osobno na każdy adres

**Files:**
- Modify: `src/mailer.js:32-76`
- Test: `test/mailer.test.js` (zaktualizuj joby na `emails`, dodaj test wielu adresów)

- [ ] **Step 1: Zaktualizuj i dodaj testy**

W `test/mailer.test.js` zamień wszystkie joby z `email: '...'` na `emails: [...]` (i puste maile na `emails: []`). Konkretnie:

Test „wysyła sekwencyjnie i raportuje" — joby:
```js
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a.xlsx', period: '04.2026' },
    { organizacja: 'B', emails: ['b@x.pl'], attachmentPath: '/b.xlsx', period: '04.2026' },
  ];
```

Test „błąd jednego nie blokuje reszty" — joby:
```js
  const jobs = [{ organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' }, { organizacja: 'B', emails: ['b@x.pl'], attachmentPath: '/b', period: 'p' }];
```

Test „pomija joby bez maila" — joby (puste = `emails: []`):
```js
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' },
    { organizacja: 'B', emails: [], attachmentPath: '/b', period: 'p' },
    { organizacja: 'C', emails: [], attachmentPath: '/c', period: 'p' },
    { organizacja: 'D', emails: ['d@x.pl'], attachmentPath: '/d', period: 'p' },
  ];
```

Test „pominięte joby nie wywołują opóźnienia" — joby:
```js
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' },
    { organizacja: 'B', emails: [], attachmentPath: '/b', period: 'p' },
    { organizacja: 'C', emails: ['c@x.pl'], attachmentPath: '/c', period: 'p' },
  ];
```

Test „opóźnienie respektowane" — joby A/B/C każdy `emails: ['..@x.pl']`. Asercja `sleepCalls.length === jobs.length - 1` zostaje (3 joby × 1 mail = 3 wysyłki → 2 odstępy).

Dodaj nowy test wielu adresów w jednym jobie:
```js
test('sendBatch: wiele maili w jobie → osobna wiadomość do każdego, odstęp między każdą', async () => {
  const sent = [];
  const sleepCalls = [];
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { sent.push(m.to); return {}; } }),
    sleep: async (ms) => { sleepCalls.push(ms); },
  };
  const jobs = [{ organizacja: 'A', emails: ['a1@x.pl', 'a2@x.pl'], attachmentPath: '/a', period: 'p' }];
  const res = await sendBatch(deps, { host: 'h' }, { subject: 's', body: 'b', footer: '', delaySeconds: 2 }, jobs);
  assert.deepEqual(sent, ['a1@x.pl', 'a2@x.pl']);
  assert.equal(sleepCalls.length, 1, 'jeden odstęp między dwoma adresami tego samego pliku');
  assert.equal(res[0].ok, true);
  assert.deepEqual(res[0].sent, ['a1@x.pl', 'a2@x.pl']);
});

test('sendBatch: częściowy błąd jednego adresu → ok=true, errors zawiera nieudany', async () => {
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { if (m.to === 'bad@x.pl') throw new Error('boom'); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [{ organizacja: 'A', emails: ['ok@x.pl', 'bad@x.pl'], attachmentPath: '/a', period: 'p' }];
  const res = await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 0 }, jobs);
  assert.equal(res[0].ok, true, 'co najmniej jeden adres poszedł → ok');
  assert.deepEqual(res[0].sent, ['ok@x.pl']);
  assert.equal(res[0].errors.length, 1);
  assert.equal(res[0].errors[0].email, 'bad@x.pl');
});
```

- [ ] **Step 2: Uruchom test — ma failować**

Run: `node --test test/mailer.test.js`
Expected: FAIL — `sendBatch` czyta `job.email`, nie `job.emails`

- [ ] **Step 3: Zaimplementuj `sendBatch` w `src/mailer.js`**

Zamień całą funkcję `sendBatch` (linie 32-76) na:
```js
export async function sendBatch(deps, smtp, mail, jobs, onProgress = () => {}) {
  const transport = deps.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  const results = [];
  let anySentYet = false; // czy w całej partii poszedł już choć jeden mail (do antyspamowego odstępu)
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const emails = (job.emails || []).map(e => String(e).trim()).filter(Boolean);
    // Brak adresu → pomijamy bez próby wysyłki (nie błąd SMTP, świadome pominięcie).
    if (emails.length === 0) {
      results.push({ organizacja: job.organizacja, ok: false, skipped: true, sent: [] });
      onProgress({ index: i + 1, total: jobs.length, last: results[i] });
      continue;
    }
    const vars = { organizacja: job.organizacja, okres: job.period };
    const sent = [];
    const errors = [];
    let copyError;
    // Osobna wiadomość do KAŻDEGO adresu. Odstęp antyspamowy liczony między
    // każdą realną wysyłką (także między adresami tego samego pliku).
    for (const to of emails) {
      if (anySentYet && mail.delaySeconds > 0) await deps.sleep(mail.delaySeconds * 1000);
      const message = {
        from: smtp.from,
        to,
        subject: renderTemplate(mail.subject, '', vars),
        text: renderTemplate(mail.body, mail.footer, vars),
        html: renderHtml(mail.body, mail.footer, vars),
        attachments: [{ filename: basename(job.attachmentPath), path: job.attachmentPath }],
      };
      try {
        await transport.sendMail(message);
        anySentYet = true;
        sent.push(to);
        // Opcjonalna kopia w „Wysłane" (IMAP). Niepowodzenie kopii NIE psuje wysyłki.
        if (deps.saveSent) {
          try { await deps.saveSent(message, vars); }
          catch (e) { copyError = copyError || e.message; }
        }
      } catch (e) {
        errors.push({ email: to, error: e.message });
      }
    }
    const result = { organizacja: job.organizacja, ok: sent.length > 0, sent };
    if (errors.length) result.errors = errors;
    if (copyError) result.copyError = copyError;
    if (sent.length === 0) result.error = errors[0]?.error || 'błąd wysyłki';
    results.push(result);
    onProgress({ index: i + 1, total: jobs.length, last: result });
  }
  return results;
}
```

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `node --test test/mailer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mailer.js test/mailer.test.js
git commit -m "feat: sendBatch wysyła osobną wiadomość na każdy adres (wiele maili na plik)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `electron/ipc.js` + `preload.cjs` — bajty CSV i `emails` w handlerach

**Files:**
- Modify: `electron/ipc.js` (importy, `resolve-emails`, `config:import-csv`, `generate`, `send-one`, `send-all`)
- Modify: `electron/preload.cjs:15`

Brak testów jednostkowych (warstwa IO). Weryfikacja: `npm test` zielone (logika src już pokryta) + ręczny smoke w Task 8.

- [ ] **Step 1: Dodaj import `decodeCsvBytes`**

W `electron/ipc.js` przy imporcie `parseMappingCsv` (linia 14) dopisz import:
```js
import { decodeCsvBytes } from '../src/encoding.js';
```

- [ ] **Step 2: Handler `config:import-csv` — dekoduj bajty**

Zamień (linia 77):
```js
  ipcMain.handle('config:import-csv', async (_e, { text, existing }) => mergeMapping(existing || [], parseMappingCsv(text)));
```
na:
```js
  // Wejście: surowe bajty pliku CSV (renderer wysyła arrayBuffer) — wykrywamy
  // kodowanie (Excel zapisuje cp1250 albo UTF-8) i dopiero parsujemy.
  ipcMain.handle('config:import-csv', async (_e, { bytes, existing }) =>
    mergeMapping(existing || [], parseMappingCsv(decodeCsvBytes(bytes))));
```

- [ ] **Step 3: Handler `resolve-emails` — zwróć `emails`**

Zamień (linie 67-73):
```js
  ipcMain.handle('resolve-emails', async (_e, files) => {
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    return (files || []).map((f) => {
      const rec = resolveRecipient(cfg, f);
      return { organizacja: f.organizacja, sidy: f.sidy, email: rec.email || null, emailError: rec.error || null };
    });
  });
```
na:
```js
  ipcMain.handle('resolve-emails', async (_e, files) => {
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    return (files || []).map((f) => {
      const rec = resolveRecipient(cfg, f);
      return { organizacja: f.organizacja, sidy: f.sidy, emails: rec.emails };
    });
  });
```

- [ ] **Step 4: Handler `generate` — `emails` w wyniku pliku**

Zamień (linie 174-175):
```js
      const rec = resolveRecipient(cfg, f);
      out.push({ organizacja: f.organizacja, kanal: f.kanal, sidy: f.sidy, path: outPath, email: rec.email || null, emailError: rec.error || null });
```
na:
```js
      const rec = resolveRecipient(cfg, f);
      out.push({ organizacja: f.organizacja, kanal: f.kanal, sidy: f.sidy, path: outPath, emails: rec.emails });
```

- [ ] **Step 5: Handlery `send-one` i `send-all` — joby z `emails`**

Zamień w `send-one` (linia 185):
```js
      [{ organizacja: file.organizacja, email: file.email, attachmentPath: file.path, period }],
```
na:
```js
      [{ organizacja: file.organizacja, emails: file.emails, attachmentPath: file.path, period }],
```

Zamień w `send-all` (linia 192):
```js
    const jobs = files.map(f => ({ organizacja: f.organizacja, email: f.email, attachmentPath: f.path, period }));
```
na:
```js
    const jobs = files.map(f => ({ organizacja: f.organizacja, emails: f.emails, attachmentPath: f.path, period }));
```

- [ ] **Step 6: `preload.cjs` — `importCsv` przekazuje bajty**

Zamień (linia 15):
```js
  importCsv: (text, existing) => ipcRenderer.invoke('config:import-csv', { text, existing }),
```
na:
```js
  importCsv: (bytes, existing) => ipcRenderer.invoke('config:import-csv', { bytes, existing }),
```

- [ ] **Step 7: Uruchom pełne testy**

Run: `npm test`
Expected: PASS (2 testy integracyjne SKIP gdy brak `Prowizje/` — to normalne)

- [ ] **Step 8: Commit**

```bash
git add electron/ipc.js electron/preload.cjs
git commit -m "feat: ipc/preload — bajty CSV (dekodowanie) i model emails w handlerach

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `renderer/config.ui.js` — bajty CSV przy imporcie

**Files:**
- Modify: `renderer/config.ui.js:195-207`

- [ ] **Step 1: Czytaj arrayBuffer zamiast text**

Zamień handler `#csvInput` change (linie 195-207):
```js
$('#csvInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const merged = await window.api.importCsv(text, cfg.mapping);
    cfg.mapping = merged || cfg.mapping;
    renderMapping();
  } catch (err) {
    $('#saveStatus').innerHTML = `<span class="status-err">✗ Nie udało się wczytać CSV: ${esc((err && err.message) || '')}</span>`;
  }
  e.target.value = '';
});
```
na:
```js
$('#csvInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  // Przekazujemy SUROWE bajty (nie file.text(), które zawsze dekoduje jako UTF-8) —
  // backend wykrywa kodowanie (Excel zapisuje cp1250 lub UTF-8) i poprawnie czyta
  // polskie znaki.
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const merged = await window.api.importCsv(bytes, cfg.mapping);
    cfg.mapping = merged || cfg.mapping;
    renderMapping();
  } catch (err) {
    $('#saveStatus').innerHTML = `<span class="status-err">✗ Nie udało się wczytać CSV: ${esc((err && err.message) || '')}</span>`;
  }
  e.target.value = '';
});
```

- [ ] **Step 2: Commit**

```bash
git add renderer/config.ui.js
git commit -m "feat: import CSV czyta surowe bajty (poprawne polskie znaki z Excela)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `renderer/config.html` + `config.ui.js` + `styles.css` — zakładki

**Files:**
- Modify: `renderer/config.html:20-176` (pasek zakładek + atrybuty paneli)
- Modify: `renderer/config.ui.js` (logika przełączania, aktualizacja pomocy CSV)
- Modify: `renderer/styles.css` (style zakładek)

- [ ] **Step 1: Dodaj pasek zakładek i oznacz panele w `config.html`**

W `<div class="panel">` (po `<p class="panel-sub">`, przed pierwszą `<section class="card">`, czyli po linii 23) wstaw pasek zakładek:
```html
        <nav class="tabs" role="tablist">
          <button class="tab active" type="button" data-tab="konto" role="tab">Konto e-mail</button>
          <button class="tab" type="button" data-tab="szablon" role="tab">Szablon e-maila</button>
          <button class="tab" type="button" data-tab="adresaci" role="tab">Adresaci</button>
        </nav>
```

Dodaj do trzech istniejących `<section class="card">` atrybut `data-panel` i klasę panelu:
- Sekcja „Konto e-mail" (`<section class="card">` przy linii 26) → `<section class="card tab-panel active" data-panel="konto">`
- Sekcja „Szablon e-maila" (przy linii 99) → `<section class="card tab-panel" data-panel="szablon">`
- Sekcja „Adresaci (mapowanie)" (przy linii 125) → `<section class="card tab-panel" data-panel="adresaci">`

- [ ] **Step 2: Zaktualizuj pomoc CSV w `config.html`**

W sekcji adresatów, w `<p class="csv-help-text">` (linia 135) dopisz na końcu zdanie o wielu wartościach i kodowaniu. Zamień całą treść `<p class="csv-help-text">…</p>` na:
```html
            <p class="csv-help-text">Trzy kolumny w kolejności: <strong>Organizacja</strong>, <strong>SID</strong>, <strong>e-mail</strong>. Rozdzielone średnikiem <code>;</code> lub przecinkiem <code>,</code>. Pierwszy wiersz z nagłówkami jest opcjonalny. Liczy się kolejność kolumn, nie ich nazwy. W kolumnie <strong>SID</strong> oraz <strong>e-mail</strong> możesz podać kilka wartości po przecinku — program rozbije je na osobne wpisy. Polskie znaki działają niezależnie od sposobu zapisu z Excela (zwykły „CSV" i „CSV UTF-8").</p>
```

- [ ] **Step 3: Dodaj logikę przełączania zakładek w `config.ui.js`**

W `renderer/config.ui.js`, przed wywołaniem `init();` na końcu pliku (linia 222), dodaj:
```js
// ===== Zakładki konfiguracji =====
// Przełączanie czysto po stronie renderera: wszystkie panele są w DOM (collect()
// zbiera całość), pokazujemy tylko aktywny. Jeden wspólny „Zapisz" w stopce.
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === name);
    });
  });
});
```

- [ ] **Step 4: Dodaj style zakładek w `styles.css`**

Dopisz na końcu `renderer/styles.css`:
```css
/* ===== Zakładki konfiguracji ===== */
.tabs {
  display: flex;
  gap: 4px;
  margin: 0 0 18px;
  border-bottom: 1px solid var(--line, #E3DCEF);
}
.tab {
  appearance: none;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 16px;
  font: inherit;
  font-weight: 600;
  color: var(--muted, #6B6080);
  cursor: pointer;
  margin-bottom: -1px;
}
.tab:hover { color: var(--ink, #1F1430); }
.tab.active {
  color: var(--brand, #6B3FA0);
  border-bottom-color: var(--brand, #6B3FA0);
}
.tab-panel { display: none; }
.tab-panel.active { display: block; }
```

(Uwaga: jeśli zmienne `--line`, `--muted`, `--brand`, `--ink` nie istnieją w `:root`, fallbacki w `var(...)` zadziałają. Sprawdź `:root` w `styles.css` i użyj istniejących nazw, jeśli się różnią.)

- [ ] **Step 5: Weryfikacja ręczna (uruchom apkę)**

Run: `npm start`
Expected: Okno konfiguracji (⚙) pokazuje 3 zakładki; klik przełącza widoczny panel; „Zapisz" zapisuje całość. Import CSV pliku `Prowizje/Maile.csv` wczytuje polskie znaki poprawnie i rozbija wiersze z wieloma SID.

- [ ] **Step 6: Commit**

```bash
git add renderer/config.html renderer/config.ui.js renderer/styles.css
git commit -m "feat: konfiguracja w zakładkach (konto / szablon / adresaci) + opis CSV

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `renderer/main.ui.js` — model `email` → `emails`

**Files:**
- Modify: `renderer/main.ui.js` (linie 44, 236, 269, 277, 349, 354, 362, 368, 414, 419, 455, 523 oraz `onConfigUpdated`)

Helper do wyświetlania listy maili — dodaj raz, użyj wszędzie.

- [ ] **Step 1: Dodaj helper i popraw warunki gotowości**

W `renderer/main.ui.js` dodaj helper (blisko innych helperów, np. po `baseName`, ~linia 231):
```js
// Czy plik ma choć jeden adres? (model: f.emails to lista 0..n adresów)
function hasEmail(f) { return Array.isArray(f.emails) && f.emails.length > 0; }
// Maile do wyświetlenia w tabeli (lub znacznik braku).
function emailsLabel(f) {
  return hasEmail(f) ? esc(f.emails.join(', ')) : '<span class="muted">— brak —</span>';
}
```

W warunku gotowości kroku 3 (linia 44) zamień:
```js
  if (step === 3) return !!state.result && state.result.files.some((f) => f.email);
```
na:
```js
  if (step === 3) return !!state.result && state.result.files.some(hasEmail);
```

- [ ] **Step 2: Krok 2 — licznik braków, gotowość**

Zamień (linia 236):
```js
  const missing = r.files.filter((f) => !f.email).length;
```
na:
```js
  const missing = r.files.filter((f) => !hasEmail(f)).length;
```

Zamień (linia 277):
```js
  const ready = r.files.some((f) => f.email);
```
na:
```js
  const ready = r.files.some(hasEmail);
```

- [ ] **Step 3: Krok 3 — render wiersza, statusy, liczniki**

Zamień (linia 349):
```js
  const sendable = files.filter((f) => f.email).length; // ile faktycznie pójdzie
```
na:
```js
  const sendable = files.filter(hasEmail).length; // ile plików faktycznie pójdzie
```

Zamień blok render wiersza (linie 353-364) — warunek `!f.email` i komórka e-mail:
```js
    if (!f.email) status = `<span class="row-status pending" title="Brak adresu e-mail — plik pominięty">⤬ pominięto — brak maila</span>`;
```
na:
```js
    if (!hasEmail(f)) status = `<span class="row-status pending" title="Brak adresu e-mail — plik pominięty">⤬ pominięto — brak maila</span>`;
```

oraz komórkę e-mail (linia 362):
```js
        <td class="mono">${f.email ? esc(f.email) : '<span class="muted">— brak —</span>'}</td>
```
na:
```js
        <td class="mono">${emailsLabel(f)}</td>
```

Zamień (linia 368):
```js
  const skipCount = files.filter((f) => !f.email).length;
```
na:
```js
  const skipCount = files.filter((f) => !hasEmail(f)).length;
```

- [ ] **Step 4: `onSendAll` — filtr, potwierdzenie, payload**

Zamień (linie 414, 419):
```js
  const withEmail = allFiles.filter((f) => f.email);
```
na:
```js
  const withEmail = allFiles.filter(hasEmail);
```

oraz:
```js
    const brakujace = allFiles.filter((f) => !f.email).map((f) => f.organizacja);
```
na:
```js
    const brakujace = allFiles.filter((f) => !hasEmail(f)).map((f) => f.organizacja);
```

Zamień payload `sendAll` (linia 455):
```js
      files: files.map((f) => ({ organizacja: f.organizacja, email: f.email, path: f.path })),
```
na:
```js
      files: files.map((f) => ({ organizacja: f.organizacja, emails: f.emails, path: f.path })),
```

- [ ] **Step 5: `onConfigUpdated` — przypisz `emails`**

Zamień (linia 523):
```js
    if (r) { f.email = r.email; f.emailError = r.emailError; }
```
na:
```js
    if (r) { f.emails = r.emails || []; }
```

- [ ] **Step 6: Weryfikacja ręczna**

Run: `npm start`
Expected (wymaga danych w `Prowizje/`, więc opcjonalne jeśli brak): pełny przepływ — generacja, krok 2 pokazuje pliki, krok 3 pokazuje adresy (po przecinku gdy wiele), wysyłka rozdziela na osobne maile. Bez danych: przynajmniej apka startuje bez błędów konsoli związanych z `f.email`.

- [ ] **Step 7: Uruchom pełne testy**

Run: `npm test`
Expected: PASS (integracyjne SKIP bez `Prowizje/`)

- [ ] **Step 8: Commit**

```bash
git add renderer/main.ui.js
git commit -m "feat: główny UI obsługuje wiele maili na plik (model emails)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Aktualizacja `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (sekcje o config/secrets i wysyłce)

- [ ] **Step 1: Zaktualizuj opis w CLAUDE.md**

W sekcji „Config & secrets" zaktualizuj akapity o `resolveRecipient`, CSV i bulk send, by odzwierciedlały:
- `resolveRecipient` zwraca `{ emails: string[] }` (wszystkie maile organizacji; brak = pusta lista; różne maile = wielu adresatów, nie błąd).
- `parseMappingCsv` rozbija komórki SID i e-mail po przecinku (płaskie wiersze, iloczyn kartezjański); import czyta surowe bajty i wykrywa kodowanie (`src/encoding.js`: UTF-8 BOM / UTF-8 / Windows-1250).
- `sendBatch` wysyła osobną wiadomość na każdy adres pliku; odstęp antyspamowy między każdą realną wysyłką.
- Konfiguracja jest w 3 zakładkach (konto / szablon / adresaci), jedno okno, wspólny „Zapisz".

(Treść redakcyjna — dopasuj do stylu istniejących akapitów, po polsku/angielsku jak reszta pliku.)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: aktualizacja CLAUDE.md (emails, kodowanie CSV, zakładki)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (wynik)

- **Spec coverage:** kodowanie CSV (T1) ✓; rozbijanie komórek (T2) ✓; resolveRecipient→emails + mergeMapping (T3) ✓; sendBatch per-adres (T4) ✓; bajty CSV przez IPC/preload + emails w handlerach (T5,T6) ✓; zakładki (T7) ✓; główny UI email→emails (T8) ✓; docs (T9) ✓.
- **Typy spójne:** `emails: string[]` używane jednolicie w src/ipc/preload/renderer; job ma `emails`; wynik `sendBatch` ma `{ ok, sent, errors?, skipped?, copyError?, error? }`; `resolveRecipient` → `{ emails }`.
- **Brak placeholderów:** każdy krok ma konkretny kod/komendę/oczekiwany wynik.
- **Uwaga wykonawcza:** w T7 step 4 zweryfikuj nazwy zmiennych CSS w `:root` `styles.css` (fallbacki podane); w T8 numery linii mogą drgnąć po wcześniejszych edycjach — kotwicz po treści, nie po numerze.
