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
- **`electron/updater.js`** — auto-update via `electron-updater` + GitHub Releases. Mode is "silent, install on quit" (`autoDownload` + `autoInstallOnAppQuit`). Only runs when `app.isPackaged` (skipped in dev). `autoUpdater` is grabbed *inside* `initAutoUpdate` (after `app.whenReady`), not at module top-level — it's a lazy getter that reaches into `electron.app` and throws if touched too early. All errors are swallowed (updates must never block launch). Emits `update-status` to the renderer, which shows a discreet toast only for `downloading`/`downloaded`.
- **`electron/ipc.js`** — the only place that touches the filesystem, `safeStorage`, `nodemailer`, IMAP, and ExcelJS file IO. It wires `src/` modules together and injects dependencies (e.g. `cryptoDeps` carries `encrypt`/`decrypt`/`readFile`/`writeFile`). All cross-process calls go through `ipcMain.handle`.
- **`electron/preload.cjs`** — **must stay CommonJS (`.cjs`)**. With sandbox on, an ESM preload silently fails to execute and `window.api` becomes `undefined`. It `contextBridge`-exposes the `window.api` surface the renderer uses.
- **`renderer/`** — plain HTML/CSS/JS (no framework). `index.html`/`main.ui.js` is the main stepper flow; `config.html`/`config.ui.js` is the separate config window. The renderer only calls `window.api.*`.
- **`src/`** — see modules below. Functions take their effectful dependencies as a `deps` argument (e.g. `createTransport`, `sleep`, `readFile`, `encrypt`) so tests pass fakes.

### Data flow (the `generate` handler in `electron/ipc.js`)

1. `reader.js` reads the two source workbooks into plain arrays of arrays.
2. `validate.js` checks files by **column-header structure**, not sheet name or filename.
3. `period.js` detects the billing period from the `Okres Rozl.` column (most frequent `YYYYMM`).
4. `engine.js` (`buildFiles`) groups summary rows by `Organizacja` and joins detail rows by an exact key match.
5. `generator.js` clones the matching template workbook and injects rows, preserving styling.
6. `config.js`/`mailer.js` resolve recipients and send emails sequentially with a configurable delay.

### Source / output file conventions

- **Source A — `Play_dealer_*.xlsx`** (large, ~11 MB / ~20k rows): sheet matched by prefix `dane do plików` → detail/transaction lines (bottom block of output).
- **Source B — `Analiza-strumieni-prowizji-POS-DB-*.xlsx`**: sheets matched by prefix `dane do plików POS` and `dane do plików DB` → channel summaries (top block of output).
- Sheets are found by **prefix** (`SHEET` in `src/constants.js`), never exact name — sheet names embed the month number (`...POS 04`) and change every period.
- Output: one `.xlsx` per Organization, named `{Organizacja} {MM.YYYY}.xlsx`, written to `{chosenFolder}/Prowizje {MM.YYYY}/`.

## Business-logic invariants (don't "fix" these)

These are deliberate and load-bearing — verify against the design doc (`docs/superpowers/specs/2026-06-10-maszynka-prowizji-design.md`) before changing:

- **Exact string matching everywhere.** Organizations are grouped by the exact `Organizacja` string (case-sensitive — `MTELL` vs `Mtell` are intentionally different entities). Detail rows are matched by exact key string.
- **Apostrophes in SIDs are significant and never stripped.** Key `D000444'` matches only detail rows keyed exactly `D000444'`; `D000444` matches its own. A SID with no matching detail rows correctly yields an empty detail block. The engine test and integration test both pin this.
- **Channel decides the join key** (`DETAIL_KEY_COL` in `src/constants.js`): POS joins on column 1 (`SID POS`), DB joins on column 2 (`SID Sprzed.`). No Organization spans both channels, so each output file is homogeneous.
- **One file per Organization, merging multiple SIDs** ("stos"/stack layout): top block = one summary row per SID; bottom block = all detail rows of all the Organization's SIDs concatenated.
- **1:1 visual fidelity.** Output styling comes from the two checked-in `templates/*.xlsx` (real client master files with colors/currency formats/widths). `generator.js` deep-copies the template's reference data-row style per cell (`deepStyleCopy`) so cells never share nested style objects. Output must have zero formula errors. Column constants (`DETAIL_FIRST_COL`/`DETAIL_LAST_COL` = C..AR, the 42 output columns) reflect the verified source→output column mapping.

## Config & secrets

- Config is a JSON file at `app.getPath('userData')/config.json` (`loadConfig`/`saveConfig` in `src/config.js`). It has an optional `imap` section alongside `smtp`; both encrypt their password the same way and `loadConfig` merges per-section so old config files without `imap` still load.
- SMTP/IMAP passwords are encrypted via Electron `safeStorage` (Keychain/DPAPI) and stored as `passwordEnc`; the cleartext `password` is never written to disk and is stripped on save.
- Recipient mapping entries are `Organizacja + SID + email`, importable from CSV (`src/csv.js` auto-detects `;`/`,` separator and an optional header row). **`resolveRecipient` matches by SID only** (`file.sidy`), not by Organization name — names differ between source and CSV (Polish characters, spelling), so SID is the only reliable key; the Organization name is used purely for error labels. It returns `{ error }` when an Organization's matched SIDs disagree on the email.
- Email bodies support `{Organizacja}` and `{okres}` placeholders. The footer is injected as **raw HTML** (user supplies HTML for logo/links/signature) while the body is escaped — see `renderHtml` in `src/mailer.js`.
- **Bulk send no longer requires every file to have an email.** `sendBatch` skips jobs with no email (`{ skipped: true }`, not an SMTP error) and the antispam delay only counts between real sends. The renderer shows a `window.confirm` dialog listing the email-less Organizations before sending the rest.
- **Optional "Sent" copy via IMAP** (`src/imap.js`): when `imap` is configured, `sendBatch` calls an injected `deps.saveSent` after each successful SMTP send, which IMAP-APPENDs the RFC822 message (built with nodemailer `MailComposer`) flagged `\Seen` and returns `{ uid, mailbox }` (the resolved folder). A copy failure sets `copyError` on the result but never fails the send. `ipc.js` wires the real `ImapFlow` client + `buildRaw`; tests inject fakes. The **test mail** (`smtp:send-test`) also saves a copy when IMAP is configured (same fail-soft semantics) and returns `copyOk`/`copyMailbox`/`copyError`, so one click exercises SMTP + template + folder autodetect + copy.
- **The Sent folder is auto-detected** (`pickSentMailbox`): the folder name varies by server/locale (`Sent`, `Wysłane`, `Elementy wysłane`, `Sent Items`…). Resolution order: user-supplied `sentMailbox` if it actually exists → the folder carrying the RFC 6154 SPECIAL-USE `\Sent` attribute (language-independent) → a fallback list of common names. `sentMailbox` is therefore empty by default — leave it blank for autodetect; only fill it in if detection fails. The `imap:test` handler returns the detected `mailbox` so the UI can show and persist it.
