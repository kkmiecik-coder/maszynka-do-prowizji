'use strict';

// ===== State =====
const state = {
  step: 1,
  playPath: null,
  analPath: null,
  outDir: null,
  // walidacja źródeł: key -> { status: 'checking'|'ok'|'error', error }
  validation: { playPath: null, analPath: null },
  generating: false,
  genProgress: null, // { phase, index, total, organizacja, message }
  genError: null,
  result: null, // { period, folder, files, multiplePeriods }
  sending: false,
  sendDone: false,
  sendResults: {}, // organizacja -> { ok, error }
  rowSending: {},  // organizacja -> bool (indywidualna wysyłka w kroku 2)
};

const $ = (sel, root = document) => root.querySelector(sel);

// Truncate a path in the middle so both ends stay visible.
function truncateMiddle(str, max = 56) {
  if (!str || str.length <= max) return str;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return str.slice(0, head) + '…' + str.slice(str.length - tail);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ===== Stepper rules =====
function canEnter(step) {
  if (step === 1) return true;
  if (step === 2) return !!state.result;
  // Do wysyłki wystarczy co najmniej jeden plik z adresem e-mail — brakujące
  // adresy nie blokują przejścia (użytkownik potwierdzi je w oknie dialogowym).
  if (step === 3) return !!state.result && state.result.files.some(hasEmail);
  return false;
}

function goStep(step) {
  if (!canEnter(step)) return;
  state.step = step;
  render();
}

function renderStepper() {
  const steps = document.querySelectorAll('.step');
  steps.forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.remove('active', 'done', 'locked');
    const dot = $('.dot', el);
    if (n === state.step) {
      el.classList.add('active');
      dot.textContent = n;
    } else if (n < state.step && canEnter(n)) {
      el.classList.add('done');
      dot.textContent = '✓';
    } else if (canEnter(n)) {
      dot.textContent = n;
    } else {
      el.classList.add('locked');
      dot.textContent = n;
    }
    el.setAttribute('aria-current', n === state.step ? 'step' : 'false');
    el.disabled = !canEnter(n);
  });
}

// ===== Render =====
function render() {
  renderStepper();
  if (state.step === 1) renderStep1();
  else if (state.step === 2) renderStep2();
  else if (state.step === 3) renderStep3();
}

// ----- Step 1: Źródła -----
// Ikona statusu źródła: folder = zawsze ✓ po wyborze; pliki = spinner w trakcie
// walidacji, zielona fajka po sukcesie, czerwone ✕ przy błędzie.
function pickStatus(key, set) {
  if (!set) return '<span class="pick-check" aria-hidden="true">✓</span>';
  if (key === 'outDir') return '<span class="pick-check ok" aria-hidden="true">✓</span>';
  const v = state.validation[key];
  if (!v || v.status === 'checking') return '<span class="pick-spinner" aria-label="Sprawdzam plik" title="Sprawdzam plik…"></span>';
  if (v.status === 'ok') return '<span class="pick-check ok" aria-hidden="true" title="Plik prawidłowy">✓</span>';
  return '<span class="pick-check err" aria-hidden="true" title="Nieprawidłowy plik">✕</span>';
}

function pickRow(key, label, path) {
  const set = !!path;
  const v = state.validation[key];
  const err = key !== 'outDir' && v && v.status === 'error' ? v.error : null;
  return `
    <div class="pick-row ${set ? 'set' : ''} ${err ? 'has-err' : ''}">
      <span class="pick-label">${esc(label)}</span>
      <span class="pick-path mono ${set ? '' : 'empty'}" title="${esc(path || '')}">${set ? esc(truncateMiddle(path)) : 'nie wybrano'}</span>
      ${pickStatus(key, set)}
      <button class="btn btn-secondary" type="button" data-pick="${key}" ${state.generating ? 'disabled' : ''}>${set ? 'Zmień' : 'Wybierz'}</button>
    </div>
    ${err ? `<div class="pick-error"><span class="pick-error-icon">✕</span>${esc(err)}</div>` : ''}`;
}

