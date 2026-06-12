import { ipcMain, dialog, safeStorage, app, shell } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { ImapFlow } from 'imapflow';
import { findSheetByPrefix, readSheetRows, readAllHeaders } from '../src/reader.js';
import { validateSource } from '../src/validate.js';
import { buildFiles } from '../src/engine.js';
import { saveFile } from '../src/generator.js';
import { loadConfig, saveConfig, resolveRecipient, mergeMapping } from '../src/config.js';
import { sendBatch, verifySmtp, renderTemplate, renderHtml } from '../src/mailer.js';
import { makeSaveSent, testImap as testImapCore } from '../src/imap.js';
import { parseMappingCsv } from '../src/csv.js';
import { decodeCsvBytes } from '../src/encoding.js';
import { detectPeriod, formatPeriod } from '../src/period.js';
import { resolveColIndex } from '../src/columns.js';
import { buildDaneDoPlikow, buildSlownikDB } from '../src/daneDoPlikow.js';
import { SHEET, PERIOD_COL, PERIOD_COL_NAME, RAW_HEADER_ROW } from '../src/constants.js';

// Składa surową wiadomość RFC822 z obiektu nodemailera (do IMAP APPEND).
const buildRaw = (message) => new Promise((resolve, reject) => {
  new MailComposer(message).compile().build((err, msg) => (err ? reject(err) : resolve(msg)));
});

// Zwraca saveSent gotowy do wstrzyknięcia w sendBatch albo null (IMAP wyłączony).
const makeSaveSentFromCfg = (cfg) =>
  makeSaveSent({ ImapClient: ImapFlow, buildRaw }, { ...cfg.imap });

