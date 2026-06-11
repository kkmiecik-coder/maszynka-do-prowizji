import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nazwaFirmy, doWyplaty, buildDaneDoPlikow, DDP_PLAN } from '../src/daneDoPlikow.js';

// ---- Reguła "Nazwa Firmy" ----
test('nazwaFirmy: POS — Firma niepuste, obcina przed " - "', () => {
  assert.equal(nazwaFirmy({ firma: 'WŁASNY - Kraków M1', struktura: 'Play Own', sidSprzed: 'X' }, {}), 'WŁASNY');
  assert.equal(nazwaFirmy({ firma: 'FUNKY TEL', struktura: 'Play Fr', sidSprzed: 'X' }, {}), 'FUNKY TEL');
  // wielokrotne spacje wokół separatora
  assert.equal(nazwaFirmy({ firma: 'WŁASNY  - KATOWICE', struktura: 'Play Own', sidSprzed: 'X' }, {}), 'WŁASNY');
});

test('nazwaFirmy: DB — Firma puste, bierze ze słownika po SID Sprzed.', () => {
  const slownik = { D003033399: 'MONIKA CIEMIENIOWSKA' };
  assert.equal(nazwaFirmy({ firma: '', struktura: 'DB', sidSprzed: 'D003033399' }, slownik), 'MONIKA CIEMIENIOWSKA');
  // brak w słowniku → pusta (nie wymyślamy)
  assert.equal(nazwaFirmy({ firma: '', struktura: 'DB FR', sidSprzed: 'NIEMA' }, slownik), '');
});

// ---- Reguła "DO WYPŁATY" ----
test('doWyplaty: % Circus niepuste → kopia', () => {
  assert.equal(doWyplaty(56, 'Play Own'), 56);
  assert.equal(doWyplaty(-160, 'Play Own'), -160);
  assert.equal(doWyplaty(0, 'DB'), 0);
});

test('doWyplaty: % Circus puste → Play Own zostaje puste, reszta → 0', () => {
  assert.equal(doWyplaty(null, 'Play Own'), null);
  assert.equal(doWyplaty('', 'Play Own '), null); // trailing space
  assert.equal(doWyplaty(null, 'DB'), 0);
  assert.equal(doWyplaty(null, 'Play Fr'), 0);
  assert.equal(doWyplaty(null, 'DB FR'), 0);
});

// ---- Plan kolumn ----
test('DDP_PLAN: kolejność kluczowych kolumn (Nazwa Firmy → Nazwa Partnera → …)', () => {
  assert.equal(DDP_PLAN[0].out, 'SID POS');
  assert.equal(DDP_PLAN[1].out, 'SID Sprzed.');
  assert.equal(DDP_PLAN[2].out, 'Nazwa Firmy');
  assert.equal(DDP_PLAN[3].out, 'Nazwa Partnera'); // dokładana — najnowszy format wyjścia
  assert.equal(DDP_PLAN[DDP_PLAN.length - 3].out, 'DO WYPŁATY');
  assert.equal(DDP_PLAN[DDP_PLAN.length - 2].out, 'Struktura');
  assert.equal(DDP_PLAN[DDP_PLAN.length - 1].out, 'Firma');
});

