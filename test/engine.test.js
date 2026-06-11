import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFiles } from '../src/engine.js';

// summary: [Organizacja, SID, Nazwa, KANAŁ, ...]
const summary = [
  ['FIRMA DELTA', 'D000475', 'Lesko', 'POS'],
  ['FIRMA DELTA', 'D000179', 'Sanok', 'POS'],
  ['FIRMA ALFA', 'D000111', 'Brzozów', 'POS'],
  ['FIRMA GAMMA', "D000444'", 'Turek', 'POS'], // apostrof -> brak szczegółów
];
// detail: kol1=SID POS, kol2=SID Sprzed., kol3.. = dane
const detail = [
  ['D000475', 'D000475001', 'firmaA'],
  ['D000179', 'D000179001', 'firmaB'],
  ['D000111', 'D000111006', 'firmaC'],
  ['D000444', 'D000444028', 'firmaD'], // pasuje do MARTA, nie do D000444'
];

test('buildFiles: grupuje po Organizacji i scala SID-y', () => {
  const files = buildFiles(summary, detail, 'POS');
  const firmaDelta = files.find(f => f.organizacja === 'FIRMA DELTA');
  assert.deepEqual(firmaDelta.sidy, ['D000475', 'D000179']);
  assert.equal(firmaDelta.summaries.length, 2);
  assert.equal(firmaDelta.details.length, 2); // po jednym z każdego SID
});

test('buildFiles: apostrof daje pusty blok szczegółów', () => {
  const files = buildFiles(summary, detail, 'POS');
  const bartek = files.find(f => f.organizacja === 'FIRMA GAMMA');
  assert.equal(bartek.summaries.length, 1);
  assert.equal(bartek.details.length, 0);
});

test('buildFiles: DB dopasowuje po SID Sprzed. (kol2)', () => {
  const sum = [['FIRMA BETA', 'D000222399', 'x', 'DB']];
  const det = [['D000222', 'D000222399', 'firmaM'], ['D000222', 'D999', 'inny']];
  const files = buildFiles(sum, det, 'DB');
  assert.equal(files[0].details.length, 1);
  assert.equal(files[0].details[0][2], 'firmaM');
});

test('buildFiles: pomija wiersze z pustą Organizacją', () => {
  const files = buildFiles([[null, 'D001', 'x'], ['', 'D002', 'y']], [], 'POS');
  assert.equal(files.length, 0);
});

test('buildFiles: org z dwoma SID, jeden pasuje jeden nie', () => {
  const sum = [['ACME', 'D100', 'x', 'POS'], ['ACME', 'D200', 'y', 'POS']];
  const det = [['D100', 'D100a', 'firma1']]; // D200 nie ma szczegółów
  const files = buildFiles(sum, det, 'POS');
  assert.equal(files.length, 1);
  assert.deepEqual(files[0].sidy, ['D100', 'D200']);
  assert.equal(files[0].details.length, 1);
});