// Map a generate-progress event to a forward-only bar (read ~15%, write fills 15→100%).
function genProgressView(p) {
  if (!p) return { pct: 5, label: 'Przygotowuję…' };
  if (p.phase === 'read') return { pct: 8, label: p.message || 'Wczytuję dane…' };
  if (p.phase === 'build') return { pct: 15, label: p.message || 'Dopasowuję dane…' };
  if (p.phase === 'write') {
    const pct = p.total ? 15 + Math.round(85 * (p.index / p.total)) : 15;
    return { pct, label: `Generuję plik ${p.index} z ${p.total}: ${p.organizacja}` };
  }
  return { pct: 5, label: 'Pracuję…' };
}

function renderStep1() {
  const panel = $('#panel');
  panel.innerHTML = `
    <h1 class="panel-title">Krok 1 · Źródła</h1>
    <p class="panel-sub">Wskaż dwa pliki źródłowe i folder, w którym mają się zapisać prowizje.</p>
    ${state.genError ? `<div class="banner banner-err"><span class="banner-icon">✗</span><span>${esc(state.genError)}</span></div>` : ''}
    <div class="card">
      ${pickRow('playPath', 'Plik Play_dealer', state.playPath)}
      ${pickRow('analPath', 'Plik Analiza', state.analPath)}
      ${pickRow('outDir', 'Folder zapisu', state.outDir)}
    </div>
    ${state.generating ? `
      <div class="card" style="margin-top:16px">
        <div class="progress-track"><div class="progress-fill" id="genFill" style="width:${genProgressView(state.genProgress).pct}%"></div></div>
        <div class="progress-label" id="genLabel">${esc(genProgressView(state.genProgress).label)}</div>
      </div>` : ''}
  `;

  panel.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => onPick(btn.dataset.pick));
  });

  const v1 = state.validation.playPath, v2 = state.validation.analPath;
  const ready = state.playPath && state.analPath && state.outDir
    && v1 && v1.status === 'ok' && v2 && v2.status === 'ok';
  setFooter(
    '',
    `<button class="btn btn-primary" id="genBtn" type="button" ${ready && !state.generating ? '' : 'disabled'}>Generuj pliki</button>`
  );
  if (state.generating) {
    $('#footerInfo').innerHTML = '<span class="busy"><span class="spinner"></span>Generuję pliki…</span>';
  }
  const genBtn = $('#genBtn');
  if (genBtn) genBtn.addEventListener('click', onGenerate);
}

async function onPick(key) {
  const path = key === 'outDir' ? await window.api.pickFolder() : await window.api.pickFile();
  if (!path) return;
  state[key] = path;
  state.genError = null;
  if (key === 'outDir') { render(); return; }

  // Walidacja pliku: pokazujemy spinner, potem ✓ albo ✕ z komunikatem.
  state.validation[key] = { status: 'checking' };
  render();
  const kind = key === 'playPath' ? 'play' : 'anal';
  let res;
  try {
    res = await window.api.validateSource({ path, kind });
  } catch (err) {
    res = { ok: false, error: (err && err.message) || 'Nie udało się sprawdzić pliku.' };
  }
  // Jeśli w międzyczasie wybrano inny plik, zignoruj nieaktualny wynik.
  if (state[key] !== path) return;
  state.validation[key] = res && res.ok
    ? { status: 'ok' }
    : { status: 'error', error: (res && res.error) || 'Nieprawidłowy plik.' };
  render();
}

async function onGenerate() {
  state.generating = true;
  state.genError = null;
  state.genProgress = null;
  render();

  window.api.onGenerateProgress((p) => {
    state.genProgress = p;
    const fill = $('#genFill');
    const label = $('#genLabel');
    if (fill && label) {
      const v = genProgressView(p);
      fill.style.width = v.pct + '%';
      label.textContent = v.label;
    }
  });

  try {
    const result = await window.api.generate({
      playPath: state.playPath,
      analPath: state.analPath,
      outDir: state.outDir,
    });
    state.result = result;
    // Regenerating resets downstream send progress.
    state.sendResults = {};
    state.rowSending = {};
    state.sendDone = false;
    state.generating = false;
    state.step = 2;
    render();
  } catch (err) {
    state.generating = false;
    state.genError = (err && err.message) ? err.message : String(err);
    render();
  }
}

// ----- Step 2: Pliki (ledger) -----
function channelPill(kanal) {
  const db = kanal === 'DB';
  return `<span class="pill pill-channel ${db ? 'db' : ''}">${esc(kanal)}</span>`;
}

// Nazwa pliku z pełnej ścieżki (obsługa \ i /).
function baseName(p) {
  return String(p || '').split(/[\\/]/).pop();
}

