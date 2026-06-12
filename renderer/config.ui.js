'use strict';

const $ = (sel) => document.querySelector(sel);

let cfg = {
  smtp: { host: '', port: 587, secure: false, user: '', password: '', from: '', passwordEnc: null },
  mail: { subject: '', body: '', footer: '', delaySeconds: 5 },
  mapping: [],
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ===== Load =====
async function init() {
  const loaded = await window.api.loadConfig();
  if (loaded) cfg = loaded;
  cfg.smtp = cfg.smtp || {};
  cfg.mail = cfg.mail || {};
  cfg.mapping = cfg.mapping || [];
  populate();
  renderMapping();
}

function populate() {
  const imap = cfg.imap || {};
  // Login i hasło są wspólne — bierzemy ze SMTP (fallback do IMAP dla starych configów,
  // gdzie IMAP mógł mieć osobne dane logowania).
  $('#user').value = cfg.smtp.user || imap.user || '';
  $('#password').value = cfg.smtp.password || imap.password || '';
  $('#from').value = cfg.smtp.from || '';
  $('#host').value = cfg.smtp.host || '';
  $('#port').value = cfg.smtp.port ?? 587;
  $('#secure').value = cfg.smtp.secure ? 'true' : 'false';
  $('#imapHost').value = imap.host || '';
  $('#imapPort').value = imap.port ?? 993;
  $('#imapSecure').value = imap.secure === false ? 'false' : 'true';
  $('#imapSentMailbox').value = imap.sentMailbox || ''; // puste = autodetekcja
  $('#subject').value = cfg.mail.subject || '';
  $('#body').value = cfg.mail.body || '';
  $('#footer').value = cfg.mail.footer || '';
  $('#delaySeconds').value = cfg.mail.delaySeconds ?? 5;
  updateFooterPreview();
}

// Podgląd stopki: wstawiamy surowy HTML i podstawiamy przykładowe zmienne,
// żeby było widać jak wyjdzie w mailu.
function updateFooterPreview() {
  const html = String($('#footer').value || '')
    .replaceAll('{Organizacja}', 'Przykładowa Organizacja')
    .replaceAll('{okres}', '04.2026');
  const box = $('#footerPreview');
  if (html.trim()) {
    box.innerHTML = html;
    box.classList.remove('empty');
  } else {
    box.textContent = 'Podgląd pojawi się tutaj.';
    box.classList.add('empty');
  }
}

// ===== Collect form into cfg =====
function collect() {
  // Login i hasło są wspólne dla SMTP i IMAP — kopiujemy je do obu sekcji,
  // by backend (osobne sekcje cfg.smtp / cfg.imap) działał bez zmian.
  const user = $('#user').value.trim();
  const password = $('#password').value;
  return {
    smtp: {
      host: $('#host').value.trim(),
      port: Number($('#port').value) || 0,
      secure: $('#secure').value === 'true',
      user,
      password,
      from: $('#from').value.trim(),
      passwordEnc: cfg.smtp.passwordEnc ?? null,
    },
    imap: {
      host: $('#imapHost').value.trim(),
      port: Number($('#imapPort').value) || 993,
      secure: $('#imapSecure').value === 'true',
      user,
      password,
      sentMailbox: $('#imapSentMailbox').value.trim(), // puste = autodetekcja na serwerze
      passwordEnc: (cfg.imap && cfg.imap.passwordEnc) ?? null,
    },
    mail: {
      subject: $('#subject').value,
      body: $('#body').value,
      footer: $('#footer').value,
      delaySeconds: Number($('#delaySeconds').value) || 0,
    },
    mapping: cfg.mapping,
  };
}

// ===== Mapping table =====
function renderMapping() {
  const body = $('#mapBody');
  if (!cfg.mapping.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">Brak adresatów. Dodaj ręcznie lub zaimportuj plik CSV.</td></tr>`;
    return;
  }
  body.innerHTML = cfg.mapping.map((m, i) => `
    <tr>
      <td>${esc(m.organizacja)}</td>
      <td class="mono">${esc(m.sid)}</td>
      <td class="mono">${esc(m.email)}</td>
      <td><button class="btn-icon" type="button" data-del="${i}" title="Usuń" aria-label="Usuń adresata">✕</button></td>
    </tr>`).join('');
  body.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cfg.mapping.splice(Number(btn.dataset.del), 1);
      renderMapping();
    });
  });
}

