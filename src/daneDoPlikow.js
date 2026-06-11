// Transformacja zakładki "dane" (surowe, 64 kol) → "dane do plików" (45 kol),
// czyli odtworzenie kroku, który klient robi dziś ręcznie/zewnętrznie.
// Przepis odtworzony i zweryfikowany 1:1 na realnych plikach (marzec + kwiecień).
//
// Czysta logika (tablice nagłówków + wierszy), testowalna bez Excela.
// Kolumny źródła lokalizowane PO NAZWIE (resolveColIndex) — układ "dane" też
// bywa zmienny między okresami.
import { resolveColIndex, normHeader } from './columns.js';

// Rozwija surową wartość komórki do skalaru. Komórki "dane" bywają formułami
// (ExcelJS: { formula, result } albo { sharedFormula }). Bierzemy `result`;
// formuła bez wyniku (Excel nie zapisał obliczonej wartości) → null.
export function cellValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (Object.prototype.hasOwnProperty.call(v, 'result')) return v.result ?? null;
    if (v.text !== undefined) return v.text;
    return null; // sharedFormula bez result / nieznany obiekt → puste
  }
  return v;
}

// Pomocniczo: czy wartość jest "pusta" (null/undefined/pusty string).
function isBlank(v) {
  const x = cellValue(v);
  return x == null || (typeof x === 'string' && x.trim() === '');
}

// Reguła "Nazwa Firmy":
//  • POS (Firma niepuste) → część przed " - " (np. "WŁASNY - Kraków" → "WŁASNY"),
//    a gdy brak separatora → cała Firma (przycięta).
//  • DB (Firma puste) → nazwa ze słownika SID Sprzed. → Organizacja (z pliku Analiza).
//    Brak w słowniku → pusta (nie zgadujemy).
export function nazwaFirmy({ firma, struktura, sidSprzed }, slownik) {
  const f = cellValue(firma);
  if (!isBlank(f)) {
    const s = String(f);
    const sep = s.indexOf(' - ');
    return (sep >= 0 ? s.slice(0, sep) : s).trim();
  }
  return (slownik && slownik[String(cellValue(sidSprzed) ?? '')]) || '';
}

// Reguła "DO WYPŁATY" (← "% Circus"):
//  • niepuste → kopia
//  • puste + Struktura "Play Own" → puste (null)
//  • puste + inne (DB, Play Fr…) → 0
export function doWyplaty(circus, struktura) {
  const c = cellValue(circus);
  if (!isBlank(c)) return c;
  return normHeader(cellValue(struktura)) === 'play own' ? null : 0;
}

// Plan kolumn wyjścia "dane do plików" — kolejność i reguły.
// type:
//   'copy'    → skopiuj z kolumny źródłowej o nazwie `from`
//   'firma'   → reguła Nazwa Firmy (z Firma + słownik)
//   'wyplata' → reguła DO WYPŁATY (z % Circus + Struktura)
// "Nazwa Partnera" celowo NIE jest w planie bazowym — dokładana dynamicznie
// tylko gdy występuje w źródle (patrz buildDaneDoPlikow).
export const DDP_PLAN = [
  { out: 'SID POS', type: 'copy', from: 'SID POS' },
  { out: 'SID Sprzed.', type: 'copy', from: 'SID Sprzed.' },
  { out: 'Nazwa Firmy', type: 'firma' },
  { out: 'Nazwa Partnera', type: 'copy', from: 'Nazwa Partnera' },
  { out: 'Nazwa Prowizji', type: 'copy', from: 'Nazwa Prowizji' },
  { out: 'Typ Usługi', type: 'copy', from: 'Typ Usługi' },
  { out: 'Data Kontraktu', type: 'copy', from: 'Data Kontraktu' },
  { out: 'Okres Kontr.', type: 'copy', from: 'Okres Kontr.' },
  { out: 'Okres Rozl.', type: 'copy', from: 'Okres Rozl.' },
  { out: 'Poprz. Okres Rozl.', type: 'copy', from: 'Poprz. Okres Rozl.' },
  { out: 'Nr Kontraktu', type: 'copy', from: 'Nr Kontraktu' },
  { out: 'Nr Zamówienia (CRM)', type: 'copy', from: 'Nr Zamówienia (CRM)' },
  { out: 'REGON', type: 'copy', from: 'REGON' },
  { out: 'MSISDN', type: 'copy', from: 'MSISDN' },
  { out: 'SID Dealer', type: 'copy', from: 'SID Dealer' },
  { out: 'ID Rekordu', type: 'copy', from: 'ID Rekordu' },
  { out: 'SID POS', type: 'copy', from: 'SID POS' },
  { out: 'SID Sprzed.', type: 'copy', from: 'SID Sprzed.' },
  { out: 'Typ Partnera', type: 'copy', from: 'Typ Partnera' },
  { out: 'Taryfa', type: 'copy', from: 'Taryfa' },
  { out: 'Czas Trwania', type: 'copy', from: 'Czas Trwania' },
  { out: 'Promocja', type: 'copy', from: 'Promocja' },
  { out: 'Licznik - MEMBER', type: 'copy', from: 'Licznik - MEMBER' },
  { out: 'MSISDN Ownera', type: 'copy', from: 'MSISDN Ownera' },
  { out: 'Typ Aneksu', type: 'copy', from: 'Typ Aneksu' },
  { out: 'Taryfa Rekomendowana', type: 'copy', from: 'Taryfa Rekomendowana' },
  { out: 'Umowa - Kurier', type: 'copy', from: 'Umowa - Kurier' },
  { out: 'Produkt - Kurier', type: 'copy', from: 'Produkt - Kurier' },
  { out: 'Zn. Sprzedaży Ratalnej', type: 'copy', from: 'Zn. Sprzedaży Ratalnej' },
  { out: 'Model Telefonu', type: 'copy', from: 'Model Telefonu' },
  { out: 'Numer IMEI', type: 'copy', from: 'Numer IMEI' },
  { out: 'Status', type: 'copy', from: 'Status' },
  { out: 'Status - Opis Pełny', type: 'copy', from: 'Status - Opis Pełny' },
  { out: 'Weryfik.', type: 'copy', from: 'Weryfik.' },
  { out: 'Weryfik. - Opis', type: 'copy', from: 'Weryfik. - Opis' },
  { out: 'Typ Zdarzenia', type: 'copy', from: 'Typ Zdarzenia' },
  { out: 'Zn. CHURN', type: 'copy', from: 'Zn. CHURN' },
  { out: 'CHURN MSISDN', type: 'copy', from: 'CHURN MSISDN' },
  { out: 'Mnożnik POS', type: 'copy', from: 'Mnożnik POS' },
  { out: 'Mnożnik Rek.', type: 'copy', from: 'Mnożnik Rek.' },
  { out: 'Mnożnik - MEMBER', type: 'copy', from: 'Mnożnik - MEMBER' },
  { out: 'Taryfa Rekomendowana - Mnoznik', type: 'copy', from: 'Taryfa Rekomendowana - Mnoznik' },
  { out: 'Mnożnik Realizacji Planu', type: 'copy', from: 'Mnożnik Realizacji Planu' },
  { out: 'DO WYPŁATY', type: 'wyplata' },
  { out: 'Struktura', type: 'copy', from: 'Struktura' },
  { out: 'Firma', type: 'copy', from: 'Firma' },
];