// Czy plik ma choć jeden adres? (model: f.emails to lista 0..n adresów)
function hasEmail(f) { return Array.isArray(f.emails) && f.emails.length > 0; }
// Maile do wyświetlenia w tabeli (lub znacznik braku).
function emailsLabel(f) {
  return hasEmail(f) ? esc(f.emails.join(', ')) : '<span class="muted">— brak —</span>';
}

function renderStep2() {
  const panel = $('#panel');
  const r = state.result;
  const missing = r.files.filter((f) => !hasEmail(f)).length;

  const rows = r.files.map((f, i) => {
    return `
    <tr data-org="${esc(f.organizacja)}">
      <td class="org">${esc(f.organizacja)}</td>
      <td>${channelPill(f.kanal)}</td>
      <td class="sid mono">${esc(f.sidy.join(', '))}</td>
      <td class="mono file-name">${esc(baseName(f.path))}</td>
      <td class="open-cell">
        <button class="btn btn-secondary btn-sm" type="button" data-open="${i}">Otwórz</button>
      </td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <h1 class="panel-title">Krok 2 · Pliki</h1>
    <p class="panel-sub">Wygenerowano ${r.files.length} ${plik(r.files.length)} · <span class="mono">${esc(r.folder)}</span></p>
    ${r.multiplePeriods ? periodWarning(r) : ''}
    <div class="ledger-wrap">
      <table class="ledger">
        <thead>
          <tr>
            <th>Organizacja</th>
            <th>Kanał</th>
            <th class="num">SID-y</th>
            <th>Plik</th>
            <th>Podgląd</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${missing > 0 ? `<p class="note-warn">${missing} ${plik(missing)} bez adresu e-mail — ${missing === 1 ? 'zostanie pominięty' : 'zostaną pominięte'} przy wysyłce. Adresy uzupełnisz w konfiguracji (⚙).</p>` : ''}
  `;

  panel.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => onOpenFile(Number(btn.dataset.open)));
  });

  // Do wysyłki wystarczy choć jeden adres — brakujące zostaną pominięte (z potwierdzeniem).
  const ready = r.files.some(hasEmail);
  setFooter(
    `Wygenerowano ${r.files.length} ${plik(r.files.length)} w „Prowizje ${esc(r.period)}".`,
    `<button class="btn btn-secondary" id="backBtn" type="button">← Wróć</button>
     <button class="btn btn-primary" id="toSendBtn" type="button" ${ready ? '' : 'disabled'}>Przejdź do wysyłki</button>`
  );
  $('#backBtn').addEventListener('click', () => goStep(1));
  $('#toSendBtn').addEventListener('click', () => goStep(3));
}

// Otwiera wygenerowany plik .xlsx w domyślnym programie (Excel) — podgląd w kroku 2.
async function onOpenFile(i) {
  const f = state.result.files[i];
  if (!f || !f.path) return;
  try {
    const res = await window.api.openFile(f.path);
    if (res && !res.ok) {
      alert(`Nie udało się otworzyć pliku:\n${res.error || 'nieznany błąd'}`);
    }
  } catch (err) {
    alert(`Nie udało się otworzyć pliku:\n${(err && err.message) || 'nieznany błąd'}`);
  }
}

function plik(n) {
  if (n === 1) return 'plik';
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'pliki';
  return 'plików';
}
function wiersz(n) {
  if (n === 1) return 'wiersz';
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'wiersze';
  return 'wierszy';
}
// YYYYMM -> MM.YYYY (czytelny okres dla użytkownika)
function fmtOkres(yyyymm) {
  const s = String(yyyymm).trim();
  if (!/^\d{6}$/.test(s)) return s;
  return `${s.slice(4, 6)}.${s.slice(0, 4)}`;
}
function periodWarning(r) {
  const lista = (r.periodBreakdown || []).map(({ okres, liczba }) => {
    const wybrany = fmtOkres(okres) === r.period;
    return `<li${wybrany ? ' class="period-chosen"' : ''}>
      <span class="mono">${esc(fmtOkres(okres))}</span>
      <span class="period-count">— ${liczba} ${wiersz(liczba)}</span>
      ${wybrany ? '<span class="period-badge">użyty do generowania</span>' : ''}
    </li>`;
  }).join('');
  return `<div class="banner banner-amber">
    <span class="banner-icon">⚠</span>
    <div class="banner-body">
      <strong>Uwaga: w danych wykryto więcej niż jeden okres rozliczeniowy.</strong>
      <p>Pliki wygenerowano dla okresu <span class="mono">${esc(r.period)}</span> (najczęściej występujący w danych). Sprawdź, czy to właściwy okres — jeśli źródła zawierają mieszane dane, część transakcji mogła trafić do niewłaściwych plików.</p>
      <ul class="period-list">${lista}</ul>
    </div>
  </div>`;
}
function wiadomosc(n) {
  if (n === 1) return 'wiadomość';
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'wiadomości';
  return 'wiadomości';
}

