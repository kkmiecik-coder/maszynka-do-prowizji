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
          // Zachowujemy PIERWSZY błąd kopii (jeden na job wystarcza do diagnostyki);
          // kopia w „Wysłane" i tak nie wpływa na powodzenie wysyłki.
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

export async function verifySmtp(deps, smtp) {
  const t = deps.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined });
  await t.verify();
  return true;
}
