import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipient, mergeMapping, loadConfig, saveConfig } from '../src/config.js';

const cfg = { mapping: [
  { organizacja: 'FIRMA ALFA', sid: 'D000111', email: 'ml@x.pl' },
  { organizacja: 'FirmaDelta', sid: 'D000475', email: 'p@x.pl' },
  { organizacja: 'FirmaDelta', sid: 'D000179', email: 'p@x.pl' },
  { organizacja: 'KONFLIKT', sid: 'A', email: 'a@x.pl' },
  { organizacja: 'KONFLIKT', sid: 'B', email: 'b@x.pl' },
]};

test('resolveRecipient: pojedynczy email po SID', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['D000111'] }), { emails: ['ml@x.pl'] });
});

test('resolveRecipient: wiele SID jednej organizacji, ten sam email → dedup', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['D000475', 'D000179'] }), { emails: ['p@x.pl'] });
});

test('resolveRecipient: dopasowuje po SID mimo innej nazwy (polskie znaki)', () => {
  assert.deepEqual(resolveRecipient(cfg, { organizacja: 'FIRMA DELTA', sidy: ['D000475'] }), { emails: ['p@x.pl'] });
});

test('resolveRecipient: różne maile dla SID-ów → wiele adresatów (nie błąd)', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['A', 'B'] }), { emails: ['a@x.pl', 'b@x.pl'] });
});

test('resolveRecipient: brak maila dla SID-ów → pusta lista', () => {
  assert.deepEqual(resolveRecipient(cfg, { sidy: ['NIEMA'] }), { emails: [] });
});

test('resolveRecipient: apostrof w SID jest znaczący', () => {
  const c = { mapping: [{ organizacja: 'X', sid: "D000444'", email: 'x@x.pl' }] };
  assert.deepEqual(resolveRecipient(c, { sidy: ['D000444'] }), { emails: [] });
  assert.deepEqual(resolveRecipient(c, { sidy: ["D000444'"] }), { emails: ['x@x.pl'] });
});

test('mergeMapping: nadpisuje gdy ten sam (organizacja, sid, email)', () => {
  const merged = mergeMapping(
    [{ organizacja: 'A', sid: 'D1', email: 'a@x.pl' }],
    [{ organizacja: 'A', sid: 'D1', email: 'a@x.pl' }, { organizacja: 'B', sid: 'D2', email: 'b@x.pl' }],
  );
  assert.equal(merged.length, 2);
});

test('mergeMapping: ten sam SID z różnymi mailami współistnieje (klucz org|sid|email)', () => {
  const merged = mergeMapping(
    [{ organizacja: 'A', sid: 'D1', email: 'a@x.pl' }],
    [{ organizacja: 'A', sid: 'D1', email: 'b@x.pl' }],
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(m => m.email).sort(), ['a@x.pl', 'b@x.pl']);
});

test('loadConfig/saveConfig: round-trip szyfruje hasło na dysku i odszyfrowuje przy odczycie', async () => {
  let stored = null;
  const deps = {
    encrypt: s => Buffer.from(s).toString('base64'),
    decrypt: b => Buffer.from(b, 'base64').toString('utf8'),
    readFile: async () => {
      if (stored === null) throw new Error('ENOENT');
      return stored;
    },
    writeFile: async (_path, data) => { stored = data; },
  };

  const fullCfg = {
    smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'u@x.pl', from: 'u@x.pl', passwordEnc: null, password: 's3cr3t' },
    mail: { subject: 'Prowizja {okres}', body: 'Treść', footer: 'Stopka', delaySeconds: 3 },
    mapping: [{ organizacja: 'A', sid: 'D1', email: 'a@x.pl' }],
  };

  await saveConfig(deps, '/fake/config.json', fullCfg);

  // Password must NOT appear in plaintext on disk
  assert.ok(!stored.includes('s3cr3t'), 'hasło nie powinno być plaintext na dysku');
  // Encrypted (base64) form must be present
  assert.ok(stored.includes(Buffer.from('s3cr3t').toString('base64')), 'zaszyfrowane hasło powinno być na dysku');

  // Load back and verify password is decrypted
  const loaded = await loadConfig(deps, '/fake/config.json');
  assert.equal(loaded.smtp.password, 's3cr3t', 'hasło powinno być odszyfrowane po odczycie');
  assert.equal(loaded.mail.delaySeconds, 3, 'delaySeconds powinno być zachowane');
  assert.equal(loaded.mapping[0].email, 'a@x.pl', 'mapping powinno być zachowane');
});

