import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMappingCsv } from '../src/csv.js';

test('parseMappingCsv: separator średnik + nagłówek', () => {
  const csv = 'Organizacja;SID;email\nFIRMA ALFA;D000111;ml@x.pl\n';
  assert.deepEqual(parseMappingCsv(csv), [
    { organizacja: 'FIRMA ALFA', sid: 'D000111', email: 'ml@x.pl' },
  ]);
});

test('parseMappingCsv: separator przecinek bez nagłówka', () => {
  const csv = 'FIRMA BETA,D000222399,m@x.pl';
  assert.deepEqual(parseMappingCsv(csv), [
    { organizacja: 'FIRMA BETA', sid: 'D000222399', email: 'm@x.pl' },
  ]);
});

test('parseMappingCsv: pomija puste linie i przycina spacje', () => {
  const csv = 'A;D1; a@x.pl \n\n B ;D2;b@x.pl\n';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].email, 'a@x.pl');
  assert.equal(rows[1].email, 'b@x.pl');
});

test('parseMappingCsv: organizacja zawierająca słowo "email" nie jest nagłówkiem', () => {
  const csv = 'Email Solutions Sp.zoo;D002;contact@email-sol.pl';
  assert.equal(parseMappingCsv(csv).length, 1);
});

test('parseMappingCsv: wiele SID w jednej komórce → osobne wiersze', () => {
  const csv = 'Rafał;D001791, D001780;rafal@x.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.sid).sort(), ['D001780', 'D001791']);
  assert.ok(rows.every(r => r.email === 'rafal@x.pl'));
  assert.ok(rows.every(r => r.organizacja === 'Rafał'));
});

test('parseMappingCsv: wiele maili w jednej komórce → osobne wiersze', () => {
  const csv = 'MW Office;D100;magda@x.pl, kamil@x.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.email).sort(), ['kamil@x.pl', 'magda@x.pl']);
  assert.ok(rows.every(r => r.sid === 'D100'));
});

test('parseMappingCsv: iloczyn kartezjański SID × mail', () => {
  const csv = 'Org;D1, D2;a@x.pl, b@x.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 4); // 2 SID × 2 maile
});

test('parseMappingCsv: separator ; gdy przecinki są wewnątrz komórek', () => {
  const csv = 'Mtell sp. j.;D003033385, D003033427, D003033434; pc@mtell.pl';
  const rows = parseMappingCsv(csv);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.email === 'pc@mtell.pl'));
  assert.ok(rows.every(r => r.organizacja === 'Mtell sp. j.'));
});

test('parseMappingCsv: wiersz bez poprawnego maila jest pomijany', () => {
  const csv = 'Org;D1;niepoprawny-bez-malpy';
  assert.equal(parseMappingCsv(csv).length, 0);
});
