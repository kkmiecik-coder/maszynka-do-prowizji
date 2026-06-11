export const SHEET = {
  DETAIL: 'dane do plików',          // w pliku Play_dealer
  SUMMARY_POS: 'dane do plików POS',  // prefiks
  SUMMARY_DB: 'dane do plików DB',    // prefiks
};

// kolumny 1-based w arkuszu 'dane do plików'
export const DETAIL_KEY_COL = { POS: 1, DB: 2 }; // SID POS / SID Sprzed.

// Blok szczegółów wyjścia jest mapowany DYNAMICZNIE po nazwach nagłówków źródła,
// bo układ kolumn Play_dealer zmienia się między okresami (np. dochodzi
// "Nazwa Partnera"). Granice bloku = od FIRST do LAST włącznie, w kolejności źródła.
export const DETAIL_OUT_FIRST_NAME = 'Nazwa Firmy';
export const DETAIL_OUT_LAST_NAME = 'DO WYPŁATY';
// Kolumny po DO WYPŁATY ("Struktura", "Firma") NIE trafiają do wyjścia (są dalej).
export const DETAIL_DEFAULT_FIRST_COL = 3; // hint: "Nazwa Firmy" zwykle na kol. 3

// numFmt wymuszany PO NAZWIE kolumny (nie pozycji) — gwarantuje walutę/datę na
// właściwej kolumnie niezależnie od przesunięć układu źródła.
export const DETAIL_COL_NUMFMT = {
  'Data Kontraktu': 'dd-mm-yyyy',
  'DO WYPŁATY': '#,##0.00',
};

export const PERIOD_COL = 9;         // Okres Rozl. (hint pozycyjny — fallback po nazwie)
export const PERIOD_COL_NAME = 'Okres Rozl.'; // mapowane hybrydowo (pozycja zmienna między okresami)

// kolumny w arkuszach podsumowań (POS i DB wspólne pierwsze 4)
export const SUMMARY = { ORG: 1, SID: 2, NAZWA: 3, KANAL: 4 };
