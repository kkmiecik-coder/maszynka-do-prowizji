# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Electron desktop app (Windows + macOS) for **non-technical** users that turns two source Excel files into ~40 formatted per-Organization commission files (`.xlsx`) and optionally emails them. Guiding principle from the design: **"klikać, nie szukać i nie myśleć"** (click, don't search or think). The entire UI is in Polish; keep user-facing strings, errors, and comments in Polish to match.

## Commands

```bash
npm install        # Node.js 18+ required
npm start          # run the Electron app in dev
npm test           # run all tests (node --test, no framework)
node --test test/engine.test.js          # run a single test file
npm run dist       # build installer for current platform
npm run dist:win   # Windows NSIS .exe (build on Windows)
npm run dist:mac   # macOS .dmg (build on macOS)
```

Tests use the built-in `node:test` runner — there is no Jest/Mocha. Source modules under `src/` are pure ESM (the package is `"type": "module"`).

`scripts/build-templates.js` is a one-off used to regenerate the `templates/*.xlsx` from sample client files in `Prowizje/`. The `Prowizje/` folder is git-ignored (contains real client data + master examples) and is **not** present in a fresh clone — integration tests that depend on it self-skip via `{ skip: !hasData }`.

**The checked-in `templates/*.xlsx` are sanitized** (`scripts/sanitize-templates.js`): their sample data rows (row 2 summary, row 6 detail) were scrubbed to fictional values ("PRZYKŁADOWA FIRMA", zeroed numbers/phones) because the repo is **public**. Only `.value` was changed — styles/numFmt/widths are intact, since `generator.js` deep-copies row 6's per-cell style as the data-row template. If you ever regenerate templates from real client files, re-run the sanitizer before committing. Never commit real partner names, SIDs, phone numbers, or amounts.

## Architecture

Two-process Electron split with a hard boundary: **`src/` is pure, testable business logic with zero Electron/IO dependencies**; everything Electron-specific lives in `electron/`.

- **`electron/main.js`** — app lifecycle, main window + modal config window, and auto-update kickoff.
- **`electron/updater.js`** — auto-update via `electron-updater` + GitHub Releases. Mode is **"forced modal"**: `autoDownload=false`; on `update-available` it emits `{state:'required'}` and the renderer shows a **blocking overlay** (`#updateOverlay` in index.html, wired in `wireUpdateModal`) with *Aktualizuj* / *Anuluj*. Anuluj → `update:cancel` IPC → `app.quit()`. Aktualizuj → `update:start` IPC → `downloadUpdate()`; the modal turns into a progress bar (`download-progress` → `{state:'downloading'}`). On `update-downloaded` it emits `{state:'installing'}` and calls `quitAndInstall(true, true)` (silent install + auto-relaunch). `initAutoUpdate` returns `{startDownload, cancelAndQuit}` handles that main.js binds to those IPC channels. Only runs when `app.isPackaged` (in dev it returns no-op handles). `autoUpdater` is grabbed *inside* `initAutoUpdate` (after `app.whenReady`), not at module top-level — it's a lazy getter that reaches into `electron.app` and throws if touched too early. Check errors are swallowed (no network → app just runs on current version). **Not testable in `npm start`** — the modal only appears in a packaged build when a newer release actually exists.
- **`electron/ipc.js`** — the only place that touches the filesystem, `safeStorage`, `nodemailer`, IMAP, and ExcelJS file IO. It wires `src/` modules together and injects dependencies (e.g. `cryptoDeps` carries `encrypt`/`decrypt`/`readFile`/`writeFile`). All cross-process calls go through `ipcMain.handle`.
- **`electron/preload.cjs`** — **must stay CommonJS (`.cjs`)**. With sandbox on, an ESM preload silently fails to execute and `window.api` becomes `undefined`. It `contextBridge`-exposes the `window.api` surface the renderer uses.
- **`renderer/`** — plain HTML/CSS/JS (no framework). `index.html`/`main.ui.js` is the main 3-step flow (Źródła → Pliki → Wysyłka); `config.html`/`config.ui.js` is the separate config window, split into three tabs (Konto e-mail / Szablon e-maila / Adresaci) toggled purely client-side — one window, one shared **Zapisz** that saves everything (all panels stay in the DOM so `collect()` reads the whole form regardless of the active tab). The renderer only calls `window.api.*`. Step 2 lists the generated files with an **"Otwórz"** button (`window.api.openFile` → `shell.openPath`, opens the `.xlsx` in Excel) — it no longer shows per-row emails or per-row send; sending happens in bulk in step 3. The app version is shown in the header (`window.api.getVersion`).
- **`src/`** — see modules below. Functions take their effectful dependencies as a `deps` argument (e.g. `createTransport`, `sleep`, `readFile`, `encrypt`) so tests pass fakes.

