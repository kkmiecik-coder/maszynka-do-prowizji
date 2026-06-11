import { basename } from 'node:path';

export function renderTemplate(template, footer, vars) {
  let out = template
    .replaceAll('{Organizacja}', vars.organizacja ?? '')
    .replaceAll('{okres}', vars.okres ?? '');
  if (footer) out += `\n\n${footer}`;
  return out;
}

function subst(s, vars) {
  return String(s ?? '')
    .replaceAll('{Organizacja}', vars.organizacja ?? '')
    .replaceAll('{okres}', vars.okres ?? '');
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// HTML-owa wersja wiadomości: treść jest zwykłym tekstem (escape + zachowane
// nowe linie), a stopka jest wklejana jako SUROWY HTML — użytkownik podaje
// gotowy kod HTML stopki (logo, linki, podpis), więc go nie escape'ujemy.
export function renderHtml(bodyTemplate, footerHtml, vars) {
  const bodyHtml = escHtml(subst(bodyTemplate, vars)).replace(/\r?\n/g, '<br>\n');
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f1430;line-height:1.5">${bodyHtml}</div>`;
  const footer = subst(footerHtml, vars);
  if (footer.trim()) html += `<div style="margin-top:18px">${footer}</div>`;
  return html;
}

export async function sendBatch(deps, smtp, mail, jobs, onProgress = () => {}) {
  const transport = deps.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  const results = [];
  let lastSentIdx = -1; // indeks ostatniego REALNIE wysłanego maila (do antyspamowego odstępu)
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    // Brak adresu e-mail → pomijamy bez próby wysyłki. Taki plik nie jest błędem
    // SMTP, tylko świadomie pominięty (użytkownik potwierdził brak części maili).
    if (!job.email || !String(job.email).trim()) {
      results.push({ organizacja: job.organizacja, ok: false, skipped: true });
      onProgress({ index: i + 1, total: jobs.length, last: results[i] });
      continue;
    }
    const vars = { organizacja: job.organizacja, okres: job.period };
    // Odstęp antyspamowy liczymy MIĘDZY realnie wysłanymi mailami (pominięte nie liczą).
    if (lastSentIdx >= 0 && mail.delaySeconds > 0) await deps.sleep(mail.delaySeconds * 1000);
    try {
      const message = {
        from: smtp.from,
        to: job.email,
        subject: renderTemplate(mail.subject, '', vars),
        text: renderTemplate(mail.body, mail.footer, vars),
        html: renderHtml(mail.body, mail.footer, vars),
        attachments: [{ filename: basename(job.attachmentPath), path: job.attachmentPath }],
      };
      await transport.sendMail(message);
      // Opcjonalna kopia w folderze „Wysłane" przez IMAP (jeśli skonfigurowano).
      // Niepowodzenie zapisu kopii NIE zmienia statusu wysyłki — mail i tak poszedł.
      let copyError;
      if (deps.saveSent) {
        try { await deps.saveSent(message, vars); }
        catch (e) { copyError = e.message; }
      }
      results.push({ organizacja: job.organizacja, ok: true, ...(copyError ? { copyError } : {}) });
      lastSentIdx = i;
    } catch (e) {
      results.push({ organizacja: job.organizacja, ok: false, error: e.message });
    }
    onProgress({ index: i + 1, total: jobs.length, last: results[i] });
  }
  return results;
}

export async function verifySmtp(deps, smtp) {
  const t = deps.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined });
  await t.verify();
  return true;
}
