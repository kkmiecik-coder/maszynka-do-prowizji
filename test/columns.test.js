import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveColIndex, buildDetailPlan, normHeader } from '../src/columns.js';

// Realne nagłówki arkusza "dane do plików" (1-based opisowo, tu 0-based tablica).
// MARZEC: bez "Nazwa Partnera" — DO WYPŁATY na kol 43 (idx 42).
const MARZEC = [
  'SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Prowizji', 'Typ Usługi', 'Data Kontraktu',
  'Okres Kontr.', 'Okres Rozl.', 'Poprz. Okres Rozl.', 'Nr Kontraktu', 'Nr Zamówienia (CRM)',
  'REGON', 'MSISDN', 'SID Dealer', 'ID Rekordu', 'SID POS', 'SID Sprzed.', 'Typ Partnera',
  'Taryfa', 'Czas Trwania', 'Promocja', 'Licznik - MEMBER', 'MSISDN Ownera', 'Typ Aneksu',
  'Taryfa Rekomendowana', 'Umowa - Kurier', 'Produkt - Kurier', 'Zn. Sprzedaży Ratalnej',
  'Model Telefonu', 'Numer IMEI', 'Status', 'Status - Opis Pełny', 'Weryfik.', 'Weryfik. - Opis',
  'Typ Zdarzenia', 'Zn. CHURN', 'CHURN MSISDN', 'Mnożnik POS', 'Mnożnik Rek.', 'Mnożnik - MEMBER',
  'Taryfa Rekomendowana - Mnoznik', 'Mnożnik Realizacji Planu', 'DO WYPŁATY', 'Struktura', 'Firma',
];

// KWIECIEŃ: z "Nazwa Partnera" na kol 4 (idx 3) — wszystko przesunięte o 1, DO WYPŁATY na kol 44 (idx 43).
const KWIECIEN = [
  'SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Partnera', 'Nazwa Prowizji', 'Typ Usługi',
  'Data Kontraktu', 'Okres Kontr.', 'Okres Rozl.', 'Poprz. Okres Rozl.', 'Nr Kontraktu',
  'Nr Zamówienia (CRM)', 'REGON', 'MSISDN', 'SID Dealer', 'ID Rekordu', 'SID POS', 'SID Sprzed.',
  'Typ Partnera', 'Taryfa', 'Czas Trwania', 'Promocja', 'Licznik - MEMBER', 'MSISDN Ownera',
  'Typ Aneksu', 'Taryfa Rekomendowana', 'Umowa - Kurier', 'Produkt - Kurier', 'Zn. Sprzedaży Ratalnej',
  'Model Telefonu', 'Numer IMEI', 'Status', 'Status - Opis Pełny', 'Weryfik.', 'Weryfik. - Opis',
  'Typ Zdarzenia', 'Zn. CHURN', 'CHURN MSISDN', 'Mnożnik POS', 'Mnożnik Rek.', 'Mnożnik - MEMBER',
  'Taryfa Rekomendowana - Mnoznik', 'Mnożnik Realizacji Planu', 'DO WYPŁATY', 'Struktura', 'Firma',
];

test('normHeader: trim + lowercase', () => {
  assert.equal(normHeader('  DO WYPŁATY '), 'do wypłaty');
  assert.equal(normHeader(null), '');
});

test('resolveColIndex: szybka ścieżka — pozycja domyślna pasuje', () => {
  // "Nazwa Firmy" jest na idx 2 w marcu — hint trafia od razu.
  assert.equal(resolveColIndex(MARZEC, 'Nazwa Firmy', 2), 2);
});

test('resolveColIndex: fallback po nazwie gdy pozycja się nie zgadza', () => {
  // Hint mówi idx 2, ale w kwietniu na idx 2 jest "Nazwa Firmy" (akurat pasuje),
  // a "Nazwa Prowizji" przesunięta — szukamy po nazwie.
  assert.equal(resolveColIndex(KWIECIEN, 'Nazwa Prowizji', 3), 4); // hint 3 = "Nazwa Partnera", fallback znajdzie 4
});

test('resolveColIndex: brak nazwy → -1', () => {
  assert.equal(resolveColIndex(MARZEC, 'Nie Istnieje', 5), -1);
});

test('buildDetailPlan: MARZEC → 41 kolumn, bez Nazwa Partnera, DO WYPŁATY na idx 42', () => {
  const plan = buildDetailPlan(MARZEC);
  assert.equal(plan.columns.length, 41);
  assert.equal(plan.columns[0].name, 'Nazwa Firmy');
  assert.equal(plan.columns[0].srcIndex, 2);
  const last = plan.columns[plan.columns.length - 1];
  assert.equal(last.name, 'DO WYPŁATY');
  assert.equal(last.srcIndex, 42);
  assert.equal(last.numFmt, '#,##0.00');
  // Data Kontraktu: numFmt daty
  const data = plan.columns.find(c => c.name === 'Data Kontraktu');
  assert.equal(data.srcIndex, 5);
  assert.equal(data.numFmt, 'dd-mm-yyyy');
  // Struktura/Firma NIE w planie
  assert.ok(!plan.columns.some(c => c.name === 'Struktura'));
  assert.ok(!plan.columns.some(c => c.name === 'Firma'));
  // Nazwa Partnera nieobecna w marcu
  assert.ok(!plan.columns.some(c => c.name === 'Nazwa Partnera'));
});

test('buildDetailPlan: KWIECIEŃ → 42 kolumny, z Nazwa Partnera na poz. 2, DO WYPŁATY na idx 43', () => {
  const plan = buildDetailPlan(KWIECIEN);
  assert.equal(plan.columns.length, 42);
  assert.equal(plan.columns[0].name, 'Nazwa Firmy');
  assert.equal(plan.columns[1].name, 'Nazwa Partnera'); // doszła kolumna
  assert.equal(plan.columns[1].srcIndex, 3);
  const last = plan.columns[plan.columns.length - 1];
  assert.equal(last.name, 'DO WYPŁATY');
  assert.equal(last.srcIndex, 43); // przesunięte o 1 względem marca
  assert.equal(last.numFmt, '#,##0.00');
  // Struktura/Firma NIE w planie
  assert.ok(!plan.columns.some(c => c.name === 'Struktura'));
  assert.ok(!plan.columns.some(c => c.name === 'Firma'));
});

test('buildDetailPlan: brak DO WYPŁATY → czytelny błąd PL', () => {
  const bad = ['SID POS', 'SID Sprzed.', 'Nazwa Firmy', 'Nazwa Prowizji'];
  assert.throws(() => buildDetailPlan(bad), /DO WYPŁATY/);
});

test('buildDetailPlan: brak Nazwa Firmy → czytelny błąd PL', () => {
  const bad = ['SID POS', 'SID Sprzed.', 'Coś', 'DO WYPŁATY'];
  assert.throws(() => buildDetailPlan(bad), /Nazwa Firmy/);
});