test('loadConfig/saveConfig: szyfruje też hasło IMAP i odszyfrowuje przy odczycie', async () => {
  let stored = null;
  const deps = {
    encrypt: s => Buffer.from(s).toString('base64'),
    decrypt: b => Buffer.from(b, 'base64').toString('utf8'),
    readFile: async () => { if (stored === null) throw new Error('ENOENT'); return stored; },
    writeFile: async (_p, data) => { stored = data; },
  };
  const cfg = {
    smtp: { host: 's', port: 587, secure: false, user: 'u@x.pl', from: 'u@x.pl', passwordEnc: null, password: 'smtp-pw' },
    imap: { host: 'imap.x.pl', port: 993, secure: true, user: 'u@x.pl', sentMailbox: 'Sent', passwordEnc: null, password: 'imap-pw' },
    mail: { subject: 's', body: 'b', footer: '', delaySeconds: 5 },
    mapping: [],
  };
  await saveConfig(deps, '/fake/config.json', cfg);
  assert.ok(!stored.includes('imap-pw'), 'hasło IMAP nie powinno być plaintext na dysku');
  assert.ok(stored.includes(Buffer.from('imap-pw').toString('base64')), 'zaszyfrowane hasło IMAP powinno być na dysku');

  const loaded = await loadConfig(deps, '/fake/config.json');
  assert.equal(loaded.imap.password, 'imap-pw', 'hasło IMAP odszyfrowane po odczycie');
  assert.equal(loaded.imap.sentMailbox, 'Sent');
});

test('loadConfig: brak sekcji imap w starym pliku → domyślna pusta sekcja', async () => {
  const deps = {
    encrypt: s => s, decrypt: b => b,
    readFile: async () => JSON.stringify({ smtp: { host: 's' }, mail: {}, mapping: [] }),
    writeFile: async () => {},
  };
  const loaded = await loadConfig(deps, '/fake/config.json');
  assert.ok(loaded.imap, 'sekcja imap powinna istnieć');
  assert.equal(loaded.imap.host, '');
  assert.equal(loaded.imap.password, '');
});

test('saveConfig: wyczyszczenie hasła zeruje passwordEnc na dysku', async () => {
  let stored = null;
  const deps = {
    encrypt: s => Buffer.from(s).toString('base64'),
    decrypt: b => Buffer.from(b, 'base64').toString('utf8'),
    readFile: async () => {
      if (stored === null) throw new Error('ENOENT');
      return stored;
    },
    writeFile: async (_path, data) => { stored = data; },
  };

  // User blanks the password but a stale ciphertext lingers in the object
  const cleared = {
    smtp: { host: 'h', port: 587, secure: false, user: 'u@x.pl', from: 'u@x.pl', passwordEnc: 'c3RhbGU=', password: '' },
    mail: { subject: 's', body: 'b', footer: '', delaySeconds: 5 },
    mapping: [],
  };

  await saveConfig(deps, '/fake/config.json', cleared);

  // No leftover ciphertext on disk
  assert.ok(!stored.includes('c3RhbGU='), 'stary szyfrogram nie powinien zostać na dysku');
  const onDisk = JSON.parse(stored);
  assert.equal(onDisk.smtp.passwordEnc, null, 'passwordEnc powinno być null po wyczyszczeniu hasła');

  // And loading restores an empty password, not the old one
  const loaded = await loadConfig(deps, '/fake/config.json');
  assert.equal(loaded.smtp.password, '', 'hasło powinno pozostać puste po wyczyszczeniu');
});