// ---- Pełna transformacja (mini) ----
test('buildDaneDoPlikow: generuje wiersze z mapowaniem kolumn + reguł', () => {
  // Mini nagłówek "dane" (podzbiór istotnych kolumn na realnych pozycjach by przetestować mapowanie po nazwie).
  // Budujemy mały, ale realistyczny nagłówek.
  const daneHeader = [
    'Nazwa Partnera', 'Nazwa Prowizji', 'Typ Usługi', 'Data Kontraktu', 'Okres Kontr.', 'Okres Rozl.',
    'Poprz. Okres Rozl.', 'Nr Kontraktu', 'Nr Zamówienia (CRM)', 'Nr Zamówienia (WF)', 'Budżet Na Tel.',
    'ID Budżetu Na Telefon', 'REGON', 'MSISDN', 'SID Dealer', 'ID Rekordu', 'SID POS', 'SID Sprzed.',
    'Typ Partnera', 'Taryfa', 'Czas Trwania', 'Promocja', 'Licznik - MEMBER', 'MSISDN Ownera', 'Typ Aneksu',
    'Taryfa Rekomendowana', 'Umowa - Kurier', 'Produkt - Kurier', 'Zn. Sprzedaży Ratalnej', 'Model Telefonu',
    'SKU Opis', 'Numer IMEI', 'Pakiet Dodatkowych Usług', 'Status', 'Status - Opis Pełny', 'Weryfik.',
    'Weryfik. - Opis', 'Typ Zdarzenia', 'Zn. CHURN', 'CHURN MSISDN', 'Kat. POS', 'Stawka Podst.', 'Mnożnik SME',
    'Stawka Po SME', 'Stawka Korekty', 'Stawka Podst. Po Korekcie', 'Mnożnik POS', 'Mnożnik Rek.',
    'Mnożnik - MEMBER', 'Taryfa Rekomendowana - Mnoznik', 'Mnożnik Realizacji Planu', 'Stawka Końcowa',
    'Poprz. Wartość', 'Do Wypłaty Końcowe', '% Circus', 'Stawka', 'Struktura', 'Firma', '% Prowizji',
    '% PREMIA DB', 'KWOTA PREMIA DB', 'Nr Raportu', 'Opłata Kurier Po Stronie Klienta', 'TRF Adres',
  ];
  const idx = (name) => daneHeader.indexOf(name);
  const mk = (vals) => { const r = new Array(daneHeader.length).fill(null); for (const [n, v] of Object.entries(vals)) r[idx(n)] = v; return r; };
  // Wiersz POS: Firma "WŁASNY - Kraków", % Circus 56
  const posRow = mk({ 'SID POS': 'D004812', 'SID Sprzed.': 'D004812088', 'Nazwa Prowizji': 'Utrzymanie',
    'Okres Rozl.': '202603', 'Struktura': 'Play Own', 'Firma': 'WŁASNY - Kraków M1', '% Circus': 56, 'Mnożnik POS': 1 });
  // Wiersz DB: Firma puste, SID Sprzed. w słowniku, % Circus puste → 0
  const dbRow = mk({ 'SID POS': 'D003033', 'SID Sprzed.': 'D003033399', 'Nazwa Prowizji': 'Utrzymanie postpaid',
    'Okres Rozl.': '202603', 'Struktura': 'DB', 'Firma': '', '% Circus': null });

  const slownik = { D003033399: 'MONIKA CIEMIENIOWSKA' };
  const { header, rows } = buildDaneDoPlikow(daneHeader, [posRow, dbRow], slownik);

  // Nagłówek wyjścia
  assert.equal(header[0], 'SID POS');
  assert.equal(header[2], 'Nazwa Firmy');
  assert.equal(header[header.length - 3], 'DO WYPŁATY');

  // POS row
  const p = rows[0];
  assert.equal(p[header.indexOf('SID POS')], 'D004812');
  assert.equal(p[header.indexOf('Nazwa Firmy')], 'WŁASNY');
  assert.equal(p[header.indexOf('DO WYPŁATY')], 56);
  assert.equal(p[header.indexOf('Struktura')], 'Play Own');
  assert.equal(p[header.indexOf('Firma')], 'WŁASNY - Kraków M1');

  // DB row
  const d = rows[1];
  assert.equal(d[header.indexOf('Nazwa Firmy')], 'MONIKA CIEMIENIOWSKA');
  assert.equal(d[header.indexOf('DO WYPŁATY')], 0); // % Circus puste + DB → 0
  assert.equal(d[header.indexOf('Struktura')], 'DB');
});