// ----- Step 3: Wysyłka -----
function renderStep3() {
  const panel = $('#panel');
  const files = state.result.files;
  const total = files.length;
  const sendable = files.filter(hasEmail).length; // ile plików faktycznie pójdzie

  const rows = files.map((f) => {
    const s = state.sendResults[f.organizacja];
    let status;
    if (!hasEmail(f)) status = `<span class="row-status pending" title="Brak adresu e-mail — plik pominięty">⤬ pominięto — brak maila</span>`;
    else if (!s) status = `<span class="row-status pending">—</span>`;
    else if (s.skipped) status = `<span class="row-status pending">⤬ pominięto — brak maila</span>`;
    else if (s.ok) status = `<span class="row-status status-ok"><span class="icon">✓</span> wysłano</span>`;
    else status = `<span class="row-status status-err"><span class="icon">✗</span> ${esc(s.error || 'błąd')}</span>`;
    return `
      <tr data-org="${esc(f.organizacja)}">
        <td class="org">${esc(f.organizacja)}</td>
        <td class="mono">${emailsLabel(f)}</td>
        <td class="status-cell">${status}</td>
      </tr>`;
  }).join('');

  const okCount = Object.values(state.sendResults).filter((s) => s.ok).length;
  const skipCount = files.filter((f) => !hasEmail(f)).length;
  // Prawdziwe błędy SMTP (nie pominięcia z braku maila).
  const fails = files.filter((f) => { const s = state.sendResults[f.organizacja]; return s && !s.ok && !s.skipped; });

  panel.innerHTML = `
    <h1 class="panel-title">Krok 3 · Wysyłka</h1>
    <p class="panel-sub">Do wysłania: ${sendable} ${wiadomosc(sendable)}${skipCount ? ` · ${skipCount} bez maila ${skipCount === 1 ? 'pominięty' : 'pominięte'}` : ''}, odstęp pobrany z konfiguracji.</p>
    ${state.sending || state.sendDone ? `
      <div class="card">
        <div class="progress-track"><div class="progress-fill" id="progFill"></div></div>
        <div class="progress-label" id="progLabel"></div>
      </div>` : ''}
    ${state.sendDone ? `
      <div class="banner ${fails.length ? 'banner-amber' : ''}" style="${fails.length ? '' : 'background:#E6F3EC;border-color:#BFE3CF;color:var(--ok)'}">
        <span class="banner-icon">${fails.length ? '⚠' : '✓'}</span>
        <span>Wysłano ${okCount}/${sendable}.${skipCount ? ` Pominięto ${skipCount} bez adresu.` : ''}${fails.length ? ' Nie udało się wysłać: ' + fails.map((f) => esc(f.organizacja)).join(', ') + '.' : ''}</span>
      </div>` : ''}
    <div class="ledger-wrap" style="margin-top:${state.sending || state.sendDone ? '16px' : '0'}">
      <table class="ledger">
        <thead>
          <tr><th>Organizacja</th><th>E-mail</th><th>Status</th></tr>
        </thead>
        <tbody id="sendBody">${rows}</tbody>
      </table>
    </div>
  `;

  if (state.sendDone) {
    setFooter(`Zakończono: wysłano ${okCount} z ${sendable}.${skipCount ? ` Pominięto ${skipCount} bez adresu.` : ''}`, `<button class="btn btn-secondary" id="backBtn" type="button">← Wróć</button>`);
    $('#backBtn').addEventListener('click', () => goStep(2));
  } else {
    setFooter('', `
      <button class="btn btn-secondary" id="backBtn" type="button" ${state.sending ? 'disabled' : ''}>← Wróć</button>
      <button class="btn btn-primary" id="sendBtn" type="button" ${state.sending ? 'disabled' : ''}>Wyślij wszystkie</button>`);
    const back = $('#backBtn');
    if (back) back.addEventListener('click', () => goStep(2));
    $('#sendBtn').addEventListener('click', onSendAll);
  }

  if (state.sending) {
    $('#progLabel').textContent = 'Przygotowuję wysyłkę…';
  }
}

