# Maszynka do prowizji — projekt (design)

Data: 2026-06-10
Status: zatwierdzony do napisania planu implementacji

## 1. Cel

Aplikacja desktopowa (Windows + macOS) dla osób **nietechnicznych**, która z dwóch
plików źródłowych Excela generuje dziesiątki sformatowanych plików prowizyjnych
(po jednym na Organizację) i opcjonalnie wysyła je mailem. Zasada nadrzędna:
**„klikać, nie szukać i nie myśleć"** — maksymalnie bezobsługowo.

## 2. Stack technologiczny

- **Electron** — jeden kod na Windows + macOS, natywne instalatory (`.exe` / `.dmg`),
  ikona, brak widocznej konsoli, brak instalacji Node/Python u użytkownika.
  - Proces **main** (Node.js): odczyt plików, silnik dopasowania, generowanie XLSX, SMTP.
  - Proces **renderer** (Chromium): interfejs (HTML/CSS/JS), komunikacja przez IPC.
- **ExcelJS** — odczyt źródeł i generowanie plików wyjściowych z pełnym formatowaniem.
- **nodemailer** — wysyłka SMTP.
- **Electron `safeStorage`** (Keychain na macOS / DPAPI na Windows) — szyfrowane hasło SMTP.
- Konfiguracja i mapowanie e-maili — plik JSON w katalogu danych aplikacji (`app.getPath('userData')`).

Decyzja: Electron wybrany zamiast „launcher + przeglądarka" (tarcie: konsola, pytania
przeglądarki o uprawnienia, ograniczony wybór plików) i Tauri (wolniejszy development,
złożony build). Logika (ExcelJS, nodemailer) jest niezależna od wyboru powłoki.

## 3. Pliki źródłowe i wyjściowe

### Źródła (wskazywane przez użytkownika)

1. **`Play_dealer_za_okres_*.xlsx`** (~11 MB, ~20 tys. wierszy)
   - arkusz **`dane do plików`** (46 kolumn) = szczegółowe linie transakcji.
   - Źródło **dolnego bloku** (szczegóły) plików wyjściowych.
2. **`Analiza-strumieni-prowizji-POS-DB-*.xlsx`**
   - arkusz **`dane do plików POS 04`** (13 kolumn) — podsumowania kanału POS.
   - arkusz **`dane do plików DB 04`** (15 kolumn) — podsumowania kanału DB.
   - Źródło **górnego bloku** (podsumowanie) plików wyjściowych.

