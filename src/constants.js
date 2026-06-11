export const SHEET = {
  DETAIL: 'dane do plików',          // w pliku Play_dealer
  SUMMARY_POS: 'dane do plików POS',  // prefiks
  SUMMARY_DB: 'dane do plików DB',    // prefiks
};

// kolumny 1-based w arkuszu 'dane do plików'
export const DETAIL_KEY_COL = { POS: 1, DB: 2 }; // SID POS / SID Sprzed.
export const DETAIL_FIRST_COL = 3;   // Nazwa Firmy
export const DETAIL_LAST_COL = 43;   // DO WYPŁATY  (kol. 3..43 = 41 kolumn wyjścia)
// Uwaga: źródło ma dalej kol. 44 "Struktura" i 45 "Firma" — NIE trafiają do wyjścia.
export const PERIOD_COL = 9;         // Okres Rozl.

// kolumny w arkuszach podsumowań (POS i DB wspólne pierwsze 4)
export const SUMMARY = { ORG: 1, SID: 2, NAZWA: 3, KANAL: 4 };