async function onSendAll() {
  const allFiles = state.result.files;
  const withEmail = allFiles.filter(hasEmail);
  const missing = allFiles.length - withEmail.length;

  // Jeśli części plików brakuje adresu — wyraźne potwierdzenie, że wyślemy tylko resztę.
  if (missing > 0) {
    const brakujace = allFiles.filter((f) => !hasEmail(f)).map((f) => f.organizacja);
    const lista = brakujace.slice(0, 12).join(', ') + (brakujace.length > 12 ? `, …(+${brakujace.length - 12})` : '');
    const ok = window.confirm(
      `Uwaga: ${missing} z ${allFiles.length} ${plik(allFiles.length)} nie ma przypisanego adresu e-mail ` +
      `i ${missing === 1 ? 'zostanie pominięty' : 'zostaną pominięte'}.\n\n` +
      `Bez adresu: ${lista}\n\n` +
      `Czy na pewno wysłać pozostałe ${withEmail.length} ${wiadomosc(withEmail.length)}?`
    );
    if (!ok) return;
  }

  state.sending = true;
  state.sendDone = false;
  state.sendResults = {};
  render();

  const files = state.result.files;
  const total = files.length;

  window.api.onSendProgress((p) => {
    if (p && p.last) {
      state.sendResults[p.last.organizacja] = { ok: p.last.ok, error: p.last.error, skipped: p.last.skipped };
      updateSendRow(p.last.organizacja);
    }
    const fill = $('#progFill');
    const label = $('#progLabel');
    if (fill && label) {
      const pct = p.total ? Math.round((p.index / p.total) * 100) : 0;
      fill.style.width = pct + '%';
      const verdict = p.last ? (p.last.skipped ? 'POMINIĘTO' : (p.last.ok ? 'OK' : 'BŁĄD')) : '';
      label.textContent = `Wysyłam ${p.index}/${p.total}: ${p.last ? p.last.organizacja : ''} — ${verdict}`;
    }
  });

  try {
    const results = await window.api.sendAll({
      files: files.map((f) => ({ organizacja: f.organizacja, emails: f.emails, path: f.path })),
      period: state.result.period,
    });
    (results || []).forEach((r) => {
      state.sendResults[r.organizacja] = { ok: r.ok, error: r.error, skipped: r.skipped };
    });
  } catch (err) {
    files.forEach((f) => {
      if (!state.sendResults[f.organizacja]) {
        state.sendResults[f.organizacja] = { ok: false, error: (err && err.message) || 'błąd wysyłki' };
      }
    });
  }
  state.sending = false;
  state.sendDone = true;
  const fill = $('#progFill');
  if (fill) fill.style.width = '100%';
  render();
}

function updateSendRow(org) {
  const body = $('#sendBody');
  if (!body) return;
  const row = body.querySelector(`tr[data-org="${cssEscape(org)}"]`);
  if (!row) return;
  const s = state.sendResults[org];
  const cell = $('.status-cell', row);
  if (s.skipped) cell.innerHTML = `<span class="row-status pending">⤬ pominięto — brak maila</span>`;
  else if (s.ok) cell.innerHTML = `<span class="row-status status-ok"><span class="icon">✓</span> wysłano</span>`;
  else cell.innerHTML = `<span class="row-status status-err"><span class="icon">✗</span> ${esc(s.error || 'błąd')}</span>`;
}

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}

// ===== Footer helper =====
function setFooter(infoHtml, actionsHtml) {
  $('#footerInfo').innerHTML = infoHtml;
  $('#footerActions').innerHTML = actionsHtml;
}

// ===== Wire stepper clicks =====
document.querySelectorAll('.step').forEach((el) => {
  el.addEventListener('click', () => goStep(Number(el.dataset.step)));
});

// ===== Konfiguracja w osobnym oknie =====
const configBtn = $('#configBtn');
if (configBtn) configBtn.addEventListener('click', () => window.api.openConfig());