### Data flow (the `generate` handler in `electron/ipc.js`)

1. `reader.js` reads the two source workbooks into plain arrays of arrays.
2. `validate.js` checks files by **column-header structure**, not sheet name or filename. A Play_dealer file is accepted either via the ready `dane do plików` sheet (headers in row 1) **or** the raw `dane` sheet (headers in **row 3** — `readAllHeaders` returns both `headers` and `headersRow3`; raw markers: `SID POS`+`SID Sprzed.`+`% Circus`).
3. `period.js` detects the billing period from the `Okres Rozl.` column (most frequent `YYYYMM`). **That column is located by name, hybrid-mapped** (see below) — its position drifts between months.
4. `engine.js` (`buildFiles`) groups summary rows by `Organizacja` and joins detail rows by an exact key match.
5. `generator.js` clones the matching template workbook and injects rows, preserving styling. The detail block's columns are mapped **dynamically** (see below).
6. `config.js`/`mailer.js` resolve recipients and send emails sequentially with a configurable delay.

### Dynamic column mapping (`src/columns.js`) — load-bearing

The `Play_dealer` source ("dane do plików" sheet) **changes its column layout between billing periods** — e.g. April added a `Nazwa Partnera` column at position 4, shifting everything (including `DO WYPŁATY`) right by one. Hardcoded column indices silently corrupt output (wrong column harvested, `DO WYPŁATY` truncated). So columns are mapped **hybrid**: `resolveColIndex(headerRow, expectedName, defaultIdx)` first checks the default position; if the header there doesn't match, it falls back to finding the column **by name**. `buildDetailPlan(headerRow)` returns the output columns from `Nazwa Firmy` to `DO WYPŁATY` inclusive, in source order — so `Nazwa Partnera` appears in output iff present in source (March = 41 cols, April = 42). `Struktura`/`Firma` (after `DO WYPŁATY`) are excluded.
- `generator.js` receives the **source header row** as a 4th arg (`saveFile(file, tpl, outPath, detailHeader)`); `ipc.js` passes `detail[0]` before `.slice(1)`. It writes the detail header row **dynamically** from the plan, anchors per-cell styles **by column name** (not position) from the template's row 6 style bank, and **forces numFmt by name** (`DETAIL_COL_NUMFMT`: date on `Data Kontraktu`, currency on `DO WYPŁATY`) so currency/date land correctly regardless of shift. The template's static detail header (row 5) is overwritten — templates need not be regenerated for layout changes.
- The summary (top) block (`SUMMARY` cols, from `Analiza`) is **stable** across months and still mapped positionally.
- `engine.js` join keys (`DETAIL_KEY_COL` = SID POS col 1 / SID Sprzed. col 2) are also stable and unchanged.
- Verified: regenerating March (41 cols) and April (42 cols) from real sources reproduces the client's hand-made reference files **cell-for-cell, zero diffs**.

### Building "dane do plików" from "dane" (`src/daneDoPlikow.js`)

