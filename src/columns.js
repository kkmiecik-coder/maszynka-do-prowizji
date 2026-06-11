// Mapowanie kolumn szczegółów: źródło "dane do plików" → wyjście.
// Układ kolumn Play_dealer zmienia się między okresami (np. w kwietniu doszła
// kolumna "Nazwa Partnera", przez co DO WYPŁATY przeskoczyło o jedną pozycję).
// Dlatego mapujemy HYBRYDOWO: najpierw sprawdzamy pozycję domyślną (szybka ścieżka),
// a gdy nagłówek się nie zgadza — szukamy kolumny PO NAZWIE.
//
// Czysta logika (operuje na tablicy nagłówków), testowalna bez Excela.
import {
  DETAIL_OUT_FIRST_NAME,
  DETAIL_OUT_LAST_NAME,
  DETAIL_DEFAULT_FIRST_COL,
  DETAIL_COL_NUMFMT,
} from './constants.js';

// Normalizacja nagłówka do porównań (trim + lowercase).
export function normHeader(s) {
  return String(s ?? '').trim().toLowerCase();
}

// Hybrydowe odnalezienie indeksu (0-based) kolumny o nazwie `expectedName`.
// 1) jeśli nagłówek na `defaultIdx` (0-based) pasuje → zwróć defaultIdx (szybka ścieżka);
// 2) w przeciwnym razie znajdź pierwszą kolumnę o tej nazwie (od `from`).
// Zwraca -1 gdy nie znaleziono. `defaultIdx < 0` pomija szybką ścieżkę.
export function resolveColIndex(headerRow, expectedName, defaultIdx, from = 0) {
  const want = normHeader(expectedName);
  if (defaultIdx != null && defaultIdx >= 0 && normHeader(headerRow[defaultIdx]) === want) {
    return defaultIdx;
  }
  for (let i = Math.max(0, from); i < headerRow.length; i++) {
    if (normHeader(headerRow[i]) === want) return i;
  }
  return -1;
}

// Buduje plan kolumn wyjścia z nagłówka źródła: wszystkie kolumny od "Nazwa Firmy"
// do "DO WYPŁATY" WŁĄCZNIE, w kolejności źródła. Każdy element:
//   { srcIndex, name, numFmt }   (numFmt z DETAIL_COL_NUMFMT[name] albo null)
// Granice szukane hybrydowo (po nazwie z hintem pozycyjnym dla pierwszej kolumny).
// Rzuca czytelny błąd PL, gdy brak którejś z granic.
export function buildDetailPlan(headerRow) {
  const firstIndex = resolveColIndex(headerRow, DETAIL_OUT_FIRST_NAME, DETAIL_DEFAULT_FIRST_COL - 1);
  if (firstIndex < 0) {
    throw new Error(`Plik źródłowy nie zawiera kolumny „${DETAIL_OUT_FIRST_NAME}" w danych szczegółowych. Czy na pewno wskazano właściwy plik Play_dealer?`);
  }
  // DO WYPŁATY szukamy po nazwie od firstIndex w górę (pozycja zmienna między okresami).
  const lastIndex = resolveColIndex(headerRow, DETAIL_OUT_LAST_NAME, -1, firstIndex);
  if (lastIndex < 0) {
    throw new Error(`Plik źródłowy nie zawiera kolumny „${DETAIL_OUT_LAST_NAME}" w danych szczegółowych. Czy na pewno wskazano właściwy plik Play_dealer?`);
  }
  if (lastIndex < firstIndex) {
    throw new Error(`Kolumna „${DETAIL_OUT_LAST_NAME}" wystąpiła przed „${DETAIL_OUT_FIRST_NAME}" — nieoczekiwany układ pliku źródłowego.`);
  }
  const columns = [];
  for (let i = firstIndex; i <= lastIndex; i++) {
    const name = String(headerRow[i] ?? '');
    columns.push({ srcIndex: i, name, numFmt: DETAIL_COL_NUMFMT[name] ?? null });
  }
  return { columns, firstIndex, lastIndex };
}