// Po zamknięciu okna konfiguracji odśwież adresy e-mail dla wygenerowanych plików.
// Adres rozwiązujemy po SID-ach pliku (nie po nazwie), więc kluczem jest lista SID-ów.
const sidKey = (sidy) => (sidy || []).join('|');
window.api.onConfigUpdated(async () => {
  if (!state.result) return;
  const files = state.result.files.map((f) => ({ organizacja: f.organizacja, sidy: f.sidy }));
  let resolved;
  try {
    resolved = await window.api.resolveEmails(files);
  } catch {
    return;
  }
  const byKey = {};
  (resolved || []).forEach((r) => { byKey[sidKey(r.sidy)] = r; });
  state.result.files.forEach((f) => {
    const r = byKey[sidKey(f.sidy)];
    if (r) { f.emails = r.emails || []; }
  });
  render();
});

// ===== Auto-aktualizacja: blokujący modal (wymuszona aktualizacja) =====
// Gdy wykryto nowszą wersję ('required') → pełnoekranowy modal blokuje UI.
//   Anuluj   → zamyka aplikację.
//   Aktualizuj → start pobierania; modal zmienia się w progressbar.
// Po pobraniu apka sama się instaluje i uruchamia ponownie (główny proces).
(function wireUpdateModal() {
  const overlay = document.getElementById('updateOverlay');
  if (!overlay || !window.api.onUpdateStatus) return;
  const text = document.getElementById('updateText');
  const actions = document.getElementById('updateActions');
  const progress = document.getElementById('updateProgress');
  const barFill = document.getElementById('updateBarFill');
  const barLabel = document.getElementById('updateBarLabel');
  const title = document.getElementById('updateTitle');
  const startBtn = document.getElementById('updateStartBtn');
  const cancelBtn = document.getElementById('updateCancelBtn');

  function showProgress(pct) {
    actions.hidden = true;
    progress.hidden = false;
    barFill.style.width = `${pct}%`;
    barLabel.textContent = `Pobieram… ${pct}%`;
  }

  startBtn.addEventListener('click', () => {
    showProgress(0);
    window.api.startUpdate();
  });
  cancelBtn.addEventListener('click', () => {
    // Zablokuj przyciski, by nie klikać dwa razy; główny proces zamknie apkę.
    cancelBtn.disabled = true;
    startBtn.disabled = true;
    window.api.cancelUpdate();
  });

  window.api.onUpdateStatus((p) => {
    if (!p) return;
    if (p.state === 'required') {
      title.textContent = 'Wymagana aktualizacja';
      text.textContent = p.version
        ? `Dostępna jest nowa wersja ${p.version}. Aby kontynuować, zaktualizuj aplikację.`
        : 'Dostępna jest nowa wersja. Aby kontynuować, zaktualizuj aplikację.';
      actions.hidden = false;
      progress.hidden = true;
      overlay.hidden = false;
    } else if (p.state === 'downloading') {
      showProgress(p.percent ?? 0);
    } else if (p.state === 'installing') {
      progress.hidden = false;
      actions.hidden = true;
      barFill.style.width = '100%';
      barLabel.textContent = 'Instaluję i uruchamiam ponownie…';
    } else if (p.state === 'error') {
      // Błąd pobierania — pokaż komunikat i pozwól spróbować ponownie lub anulować.
      title.textContent = 'Błąd aktualizacji';
      text.textContent = `Nie udało się pobrać aktualizacji: ${p.message || 'nieznany błąd'}. Spróbuj ponownie lub zamknij program.`;
      progress.hidden = true;
      actions.hidden = false;
      startBtn.disabled = false;
      cancelBtn.disabled = false;
      startBtn.textContent = 'Spróbuj ponownie';
      overlay.hidden = false;
    }
    // 'current' → brak aktualizacji, nic nie pokazujemy (overlay zostaje ukryty).
  });
})();

// Pokaż numer wersji w nagłówku (dyskretnie obok nazwy) i w tytule okna.
(async function showVersion() {
  try {
    const v = window.api.getVersion ? await window.api.getVersion() : null;
    if (!v) return;
    const badge = document.getElementById('appVersion');
    if (badge) badge.textContent = `v${v}`;
    document.title = `Maszynka do prowizji ${v}`;
  } catch { /* ignoruj */ }
})();

render();