The `Play_dealer` workbook also has a raw **`dane`** sheet (64 cols, headers in **row 3**) that the client manually transforms into `dane do plików`. The `generate` handler now **falls back to building it in-flight** when `dane do plików` is absent: `if no "dane do plików" sheet → read "dane" + dictionary, call buildDaneDoPlikow(...)`. The recipe was reverse-engineered and verified **cell-for-cell zero-diff against the existing sheet for both March and April**:
- Most columns are 1:1 copies (mapped by name). **Three conditional rules:** (1) `DO WYPŁATY` ← `% Circus`; if `% Circus` is blank → blank when `Struktura` is `Play Own`, else `0`. (2) `Nazwa Firmy`: POS (Firma non-empty) → substring before `" - "` (`WŁASNY - Kraków` → `WŁASNY`); DB (Firma empty) → looked up in the **SID→name dictionary** from `Analiza`'s `Strumienie per POS` sheet (col `SID ID` → col `Organizacja`, trailing apostrophe stripped). (3) multipliers are plain copies.
- `cellValue()` resolves formula cells (`{formula,result}`) — `% Circus` is a formula and blank-result formulas must count as empty (that's the `→ 0` branch).
- The built sheet **always includes `Nazwa Partnera`** (col 2 of the detail block) — the newest output format. Downstream mapping is by name, so the extra column is harmless. `scripts/verify-ddp.js` regenerates and diffs against the embedded sheet.

### Source / output file conventions

- **Source A — `Play_dealer_*.xlsx`** (large, ~11 MB / ~20k rows): sheet matched by prefix `dane do plików` → detail/transaction lines (bottom block of output). If that sheet is absent, the bottom block is built from the raw `dane` sheet instead (see "Building dane do plików" above).
- **Source B — `Analiza-strumieni-prowizji-POS-DB-*.xlsx`**: sheets matched by prefix `dane do plików POS` and `dane do plików DB` → channel summaries (top block of output).
- Sheets are found by **prefix** (`SHEET` in `src/constants.js`), never exact name — sheet names embed the month number (`...POS 04`) and change every period.
- Output: one `.xlsx` per Organization, named `{Organizacja} {MM.YYYY}.xlsx`, written to `{chosenFolder}/Prowizje {MM.YYYY}/`.

## Business-logic invariants (don't "fix" these)

These are deliberate and load-bearing — verify against the design doc (`docs/superpowers/specs/2026-06-10-maszynka-prowizji-design.md`) before changing:

- **Exact string matching everywhere.** Organizations are grouped by the exact `Organizacja` string (case-sensitive — `MTELL` vs `Mtell` are intentionally different entities). Detail rows are matched by exact key string.
- **Apostrophes in SIDs are significant and never stripped.** Key `D000444'` matches only detail rows keyed exactly `D000444'`; `D000444` matches its own. A SID with no matching detail rows correctly yields an empty detail block. The engine test and integration test both pin this.
- **Channel decides the join key** (`DETAIL_KEY_COL` in `src/constants.js`): POS joins on column 1 (`SID POS`), DB joins on column 2 (`SID Sprzed.`). No Organization spans both channels, so each output file is homogeneous.
- **One file per Organization, merging multiple SIDs** ("stos"/stack layout): top block = one summary row per SID; bottom block = all detail rows of all the Organization's SIDs concatenated.
- **1:1 visual fidelity.** Output styling comes from the two checked-in `templates/*.xlsx` (real client master files with colors/currency formats/widths). `generator.js` deep-copies the template's reference data-row style per cell (`deepStyleCopy`) so cells never share nested style objects. Output must have zero formula errors. The detail block is **no longer** bounded by hardcoded `DETAIL_FIRST_COL`/`DETAIL_LAST_COL` constants (removed in 0.6.6) — columns are mapped dynamically by name (see "Dynamic column mapping" above).

## Config & secrets

- Config is a JSON file at `app.getPath('userData')/config.json` (`loadConfig`/`saveConfig` in `src/config.js`). It has an optional `imap` section alongside `smtp`; both encrypt their password the same way and `loadConfig` merges per-section so old config files without `imap` still load.
- SMTP/IMAP passwords are encrypted via Electron `safeStorage` (Keychain/DPAPI) and stored as `passwordEnc`; the cleartext `password` is never written to disk and is stripped on save.
- Recipient mapping entries are flat `Organizacja + SID + email` rows (one SID + one email per row), importable from CSV. **Import passes raw bytes, not a decoded string** — the renderer reads `file.arrayBuffer()` and `decodeCsvBytes` (`src/encoding.js`) auto-detects the encoding (UTF-8 BOM → UTF-8 strict → Windows-1250 fallback), because Excel saves "CSV" as cp1250 and "CSV UTF-8" as UTF-8; reading everything as UTF-8 mangled Polish characters into `�`. `parseMappingCsv` (`src/csv.js`) auto-detects the `;`/`,` separator and an optional header row, and **splits multi-value SID and email cells** (a cell like `D001791, D001780` or two emails) into the cartesian product of flat rows — so a SID with two emails, or an org with several SIDs, becomes several mapping rows. `mergeMapping` dedups on `organizacja||sid||email` so the same SID can carry multiple emails. **`resolveRecipient` matches by SID only** (`file.sidy`), not by Organization name — names differ between source and CSV (Polish characters, spelling), so SID is the only reliable key. It returns **`{ emails: string[] }`** — all unique emails for the file's SIDs; an empty array means no recipient (the file is skipped on send), and several emails is no longer an error but **several recipients** (see bulk send).
- Email bodies support `{Organizacja}` and `{okres}` placeholders. The footer is injected as **raw HTML** (user supplies HTML for logo/links/signature) while the body is escaped — see `renderHtml` in `src/mailer.js`.
- **A file may have several recipients; each gets its own message.** Jobs carry `emails: string[]` (renderer file objects and `resolve-emails`/`generate` use `emails`, never a singular `email`). `sendBatch` sends a **separate message per address** — the antispam delay (`mail.delaySeconds`) counts between *every* real send, including between two addresses of the same file (tracked by one `anySentYet` flag across the whole batch). The per-job result is `{ organizacja, ok, sent: string[], errors?, copyError?, error?, skipped? }`: `ok` is true if ≥1 address sent, `sent` lists the addresses that went out, partial failures land in `errors`. **Bulk send no longer requires every file to have an email.** `sendBatch` skips jobs with an empty `emails` array (`{ skipped: true }`, not an SMTP error) and skipped jobs add no delay. The renderer shows a `window.confirm` dialog listing the email-less Organizations before sending the rest.
- **Optional "Sent" copy via IMAP** (`src/imap.js`): when `imap` is configured, `sendBatch` calls an injected `deps.saveSent` after each successful SMTP send, which IMAP-APPENDs the RFC822 message (built with nodemailer `MailComposer`) flagged `\Seen` and returns `{ uid, mailbox }` (the resolved folder). A copy failure sets `copyError` on the result but never fails the send. `ipc.js` wires the real `ImapFlow` client + `buildRaw`; tests inject fakes. The **test mail** (`smtp:send-test`) also saves a copy when IMAP is configured (same fail-soft semantics) and returns `copyOk`/`copyMailbox`/`copyError`, so one click exercises SMTP + template + folder autodetect + copy.
- **The Sent folder is auto-detected** (`pickSentMailbox`): the folder name varies by server/locale (`Sent`, `Wysłane`, `Elementy wysłane`, `Sent Items`…). Resolution order: user-supplied `sentMailbox` if it actually exists → the folder carrying the RFC 6154 SPECIAL-USE `\Sent` attribute (language-independent) → a fallback list of common names. `sentMailbox` is therefore empty by default — leave it blank for autodetect; only fill it in if detection fails. The `imap:test` handler returns the detected `mailbox` so the UI can show and persist it.

## Releasing a new version

The repo is **public** (`kkmiecik-coder/maszynka-do-prowizji`); users auto-update from GitHub Releases. To cut a release:

1. Bump `version` in `package.json` (semver: patch = fix/cosmetic, minor = feature).
2. `npm test` must be green (the 2 integration tests SKIP when `Prowizje/` is absent — that's normal).
3. Commit (branch `main`), `git push origin main`. Commit message ends with the `Co-Authored-By` trailer.
4. `npm run release:win` — runs `scripts/release.js`, which reads `GH_TOKEN` from a git-ignored `.env` file (never commit it; `.env.example` is the template) and runs `electron-builder --publish always`.
5. **electron-builder almost always creates TWO draft releases** for the same tag (it calls publish twice; assets split — one draft gets `.blockmap`, the other `latest.yml`+`.exe`). Fix via the GitHub API with the token: upload the missing `.blockmap` (it's local in `dist/`) to the draft that has `.exe`+`latest.yml`, `PATCH` that draft `{draft:false, prerelease:false}`, then `DELETE` the empty draft. **Never mark prerelease** — `updater.js` has `allowPrerelease=false`.
6. Verify publicly (no token): `latest.yml` must be downloadable at `.../releases/latest/download/latest.yml` with the right `version`, and `/releases/latest` must show `draft:false` with 3 assets.

`latest.yml` MUST be in the published (non-draft) release or auto-update won't detect the version. Build runs on Windows (`release:win`), ~2-3 min.
