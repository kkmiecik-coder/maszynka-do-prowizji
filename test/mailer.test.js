import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendBatch, renderTemplate, renderHtml, verifySmtp } from '../src/mailer.js';

test('renderTemplate: podstawia zmienne i dokleja stopkę', () => {
  const out = renderTemplate('Cześć {Organizacja}, okres {okres}', 'STOPKA', { organizacja: 'ML', okres: '04.2026' });
  assert.equal(out, 'Cześć ML, okres 04.2026\n\nSTOPKA');
});

test('renderHtml: escape treści, surowa stopka HTML, podstawienie zmiennych', () => {
  const html = renderHtml('Cześć {Organizacja} & <ekipa>\nokres {okres}', '<p>Pozdrawiamy, {Organizacja}</p>', { organizacja: 'ML', okres: '04.2026' });
  // treść: znaki specjalne zescape'owane, nowa linia -> <br>
  assert.match(html, /Cześć ML &amp; &lt;ekipa&gt;<br>/);
  // stopka: surowy HTML zachowany, zmienna podstawiona
  assert.match(html, /<p>Pozdrawiamy, ML<\/p>/);
});

test('renderHtml: pusta stopka nie dodaje bloku stopki', () => {
  const html = renderHtml('Treść', '', { organizacja: 'ML', okres: '04.2026' });
  assert.match(html, /Treść/);
  assert.ok(!html.includes('margin-top:18px'), 'brak bloku stopki gdy stopka pusta');
});

test('sendBatch: wysyła sekwencyjnie i raportuje', async () => {
  const sent = [];
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { sent.push(m.to); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a.xlsx', period: '04.2026' },
    { organizacja: 'B', emails: ['b@x.pl'], attachmentPath: '/b.xlsx', period: '04.2026' },
  ];
  const progress = [];
  const res = await sendBatch(deps, { host: 'h' }, { subject: 'S {okres}', body: 'B {Organizacja}', footer: '', delaySeconds: 0 }, jobs, p => progress.push(p));
  assert.deepEqual(sent, ['a@x.pl', 'b@x.pl']);
  assert.ok(res.every(r => r.ok));
  assert.equal(progress.length, jobs.length, 'onProgress powinno być wywołane raz na każdy job');
  for (const p of progress) {
    assert.equal(typeof p.last.organizacja, 'string');
    assert.equal(typeof p.last.ok, 'boolean');
  }
});

test('sendBatch: błąd jednego nie blokuje reszty', async () => {
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { if (m.to === 'a@x.pl') throw new Error('boom'); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [{ organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' }, { organizacja: 'B', emails: ['b@x.pl'], attachmentPath: '/b', period: 'p' }];
  const res = await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 0 }, jobs);
  assert.equal(res[0].ok, false);
  assert.equal(typeof res[0].error, 'string');
  assert.ok(res[0].error.length > 0, 'błąd powinien mieć niepusty komunikat');
  assert.equal(res[1].ok, true);
});

test('sendBatch: pomija joby bez maila i raportuje "pominięto"', async () => {
  const sent = [];
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { sent.push(m.to); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' },
    { organizacja: 'B', emails: [], attachmentPath: '/b', period: 'p' },
    { organizacja: 'C', emails: [], attachmentPath: '/c', period: 'p' },
    { organizacja: 'D', emails: ['d@x.pl'], attachmentPath: '/d', period: 'p' },
  ];
  const progress = [];
  const res = await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 0 }, jobs, p => progress.push(p));
  // tylko A i D faktycznie wysłane
  assert.deepEqual(sent, ['a@x.pl', 'd@x.pl']);
  // wynik ma 4 wpisy, B i C oznaczone jako pominięte (nie ok, nie błąd SMTP)
  assert.equal(res.length, 4);
  assert.equal(res[0].ok, true);
  assert.equal(res[1].ok, false);
  assert.equal(res[1].skipped, true);
  assert.equal(res[2].skipped, true);
  assert.equal(res[3].ok, true);
  // onProgress wywołane dla każdego joba (też pominiętych)
  assert.equal(progress.length, jobs.length);
  assert.equal(progress[1].last.skipped, true);
});

