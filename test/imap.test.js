import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSaveSent, isImapConfigured, pickSentMailbox, testImap } from '../src/imap.js';

// Atrapa list() w stylu ImapFlow: lista folderów z opcjonalnym specialUse.
const FOLDERS = [
  { path: 'INBOX', specialUse: '\\Inbox' },
  { path: 'Kosz', specialUse: '\\Trash' },
  { path: 'Elementy wysłane', specialUse: '\\Sent' }, // serwer oznaczył jako wysłane
  { path: 'Robocze', specialUse: '\\Drafts' },
];

test('pickSentMailbox: preferuje folder z atrybutem \\Sent (autodetekcja)', async () => {
  const client = { list: async () => FOLDERS };
  const pick = await pickSentMailbox(client, '');
  assert.equal(pick, 'Elementy wysłane');
});

test('pickSentMailbox: użytkownik podał nazwę, która istnieje → używa jej', async () => {
  const folders = [{ path: 'INBOX' }, { path: 'Wysłane' }, { path: 'Elementy wysłane', specialUse: '\\Sent' }];
  const client = { list: async () => folders };
  const pick = await pickSentMailbox(client, 'Wysłane');
  assert.equal(pick, 'Wysłane', 'jawny wybór użytkownika ma priorytet, jeśli folder istnieje');
});

test('pickSentMailbox: podana nazwa nie istnieje → autodetekcja \\Sent', async () => {
  const client = { list: async () => FOLDERS };
  const pick = await pickSentMailbox(client, 'Nieistniejący');
  assert.equal(pick, 'Elementy wysłane');
});

test('pickSentMailbox: brak \\Sent → typowa nazwa z fallbacku', async () => {
  const folders = [{ path: 'INBOX' }, { path: 'Sent Items' }, { path: 'Kosz' }];
  const client = { list: async () => folders };
  const pick = await pickSentMailbox(client, '');
  assert.equal(pick, 'Sent Items');
});

test('pickSentMailbox: nic nie pasuje → null', async () => {
  const client = { list: async () => [{ path: 'INBOX' }, { path: 'Cośtam' }] };
  const pick = await pickSentMailbox(client, '');
  assert.equal(pick, null);
});

test('isImapConfigured: wymaga hosta i użytkownika', () => {
  assert.equal(isImapConfigured(null), false);
  assert.equal(isImapConfigured({}), false);
  assert.equal(isImapConfigured({ host: 'imap.x.pl' }), false);
  assert.equal(isImapConfigured({ host: 'imap.x.pl', user: 'u@x.pl' }), true);
});

test('makeSaveSent: zwraca null gdy IMAP nieskonfigurowany', () => {
  assert.equal(makeSaveSent({}, { host: '' }), null);
});

test('makeSaveSent: składa wiadomość RFC822 i robi APPEND do folderu Wysłane', async () => {
  const calls = { connect: 0, append: [], logout: 0 };
  // Fałszywy klient IMAP w stylu ImapFlow
  class FakeImap {
    constructor(opts) { this.opts = opts; }
    async connect() { calls.connect++; }
    async list() { return [{ path: 'INBOX' }, { path: 'Sent', specialUse: '\\Sent' }]; }
    async append(mailbox, content, flags) { calls.append.push({ mailbox, content, flags }); return { uid: 1 }; }
    async logout() { calls.logout++; }
  }
  // Fałszywy builder RFC822 (w realu nodemailer MailComposer)
  const buildRaw = async (message) => Buffer.from(`To: ${message.to}\r\nSubject: ${message.subject}\r\n\r\nbody`);

  const imap = { host: 'imap.x.pl', port: 993, secure: true, user: 'u@x.pl', password: 'pw', sentMailbox: 'Sent' };
  const saveSent = makeSaveSent({ ImapClient: FakeImap, buildRaw }, imap);
  assert.equal(typeof saveSent, 'function');

  const res = await saveSent({ to: 'a@x.pl', subject: 'Prowizja' }, {});
  assert.equal(calls.connect, 1);
  assert.equal(calls.append.length, 1);
  assert.equal(calls.append[0].mailbox, 'Sent');
  assert.ok(Buffer.isBuffer(calls.append[0].content));
  assert.match(calls.append[0].content.toString(), /To: a@x\.pl/);
  // wiadomość oznaczona jako przeczytana (\\Seen), bo to kopia nadawcy
  assert.deepEqual(calls.append[0].flags, ['\\Seen']);
  assert.equal(calls.logout, 1);
  assert.equal(res.uid, 1);
  assert.equal(res.mailbox, 'Sent', 'zwrotka zawiera nazwę folderu kopii');
});

