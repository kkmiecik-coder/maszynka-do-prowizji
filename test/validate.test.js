import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePlay, looksLikeAnaliza, validateSource } from '../src/validate.js';

const playSheets = [
  { name: 'dane', headers: ['cokolwiek'] },
  { name: 'dane do plików', headers: ['SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Partnera'] },
];
// Plik Play_dealer z SAMĄ surową zakładką "dane" (nagłówki w wierszu 3 → headersRow3).
// "dane" zaczyna się od "Nazwa Partnera" i zawiera markery "SID POS", "% Circus".
const playRawSheets = [
  { name: 'dane', headers: [], headersRow3: ['Nazwa Partnera', 'Nazwa Prowizji', 'Typ Usługi', 'Data Kontraktu', 'Okres Kontr.', 'Okres Rozl.', 'Poprz. Okres Rozl.', 'Nr Kontraktu', 'Nr Zamówienia (CRM)', 'Nr Zamówienia (WF)', 'Budżet Na Tel.', 'ID Budżetu Na Telefon', 'REGON', 'MSISDN', 'SID Dealer', 'ID Rekordu', 'SID POS', 'SID Sprzed.'].concat(Array(37).fill('x')).concat(['% Circus']) },
  { name: 'Arkusz1', headers: ['a', 'b'] },
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

test('looksLikePlay: akceptuje plik z samą surową zakładką "dane" (nagłówki w wierszu 3)', () => {
  assert.equal(looksLikePlay(playRawSheets), true);
  // Analiza nie ma surowej "dane" → nadal false
  assert.equal(looksLikePlay(analizaSheets), false);
});

test('validateSource(play): akceptuje plik tylko z "dane"', () => {
  assert.deepEqual(validateSource('play', playRawSheets), { ok: true });
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
