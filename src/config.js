// Dopasowanie maila po SAMYM SID — nazwa Organizacji bywa niespójna między
// źródłem a CSV (polskie znaki, drobne różnice w pisowni), więc SID jest
// jedynym pewnym kluczem. SID-y są porównywane dokładnym stringiem (apostrof
// znaczący). `file` to { organizacja?, sidy: string[] }; `organizacja` służy
// już tylko do czytelnego komunikatu błędu.
export function resolveRecipient(cfg, file) {
  const sidy = (file?.sidy || []).map(s => String(s));
  const sidSet = new Set(sidy);
  const label = file?.organizacja || sidy.join(', ') || '(brak SID)';
  const entries = (cfg.mapping || []).filter(m => sidSet.has(String(m.sid)) && m.email?.trim());
  const emails = [...new Set(entries.map(m => m.email))];
  if (emails.length === 0) return { error: `Brak emaila dla: ${label}` };
  if (emails.length > 1) return { error: `Różne maile dla: ${label}` };
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
  // Opcjonalna kopia wysłanych w folderze „Wysłane" przez IMAP (puste = wyłączone).
  imap: { host: '', port: 993, secure: true, user: '', sentMailbox: '', passwordEnc: null },
  mail: { subject: 'Prowizja {okres}', body: 'W załączniku rozliczenie prowizji dla {Organizacja} za {okres}.', footer: '', delaySeconds: 5 },
  mapping: [],
};

export async function loadConfig(deps, path) {
  let raw;
  try { raw = await deps.readFile(path, 'utf8'); } catch { return structuredClone(DEFAULT); }
  const parsed = JSON.parse(raw);
  // Scal per-sekcję, by stare pliki bez sekcji imap dostały domyślne pola.
  const cfg = {
    ...structuredClone(DEFAULT),
    ...parsed,
    smtp: { ...DEFAULT.smtp, ...(parsed.smtp || {}) },
    imap: { ...DEFAULT.imap, ...(parsed.imap || {}) },
    mail: { ...DEFAULT.mail, ...(parsed.mail || {}) },
  };
  cfg.smtp.password = cfg.smtp.passwordEnc ? deps.decrypt(cfg.smtp.passwordEnc) : '';
  cfg.imap.password = cfg.imap.passwordEnc ? deps.decrypt(cfg.imap.passwordEnc) : '';
  return cfg;
}

export async function saveConfig(deps, path, cfg) {
  const toSave = structuredClone(cfg);
  for (const section of ['smtp', 'imap']) {
    if (!toSave[section]) continue;
    if (cfg[section]?.password) {
      toSave[section].passwordEnc = deps.encrypt(cfg[section].password);
    } else {
      toSave[section].passwordEnc = null;
    }
    delete toSave[section].password;
  }
  await deps.writeFile(path, JSON.stringify(toSave, null, 2), 'utf8');
}