test('makeSaveSent: autodetekcja folderu \\Sent gdy nazwa nie podana', async () => {
  const appended = [];
  class FakeImap {
    async connect() {}
    async list() { return [{ path: 'INBOX' }, { path: 'Elementy wysłane', specialUse: '\\Sent' }]; }
    async append(mailbox) { appended.push(mailbox); }
    async logout() {}
  }
  const buildRaw = async () => Buffer.from('raw');
  const saveSent = makeSaveSent(
    { ImapClient: FakeImap, buildRaw },
    { host: 'imap.x.pl', user: 'u@x.pl' }, // brak sentMailbox
  );
  await saveSent({ to: 'a@x.pl' }, {});
  assert.equal(appended[0], 'Elementy wysłane', 'powinien wykryć folder po atrybucie \\Sent');
});

test('makeSaveSent: fallback do podanej/„Sent" gdy autodetekcja nic nie znajdzie', async () => {
  const appended = [];
  class FakeImap {
    async connect() {}
    async list() { return [{ path: 'INBOX' }]; } // brak \\Sent, brak typowych nazw
    async append(mailbox) { appended.push(mailbox); }
    async logout() {}
  }
  const buildRaw = async () => Buffer.from('raw');
  const saveSent = makeSaveSent({ ImapClient: FakeImap, buildRaw }, { host: 'h', user: 'u', sentMailbox: 'Wysłane' });
  await saveSent({ to: 'a@x.pl' }, {});
  assert.equal(appended[0], 'Wysłane', 'gdy nic nie pasuje, próbujemy podaną nazwę');
});

test('testImap: zwraca wykryty folder przy poprawnym połączeniu', async () => {
  class FakeImap {
    async connect() {}
    async list() { return [{ path: 'INBOX' }, { path: 'Wysłane', specialUse: '\\Sent' }]; }
    async logout() {}
  }
  const r = await testImap({ ImapClient: FakeImap }, { host: 'h', user: 'u', password: 'p' });
  assert.deepEqual(r, { ok: true, mailbox: 'Wysłane' });
});

test('testImap: błąd gdy nie wykryto folderu Wysłane', async () => {
  class FakeImap {
    async connect() {}
    async list() { return [{ path: 'INBOX' }]; }
    async logout() {}
  }
  const r = await testImap({ ImapClient: FakeImap }, { host: 'h', user: 'u' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Wysłane/);
});

test('testImap: błąd połączenia raportowany, nie rzuca', async () => {
  class FakeImap {
    async connect() { throw new Error('auth failed'); }
    async logout() {}
  }
  const r = await testImap({ ImapClient: FakeImap }, { host: 'h', user: 'u' });
  assert.equal(r.ok, false);
  assert.match(r.error, /auth failed/);
});

test('testImap: nieskonfigurowany IMAP → czytelny błąd', async () => {
  const r = await testImap({ ImapClient: class {} }, { host: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Podaj serwer IMAP/);
});

test('makeSaveSent: zawsze wylogowuje, nawet gdy append rzuci', async () => {
  let loggedOut = false;
  class FakeImap {
    async connect() {}
    async list() { return [{ path: 'Sent', specialUse: '\\Sent' }]; }
    async append() { throw new Error('APPEND failed'); }
    async logout() { loggedOut = true; }
  }
  const buildRaw = async () => Buffer.from('raw');
  const saveSent = makeSaveSent({ ImapClient: FakeImap, buildRaw }, { host: 'h', user: 'u' });
  await assert.rejects(() => saveSent({ to: 'a@x.pl' }, {}), /APPEND failed/);
  assert.equal(loggedOut, true, 'logout musi się wykonać mimo błędu (finally)');
});
