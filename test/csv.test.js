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
