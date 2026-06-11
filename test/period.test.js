import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod, detectPeriod } from '../src/period.js';

test('formatPeriod: 202604 -> 04.2026', () => {
  assert.equal(formatPeriod('202604'), '04.2026');
  assert.equal(formatPeriod(202604), '04.2026');
});

test('formatPeriod: błędny okres rzuca wyjątek', () => {
  assert.throws(() => formatPeriod('abc'), /Nieprawidłowy okres/);
});

test('formatPeriod: nieprawidłowy miesiąc rzuca wyjątek', () => {
  assert.throws(() => formatPeriod('202613'), /Nieprawidłowy okres/);
});

test('detectPeriod: jeden okres', () => {
  assert.deepEqual(detectPeriod(['202604', '202604']), {
    period: '202604',
    multiple: false,
    breakdown: [{ okres: '202604', liczba: 2 }],
  });
});

test('detectPeriod: wiele okresów zwraca flagę', () => {
  const r = detectPeriod(['202604', '202605']);
  assert.equal(r.multiple, true);
  assert.equal(r.period, '202604');
});

test('detectPeriod: breakdown zlicza wiersze i sortuje malejąco', () => {
  const r = detectPeriod(['202605', '202604', '202604', '202604', '202605']);
  // najczęstszy okres na początku i wybrany jako period
  assert.equal(r.period, '202604');
  assert.deepEqual(r.breakdown, [
    { okres: '202604', liczba: 3 },
    { okres: '202605', liczba: 2 },
  ]);
});

test('detectPeriod: pusta lista rzuca wyjątek', () => {
  assert.throws(() => detectPeriod([]), /Brak prawidłowego okresu/);
});

test('detectPeriod: brak prawidłowych okresów rzuca wyjątek', () => {
  assert.throws(() => detectPeriod(['abc', 'xyz']), /Brak prawidłowego okresu/);
});