test('sendBatch: pominięte joby nie wywołują opóźnienia', async () => {
  const sleepCalls = [];
  const deps = {
    createTransport: () => ({ sendMail: async () => ({}) }),
    sleep: async (ms) => { sleepCalls.push(ms); },
  };
  // A wysłane, B pominięte, C wysłane → tylko jedno realne opóźnienie (między A i C)
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' },
    { organizacja: 'B', emails: [], attachmentPath: '/b', period: 'p' },
    { organizacja: 'C', emails: ['c@x.pl'], attachmentPath: '/c', period: 'p' },
  ];
  await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 2 }, jobs);
  assert.equal(sleepCalls.length, 1, 'opóźnienie tylko między realnie wysłanymi mailami');
});

test('sendBatch: opóźnienie jest respektowane (antyspam)', async () => {
  const sleepCalls = [];
  const deps = {
    createTransport: () => ({ sendMail: async () => ({}) }),
    sleep: async (ms) => { sleepCalls.push(ms); },
  };
  const jobs = [
    { organizacja: 'A', emails: ['a@x.pl'], attachmentPath: '/a', period: 'p' },
    { organizacja: 'B', emails: ['b@x.pl'], attachmentPath: '/b', period: 'p' },
    { organizacja: 'C', emails: ['c@x.pl'], attachmentPath: '/c', period: 'p' },
  ];
  await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 2 }, jobs);
  // sleep should be called jobs.length - 1 times (between sends, not after last)
  assert.equal(sleepCalls.length, jobs.length - 1, 'sleep powinno być wywołane length-1 razy');
  assert.ok(sleepCalls.every(ms => ms === 2000), 'każde opóźnienie powinno wynosić 2000ms');
});

test('sendBatch: wiele maili w jobie → osobna wiadomość do każdego, odstęp między każdą', async () => {
  const sent = [];
  const sleepCalls = [];
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { sent.push(m.to); return {}; } }),
    sleep: async (ms) => { sleepCalls.push(ms); },
  };
  const jobs = [{ organizacja: 'A', emails: ['a1@x.pl', 'a2@x.pl'], attachmentPath: '/a', period: 'p' }];
  const res = await sendBatch(deps, { host: 'h' }, { subject: 's', body: 'b', footer: '', delaySeconds: 2 }, jobs);
  assert.deepEqual(sent, ['a1@x.pl', 'a2@x.pl']);
  assert.equal(sleepCalls.length, 1, 'jeden odstęp między dwoma adresami tego samego pliku');
  assert.equal(res[0].ok, true);
  assert.deepEqual(res[0].sent, ['a1@x.pl', 'a2@x.pl']);
});

test('sendBatch: częściowy błąd jednego adresu → ok=true, errors zawiera nieudany', async () => {
  const deps = {
    createTransport: () => ({ sendMail: async (m) => { if (m.to === 'bad@x.pl') throw new Error('boom'); return {}; } }),
    sleep: async () => {},
  };
  const jobs = [{ organizacja: 'A', emails: ['ok@x.pl', 'bad@x.pl'], attachmentPath: '/a', period: 'p' }];
  const res = await sendBatch(deps, {}, { subject: 's', body: 'b', footer: '', delaySeconds: 0 }, jobs);
  assert.equal(res[0].ok, true, 'co najmniej jeden adres poszedł → ok');
  assert.deepEqual(res[0].sent, ['ok@x.pl']);
  assert.equal(res[0].errors.length, 1);
  assert.equal(res[0].errors[0].email, 'bad@x.pl');
});

test('verifySmtp: zwraca true gdy weryfikacja przejdzie', async () => {
  const deps = { createTransport: () => ({ verify: async () => true }) };
  assert.equal(await verifySmtp(deps, {}), true);
});

test('verifySmtp: odrzuca gdy weryfikacja zawiedzie', async () => {
  const deps = { createTransport: () => ({ verify: async () => { throw new Error('auth failed'); } }) };
  await assert.rejects(() => verifySmtp(deps, {}), /auth failed/);
});