// Buduje słownik SID Sprzed. → Nazwa Firmy z zakładki "Strumienie per POS"
// pliku Analiza. `rows` to wszystkie wiersze arkusza (z nagłówkami). Nagłówki są
// w 2. wierszu: kol1 = Organizacja (nazwa), kol2 = SID ID. Apostrof na końcu SID
// jest usuwany (w słowniku bywa "D001879'", w danych DB bez apostrofu).
export function buildSlownikDB(rows) {
  const m = {};
  // Znajdź wiersz nagłówków (zawiera "Organizacja" i "SID ID").
  let hdr = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i] || [];
    if (r.some(v => normHeader(v) === 'organizacja') && r.some(v => normHeader(v) === 'sid id')) { hdr = i; break; }
  }
  if (hdr < 0) return m;
  const orgIdx = (rows[hdr] || []).findIndex(v => normHeader(v) === 'organizacja');
  const sidIdx = (rows[hdr] || []).findIndex(v => normHeader(v) === 'sid id');
  if (orgIdx < 0 || sidIdx < 0) return m;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const sid = r[sidIdx], org = r[orgIdx];
    if (sid == null) continue;
    const key = String(cellValue(sid)).replace(/'+$/, '').trim();
    if (key && !(key in m)) m[key] = cellValue(org);
  }
  return m;
}

// Buduje zakładkę "dane do plików" z surowych wierszy "dane".
//  daneHeader  — tablica nagłówków zakładki "dane"
//  daneRows    — tablice wierszy danych (bez nagłówka)
//  slownikDB   — { SID Sprzed. → Nazwa Firmy } z pliku Analiza
// Zwraca { header: string[], rows: any[][] } — 45 kolumn w stałej kolejności.
export function buildDaneDoPlikow(daneHeader, daneRows, slownikDB) {
  // Indeksy kolumn źródła potrzebnych do reguł (po nazwie).
  const iFirma = resolveColIndex(daneHeader, 'Firma', -1);
  const iStruktura = resolveColIndex(daneHeader, 'Struktura', -1);
  const iSidSprzed = resolveColIndex(daneHeader, 'SID Sprzed.', -1);
  const iCircus = resolveColIndex(daneHeader, '% Circus', -1);

  // Plan bazowy = 45 kolumn (bez "Nazwa Partnera"). To stabilny format wyjścia,
  // który program i tak czyta dynamicznie po nazwach (src/columns.js). Zakładka
  // "dane" ZAWSZE ma "Nazwa Partnera", ale do wyjścia jej nie kopiujemy.
  const plan = DDP_PLAN;

  // Pre-mapuj indeksy źródłowe dla kolumn 'copy' (po nazwie, raz).
  const srcIdx = plan.map((col) =>
    col.type === 'copy' ? resolveColIndex(daneHeader, col.from, -1) : -1);

  const header = plan.map((c) => c.out);
  const rows = daneRows.map((src) => {
    const firma = iFirma >= 0 ? src[iFirma] : '';
    const struktura = iStruktura >= 0 ? src[iStruktura] : '';
    const sidSprzed = iSidSprzed >= 0 ? src[iSidSprzed] : '';
    const circus = iCircus >= 0 ? src[iCircus] : null;
    return plan.map((col, i) => {
      if (col.type === 'firma') return nazwaFirmy({ firma, struktura, sidSprzed }, slownikDB);
      if (col.type === 'wyplata') return doWyplaty(circus, struktura);
      // copy — rozwiń formuły do wyniku
      const si = srcIdx[i];
      return si >= 0 ? cellValue(src[si]) : null;
    });
  });
  return { header, rows };
}
