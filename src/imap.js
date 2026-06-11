// Zapis kopii wysłanej wiadomości do folderu „Wysłane" na serwerze IMAP.
// Dzięki temu nadawca widzi wysłane prowizje w swoim Outlooku/OWA, mimo że
// wysyłka idzie przez SMTP z tej aplikacji (a nie z klienta pocztowego).
//
// Czysta logika: klient IMAP (ImapFlow) i builder RFC822 (nodemailer MailComposer)
// są wstrzykiwane przez `deps`, więc testy podają atrapy bez sieci.

export function isImapConfigured(imap) {
  return !!(imap && imap.host && imap.host.trim() && imap.user && imap.user.trim());
}

// Typowe nazwy folderu wysłanych (różne serwery/lokalizacje) — fallback, gdy
// serwer nie udostępnia atrybutu SPECIAL-USE „\Sent".
const SENT_FALLBACKS = [
  'Sent', 'Wysłane', 'Wyslane', 'Elementy wysłane', 'Sent Items', 'Sent Mail',
  'INBOX.Sent', 'INBOX.Wysłane',
];

// Wybiera folder „Wysłane" na serwerze. Kolejność:
//  1. Nazwa podana przez użytkownika, jeśli taki folder REALNIE istnieje.
//  2. Autodetekcja: folder z atrybutem SPECIAL-USE „\Sent" (RFC 6154) —
//     działa niezależnie od języka/nazwy (Sent, Wysłane, Elementy wysłane…).
//  3. Pierwsza pasująca typowa nazwa z listy fallback.
// Zwraca nazwę folderu albo null, gdy nic nie pasuje.
export async function pickSentMailbox(client, requested) {
  const list = await client.list();
  const paths = list.map((m) => m.path);
  const want = (requested || '').trim();

  if (want && paths.includes(want)) return want;

  const special = list.find((m) => m.specialUse === '\\Sent');
  if (special) return special.path;

  // Dopasowanie po typowych nazwach (case-insensitive).
  const lower = new Map(paths.map((p) => [p.toLowerCase(), p]));
  for (const name of SENT_FALLBACKS) {
    const hit = lower.get(name.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function makeClient(deps, imap) {
  return new deps.ImapClient({
    host: imap.host,
    port: imap.port || 993,
    secure: imap.secure !== false, // domyślnie IMAPS (993)
    auth: { user: imap.user, pass: imap.password },
    logger: false,
  });
}

// Zwraca funkcję saveSent(message, vars) gotową do wstrzyknięcia w sendBatch,
// albo null gdy IMAP nie jest skonfigurowany (wtedy kopie po prostu nie powstają).
export function makeSaveSent(deps, imap) {
  if (!isImapConfigured(imap)) return null;

  return async function saveSent(message) {
    // Składamy surową wiadomość RFC822 (taką samą jak wysłana SMTP-em).
    const raw = await deps.buildRaw(message);
    const client = makeClient(deps, imap);
    await client.connect();
    try {
      // Autodetekcja folderu wysłanych; gdy nic nie znaleziono — próbujemy
      // podaną nazwę (lub „Sent"), niech serwer sam ją zaakceptuje/odrzuci.
      const mailbox = (await pickSentMailbox(client, imap.sentMailbox))
        || (imap.sentMailbox && imap.sentMailbox.trim()) || 'Sent';
      // \Seen — to kopia nadawcy, nie chcemy jej jako „nieprzeczytaną".
      const appended = await client.append(mailbox, raw, ['\\Seen']);
      // Dołączamy nazwę folderu, do którego trafiła kopia (przydatne w UI).
      return { ...(appended || {}), mailbox };
    } finally {
      await client.logout();
    }
  };
}

// Test połączenia IMAP + wykrycie folderu „Wysłane". Zwraca { ok, mailbox } lub
// { ok:false, error }. Klient jest wstrzykiwany (deps.ImapClient) — testowalne.
export async function testImap(deps, imap) {
  if (!isImapConfigured(imap)) {
    return { ok: false, error: 'Podaj serwer IMAP i login, aby zapisywać kopie w „Wysłane".' };
  }
  const client = makeClient(deps, imap);
  try {
    await client.connect();
    const mailbox = await pickSentMailbox(client, imap.sentMailbox);
    await client.logout();
    if (!mailbox) {
      return { ok: false, error: 'Połączono, ale nie znaleziono folderu „Wysłane". Wpisz jego dokładną nazwę z serwera.' };
    }
    return { ok: true, mailbox };
  } catch (e) {
    try { await client.logout(); } catch {}
    return { ok: false, error: e.message };
  }
}
