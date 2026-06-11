import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePlay, looksLikeAnaliza, validateSource } from '../src/validate.js';

const playSheets = [
  { name: 'dane', headers: ['cokolwiek'] },
  { name: 'dane do plików', headers: ['SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Partnera'] },
];
const analizaSheets = [
  { name: 'TOTAL', headers: ['x'] },
  { name: 'dane do plików POS 04', headers: ['Organizacja', 'SID ID', 'Nazwa', 'KANAŁ'] },
  { name: 'dane do plików DB 04', headers: ['Organizacja', 'SID ID', 'Nazwa', 'KANAŁ'] },
];

test('looksLikePlay: rozpoznaje arkusz szczegółów po nagłówkach', () => {
  assert.equal(looksLikePlay(playSheets), true);
  assert.equal(looksLikePlay(analizaSheets), false);
});

test('looksLikeAnaliza: rozpoznaje arkusz podsumowania po nagłówkach', () => {
  assert.equal(looksLikeAnaliza(analizaSheets), true);
  assert.equal(looksLikeAnaliza(playSheets), false);
});

test('rozpoznanie jest niezależne od wielkości liter i spacji', () => {
  const s = [{ name: 'x', headers: ['  sid pos ', 'SID SPRZED.', 'nazwa firmy'] }];
  assert.equal(looksLikePlay(s), true);
});

test('validateSource(play): akceptuje Play, odrzuca inny plik neutralnym komunikatem', () => {
  assert.deepEqual(validateSource('play', playSheets), { ok: true });
  const r = validateSource('play', analizaSheets);
  assert.equal(r.ok, false);
  assert.match(r.error, /Play_dealer/);
  assert.doesNotMatch(r.error, /zamienione|wygląda na/);
});

test('validateSource(anal): akceptuje Analizę, odrzuca inny plik neutralnym komunikatem', () => {
  assert.deepEqual(validateSource('anal', analizaSheets), { ok: true });
  const r = validateSource('anal', playSheets);
  assert.equal(r.ok, false);
  assert.match(r.error, /Analiza/);
  assert.doesNotMatch(r.error, /zamienione|wygląda na/);
});

test('validateSource: odrzuca plik bez znanej struktury', () => {
  const junk = [{ name: 'Sheet1', headers: ['a', 'b', 'c'] }];
  assert.equal(validateSource('play', junk).ok, false);
  assert.equal(validateSource('anal', junk).ok, false);
});