> Uwaga: nazwy arkuszy zawierają numer miesiąca („04"). Aplikacja wyszukuje arkusze
> po prefiksie (`dane do plików POS`, `dane do plików DB`, `dane do plików`), nie po
> dokładnej nazwie, by działać dla kolejnych okresów.

### Plik wyjściowy

Jeden plik `.xlsx` na **Organizację**. Dwa bloki:

| Blok | Wiersze | Źródło | Zawartość |
|---|---|---|---|
| Podsumowanie | 1 (nagłówki) + 2..N (dane) | `dane do plików POS/DB` | po jednym wierszu na każdy SID Organizacji |
| (przerwa) | — | — | puste wiersze |
| Szczegóły | nagłówki + dane | `dane do plików` (kol. C..AR) | wszystkie linie wszystkich SID-ów Organizacji |

## 4. Logika biznesowa — silnik dopasowania

### Jednostka pliku = Organizacja
Grupowanie po **dokładnym stringu** kolumny `Organizacja` (wielkość liter ma znaczenie).
Jeden plik na Organizację, nawet gdy ma kilka SID-ów (**scalanie**). Mechanizm ogólny —
bez specjalnych wyjątków.

- POS: 16 SID-ów → 13 Organizacji. DB: 29 SID-ów → 27 Organizacji. **Razem ~40 plików.**
- Żadna Organizacja nie występuje jednocześnie w POS i DB → plik jest zawsze jednorodny
  (spójna struktura podsumowania).

### Wybór klucza dopasowania szczegółów — wg kanału (kolumna `KANAŁ`)
- **POS** → klucz = kolumna **`SID POS`** (np. `D000111`).
- **DB**  → klucz = kolumna **`SID Sprzed.`** (np. `D000222399`; sam `SID POS` to `D000222`).

### Dopasowanie szczegółów
Dla każdego SID Organizacji: wybierz z `dane do plików` wszystkie wiersze, gdzie
klucz **dokładnie** (porównanie stringów, **z apostrofem włącznie**) równa się SID ID.
Kopiuj kolumny C..AR (`Nazwa Firmy` … `DO WYPŁATY`).

- Apostrof jest znaczący i **nie jest usuwany**. Klucz `D000444'` dopasowuje wyłącznie wiersze,
  których klucz w szczegółach jest dokładnie `D000444'` (w danych 202604 jest takich 9), a `D000444`
  dopasowuje swoje własne wiersze. Dwa podmioty w tym samym punkcie nie mieszają się dzięki
  dokładnemu dopasowaniu stringów. (Zweryfikowane testem 1:1: gdy dla danego SID nie ma żadnych
  pasujących wierszy, blok szczegółów jest pusty — i to też jest poprawne.)

### Układ scalonego pliku (stos)
- Wiersz 1: nagłówki podsumowania (z szablonu POS/DB).
- Wiersze 2,3,…: po jednym wierszu podsumowania na każdy SID Organizacji.
- Przerwa + nagłówki szczegółów.
- Jeden wspólny blok szczegółów: wszystkie linie wszystkich SID-ów Organizacji, sklejone.

### Okres
Automatycznie z kolumny `Okres Rozl.` (`202604` → `04.2026`). Jeśli w danych występuje
więcej niż jeden okres → ostrzeżenie dla użytkownika.

### Nazwa i lokalizacja pliku
- Nazwa: **`{Organizacja} {MM.YYYY}.xlsx`** (np. `FIRMA ALFA 04.2026.xlsx`).
  Organizacja jest kluczem grupowania, więc nazwa jest unikalna.
- Zapis: `{wybrany_folder}/Prowizje {MM.YYYY}/`.

## 5. Wierność 1:1

- Dwa **szablony** `.xlsx` (POS, DB) wycięte z wzorcowych plików klienta, dołączone do aplikacji.
  Zawierają gotowe nagłówki, kolory (np. fiolet `FF7030A0`, `FFCC99FF`), format walutowy
  „zł", szerokości kolumn, czcionki.
- Generowanie = klon szablonu + wstrzyknięcie danych, z kopiowaniem stylu wiersza wzorcowego.
  Kolory/czcionki/formaty/kolejność/szerokości pochodzą bezpośrednio z pliku klienta → 1:1.
- Plik wynikowy musi mieć **zero błędów formuł** (#REF!, #DIV/0!, itd.).

## 6. Konfiguracja (osobne okno)

### Konto SMTP
host, port, tryb szyfrowania (SSL/TLS/STARTTLS), login, hasło (szyfrowane przez `safeStorage`),
adres nadawcy. Przycisk **„Testuj połączenie"**.

### Szablon maila
- Temat + treść ze zmiennymi: `{Organizacja}`, `{okres}`.
- Osobna **stopka**.

### Wysyłka — antyspam
- **Odstęp między mailami** (sekundy) — konfigurowalny.

### Mapowanie adresatów
Wpis = **`Organizacja` + `SID` + `email`**.
- **Import CSV** (kolumny `Organizacja;SID;email`, auto-wykrycie separatora `;`/`,`).
- **Dodawanie pojedynczo** (trzy pola) + edycja/usuwanie.
- Adresat pliku (per Organizacja) ustalany z wpisów tej Organizacji. Różne maile dla jednej
  Organizacji → oznaczenie „do poprawy".

## 7. Wysyłka

- Po wygenerowaniu — lista ~40 Organizacji ze statusem: ✓ ma email / ✗ brak.
- Przycisk **„Wyślij wszystkie"** aktywny **dopiero gdy każda Organizacja ma poprawny email**
  (wymuszone uzupełnienie braków przed wysyłką hurtem).
- Wysyłka **sekwencyjna z odstępem** (antyspam): pasek postępu, log sukces/błąd per pozycja,
  możliwość ponowienia nieudanych.
- Załącznik = plik tej Organizacji. Treść z szablonu + stopka.

## 8. Przepływ / UX (ekran główny)

1. „Wskaż plik Play_dealer" + „Wskaż plik Analiza" (natywne okna, walidacja arkuszy).
2. „Generuj pliki" → pasek postępu → zapis do podfolderu z okresem.
3. Lista wyników: Organizacja | kanał | liczba SID | DO WYPŁATY | status email.
4. Uzupełnienie brakujących maili → „Wyślij wszystkie".
5. Ikona ⚙ → okno konfiguracji.

Całość po polsku, „klikalna".

## 9. Komponenty (granice odpowiedzialności)

- **`reader`** — odczyt arkuszy źródłowych do struktur w pamięci (strumieniowo dla dużego pliku).
- **`engine`** — grupowanie po Organizacji, dopasowanie szczegółów wg kanału, wykrycie okresu.
  Czysta logika, testowalna bez Electrona i bez I/O.
- **`generator`** — klon szablonu + wstrzyknięcie danych + zapis (ExcelJS).
- **`mailer`** — nodemailer, kolejka sekwencyjna z odstępem, test połączenia.
- **`config`** — odczyt/zapis JSON, szyfrowanie hasła (`safeStorage`), import/parse CSV.
- **`main`** (Electron) — IPC, okna, natywne dialogi plików.
- **`renderer`** — UI (ekran główny + okno konfiguracji).

## 10. Założenia i ryzyka do potwierdzenia w trakcie

- Mapowanie kolumn źródłowych C..AR → kolumny wyjściowe jest stałe (zweryfikowane na wzorcach
  FIRMA ALFA i FIRMA BETA).
- Brak przykładu **scalonego** pliku (wielu SID-ów) — układ „stos" przyjęty na podstawie
  oryginalnego layoutu; do potwierdzenia na pierwszym wygenerowanym scalonym pliku.
- Wielkość liter w `Organizacja` rozróżnia podmioty (POS „MTELL…" vs DB „Mtell…") — celowo.