// ===== Actions =====
$('#testBtn').addEventListener('click', async () => {
  const res = $('#testResult');
  res.innerHTML = '<span class="busy"><span class="spinner"></span>Testuję…</span>';
  const smtp = collect().smtp;
  try {
    const r = await window.api.testSmtp(smtp);
    if (r && r.ok) res.innerHTML = '<span class="status-ok">✓ połączenie OK</span>';
    else res.innerHTML = `<span class="status-err">✗ ${esc((r && r.error) || 'błąd połączenia')}</span>`;
  } catch (err) {
    res.innerHTML = `<span class="status-err">✗ ${esc((err && err.message) || 'błąd połączenia')}</span>`;
  }
});

$('#imapTestBtn').addEventListener('click', async () => {
  const res = $('#imapTestResult');
  res.innerHTML = '<span class="busy"><span class="spinner"></span>Testuję…</span>';
  const imap = collect().imap;
  try {
    const r = await window.api.testImap(imap);
    if (r && r.ok) {
      // Pokaż wykryty folder i podpowiedz wpisanie go na stałe.
      res.innerHTML = `<span class="status-ok">✓ połączenie OK · folder: „${esc(r.mailbox)}"</span>`;
      const box = $('#imapSentMailbox');
      if (box && r.mailbox && box.value.trim() !== r.mailbox) box.value = r.mailbox;
    } else {
      res.innerHTML = `<span class="status-err">✗ ${esc((r && r.error) || 'błąd połączenia')}</span>`;
    }
  } catch (err) {
    res.innerHTML = `<span class="status-err">✗ ${esc((err && err.message) || 'błąd połączenia')}</span>`;
  }
});

$('#addBtn').addEventListener('click', () => {
  const organizacja = $('#newOrg').value.trim();
  const sid = $('#newSid').value.trim();
  const email = $('#newEmail').value.trim();
  if (!organizacja && !sid && !email) return;
  cfg.mapping.push({ organizacja, sid, email });
  $('#newOrg').value = '';
  $('#newSid').value = '';
  $('#newEmail').value = '';
  renderMapping();
  $('#newOrg').focus();
});

$('#sampleBtn').addEventListener('click', async () => {
  const res = $('#testResult');
  res.innerHTML = '<span class="busy"><span class="spinner"></span>Wysyłam próbny mail…</span>';
  const { smtp, mail, imap } = collect();
  try {
    const r = await window.api.sendTest({ smtp, mail, imap });
    if (r && r.ok) {
      // Mail wysłany. Jeśli była próba kopii w „Wysłane" — pokaż wynik.
      let extra = '';
      if (r.copyOk) extra = ` · kopia w „${esc(r.copyMailbox)}"`;
      else if (r.copyError) extra = ` · ⚠ kopia w „Wysłane" nieudana: ${esc(r.copyError)}`;
      res.innerHTML = `<span class="status-ok">✓ wysłano na ${esc(r.to)}${extra}</span>`;
    } else {
      res.innerHTML = `<span class="status-err">✗ ${esc((r && r.error) || 'błąd wysyłki')}</span>`;
    }
  } catch (err) {
    res.innerHTML = `<span class="status-err">✗ ${esc((err && err.message) || 'błąd wysyłki')}</span>`;
  }
});

$('#footer').addEventListener('input', updateFooterPreview);

$('#closeBtn').addEventListener('click', () => window.close());
$('#closeBtn2').addEventListener('click', () => window.close());

$('#importBtn').addEventListener('click', () => $('#csvInput').click());

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

$('#saveBtn').addEventListener('click', async () => {
  const status = $('#saveStatus');
  const next = collect();
  try {
    await window.api.saveConfig(next);
    cfg = next;
    status.innerHTML = '<span class="status-ok">Zapisano ✓</span>';
    setTimeout(() => { status.innerHTML = ''; }, 3000);
  } catch (err) {
    status.innerHTML = `<span class="status-err">✗ Nie udało się zapisać: ${esc((err && err.message) || '')}</span>`;
  }
});

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

init();