const CONFIG_PATH = () => join(app.getPath('userData'), 'config.json');
const TPL = (name) => app.isPackaged
  ? join(process.resourcesPath, 'templates', name)
  : join(app.getAppPath(), 'templates', name);
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
  // Otwiera plik w domyślnym programie systemu (np. .xlsx w Excelu).
  // shell.openPath zwraca pusty string przy sukcesie albo opis błędu.
  ipcMain.handle('file:open', async (_e, path) => {
    if (!path) return { ok: false, error: 'Brak ścieżki pliku.' };
    const err = await shell.openPath(path);
    return err ? { ok: false, error: err } : { ok: true };
  });
  // Walidacja pliku źródłowego: sprawdza STRUKTURĘ (nagłówki kolumn), nie nazwy zakładek.
  ipcMain.handle('validate-source', async (_e, { path, kind }) => {
    try {
      const sheets = await readAllHeaders(path);
      return validateSource(kind, sheets);
    } catch (err) {
      return { ok: false, error: `Nie udało się odczytać pliku: ${err.message}` };
    }
  });

  // Ponowne rozwiązanie adresatów po zmianie konfiguracji (osobne okno).
  // Wejście: [{ organizacja, sidy }] — dopasowanie po SID (patrz resolveRecipient).
  ipcMain.handle('resolve-emails', async (_e, files) => {
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    return (files || []).map((f) => {
      const rec = resolveRecipient(cfg, f);
      return { organizacja: f.organizacja, sidy: f.sidy, emails: rec.emails };
    });
  });

  ipcMain.handle('config:load', async () => loadConfig(cryptoDeps, CONFIG_PATH()));
  ipcMain.handle('config:save', async (_e, cfg) => { await saveConfig(cryptoDeps, CONFIG_PATH(), cfg); return true; });
  // Wejście: surowe bajty pliku CSV (renderer wysyła arrayBuffer) — wykrywamy
  // kodowanie (Excel zapisuje cp1250 albo UTF-8) i dopiero parsujemy.
  ipcMain.handle('config:import-csv', async (_e, { bytes, existing }) =>
    mergeMapping(existing || [], parseMappingCsv(decodeCsvBytes(bytes))));
  ipcMain.handle('smtp:test', async (_e, smtp) => {
    try { await verifySmtp({ createTransport: nodemailer.createTransport }, smtp); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // Test połączenia IMAP: łączy się i AUTODETEKUJE folder „Wysłane"
  // (atrybut SPECIAL-USE „\Sent" wg RFC 6154, niezależnie od nazwy/języka).
  ipcMain.handle('imap:test', async (_e, imap) => testImapCore({ ImapClient: ImapFlow }, imap));

  // Próbny mail: treść z szablonu + przykładowy plik .xlsx, na adres nadawcy/login.
  // Jeśli IMAP jest skonfigurowany, zapisujemy też kopię w „Wysłane" — by jednym
  // klliknięciem przetestować całość (SMTP + szablon + autodetekcję folderu + kopię).
  ipcMain.handle('smtp:send-test', async (_e, { smtp, mail, imap }) => {
    try {
      const to = (smtp.from && smtp.from.trim()) || (smtp.user && smtp.user.trim());
      if (!to) return { ok: false, error: 'Podaj adres nadawcy lub login — tam trafi próbny mail.' };
      const vars = { organizacja: 'Przykładowa Organizacja', okres: '04.2026' };
      const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      });
      const message = {
        from: smtp.from,
        to,
        subject: `[PRÓBNY] ${renderTemplate(mail.subject || '', '', vars)}`,
        text: renderTemplate(mail.body || '', mail.footer || '', vars),
        html: renderHtml(mail.body || '', mail.footer || '', vars),
        attachments: [{ filename: 'Przykład prowizji.xlsx', path: TPL('pos-template.xlsx') }],
      };
      await transport.sendMail(message);

      // Kopia w „Wysłane" (jak przy właściwej wysyłce) — błąd kopii nie psuje testu.
      const saveSent = makeSaveSentFromCfg({ imap: imap || {} });
      if (saveSent) {
        try {
          const appended = await saveSent(message, vars);
          return { ok: true, to, copyOk: true, copyMailbox: appended?.mailbox };
        } catch (e) {
          return { ok: true, to, copyError: e.message };
        }
      }
      return { ok: true, to };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('generate', async (e, { playPath, analPath, outDir }) => {
    const prog = (p) => e.sender.send('generate-progress', p);
    prog({ phase: 'read', message: 'Wczytuję plik Play_dealer (duży, może chwilę potrwać)…' });
    prog({ phase: 'read', message: 'Wczytuję plik Analiza…' });
    const posName = await findSheetByPrefix(analPath, SHEET.SUMMARY_POS);
    const dbName = await findSheetByPrefix(analPath, SHEET.SUMMARY_DB);
    if (!posName && !dbName) throw new Error('Wybrany plik Analiza nie zawiera arkuszy „dane do plików POS/DB". Czy na pewno wskazano właściwy plik?');
    const posSum = posName ? (await readSheetRows(analPath, posName)).rows : [];
    const dbSum = dbName ? (await readSheetRows(analPath, dbName)).rows : [];

    // Zakładka szczegółów: użyj gotowej "dane do plików"; gdy jej brak — zbuduj w locie
    // z surowej zakładki "dane" + słownik nazw DB z pliku Analiza ("Strumienie per POS").
    let detail;
    const detName = await findSheetByPrefix(playPath, SHEET.DETAIL);
    if (detName) {
      detail = (await readSheetRows(playPath, detName)).rows;
    } else {
      const rawName = await findSheetByPrefix(playPath, SHEET.RAW);
      if (!rawName) throw new Error('Wybrany plik Play_dealer nie zawiera arkusza „dane do plików" ani „dane". Czy na pewno wskazano właściwy plik?');
      prog({ phase: 'build', message: 'Buduję dane do plików z zakładki „dane"…' });
      const raw = (await readSheetRows(playPath, rawName)).rows;
      const rawHeader = raw[RAW_HEADER_ROW - 1] || []; // nagłówki "dane" są w wierszu 3
      const rawData = raw.slice(RAW_HEADER_ROW);       // dane od wiersza 4
      const dictName = await findSheetByPrefix(analPath, SHEET.DICT);
      const slownikDB = dictName ? buildSlownikDB((await readSheetRows(analPath, dictName)).rows) : {};
      const built = buildDaneDoPlikow(rawHeader, rawData, slownikDB);
      detail = [built.header, ...built.rows]; // nagłówek na pozycji 0 (jak readSheetRows)
    }
    const detailHeader = detail[0] || []; // nagłówek szczegółów — do dynamicznego mapowania kolumn
    prog({ phase: 'build', message: 'Dopasowuję dane i wykrywam okres…' });
    // Kolumna "Okres Rozl." mapowana hybrydowo (pozycja zmienna między okresami).
    const periodIdx = resolveColIndex(detailHeader, PERIOD_COL_NAME, PERIOD_COL - 1);
    const periodCol = periodIdx >= 0 ? periodIdx : PERIOD_COL - 1;
    const periodInfo = detectPeriod(detail.slice(1).map(r => r[periodCol]).filter(Boolean));
    const period = formatPeriod(periodInfo.period);
    const files = [
      ...buildFiles(posSum.slice(1), detail.slice(1), 'POS'),
      ...buildFiles(dbSum.slice(1), detail.slice(1), 'DB'),
    ];
    const folder = join(outDir, `Prowizje ${period}`);
    await mkdir(folder, { recursive: true });
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    const out = [];
    const total = files.length;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      prog({ phase: 'write', index: i + 1, total, organizacja: f.organizacja });
      const outPath = join(folder, `${f.organizacja} ${period}.xlsx`);
      await saveFile(f, TPL(f.kanal === 'POS' ? 'pos-template.xlsx' : 'db-template.xlsx'), outPath, detailHeader);
      const rec = resolveRecipient(cfg, f);
      out.push({ organizacja: f.organizacja, kanal: f.kanal, sidy: f.sidy, path: outPath, emails: rec.emails });
    }
    return { period, folder, files: out, multiplePeriods: periodInfo.multiple, periodBreakdown: periodInfo.breakdown };
  });

  ipcMain.handle('send-one', async (_e, { file, period }) => {
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    const results = await sendBatch(
      { createTransport: nodemailer.createTransport, sleep: (ms) => new Promise(r => setTimeout(r, ms)), saveSent: makeSaveSentFromCfg(cfg) },
      { ...cfg.smtp }, cfg.mail,
      [{ organizacja: file.organizacja, emails: file.emails, attachmentPath: file.path, period }],
    );
    return results[0];
  });

  ipcMain.handle('send-all', async (e, { files, period }) => {
    const cfg = await loadConfig(cryptoDeps, CONFIG_PATH());
    const jobs = files.map(f => ({ organizacja: f.organizacja, emails: f.emails, attachmentPath: f.path, period }));
    return sendBatch(
      { createTransport: nodemailer.createTransport, sleep: (ms) => new Promise(r => setTimeout(r, ms)), saveSent: makeSaveSentFromCfg(cfg) },
      { ...cfg.smtp }, cfg.mail, jobs,
      (p) => e.sender.send('send-progress', p),
    );
  });
}
