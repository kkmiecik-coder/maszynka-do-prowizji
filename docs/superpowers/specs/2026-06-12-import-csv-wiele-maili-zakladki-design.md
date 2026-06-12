# Import CSV, wiele maili na organizację, zakładki konfiguracji

Data: 2026-06-12

## Cel

Trzy powiązane usprawnienia konfiguracji i wysyłki w „Maszynce do prowizji":

1. **Import CSV** — poprawić obsługę polskich znaków (Excel zapisuje CSV w
   Windows-1250, nie UTF-8) oraz obsłużyć komórki z wieloma wartościami
   (kilka SID / kilka maili w jednej komórce, rozdzielone przecinkiem).
2. **Wiele maili na organizację** — do jednej organizacji (jednego pliku
   `.xlsx`) może być przypisanych kilka adresów; wysyłka ma wysłać **osobną
   wiadomość do każdego adresu**.
3. **Zakładki konfiguracji** — podzielić okno konfiguracji na trzy zakładki:
   Konto e-mail · Szablon e-maila · Adresaci (jedno okno, jeden wspólny
   przycisk „Zapisz").

Zasada przewodnia bez zmian: „klikać, nie szukać i nie myśleć". UI po polsku.

## Decyzje (z burzy mózgów)

- **Wiele maili → osobna wiadomość do każdego adresu** (nie jedna zbiorcza).
  Odstęp antyspamowy liczony między każdą realną wysyłką, także w obrębie
  jednego pliku z wieloma mailami.
- **Jeden SID może mieć kilka maili** — komórka e-mail w CSV może zawierać
  kilka adresów po przecinku; parser je rozbija.
- **Kodowanie CSV wykrywane automatycznie** (UTF-8 z BOM / UTF-8 / Windows-1250),
  bez pytania użytkownika.
- **Zakładki w jednym oknie z jednym wspólnym „Zapisz"** — przełączanie
  widoku po stronie renderera, zapis całości jednym przyciskiem.

## Sekcja 1 — Model danych adresatów i wysyłka

### `resolveRecipient(cfg, file)` (src/config.js)

Zmiana sygnatury zwracanej wartości: z `{ email } | { error }` na
`{ emails: string[] }`.

- Zbiera **wszystkie** unikalne maile ze wszystkich wierszy mapowania, których
  `sid` należy do `file.sidy` (dopasowanie po SID dokładnym stringiem, apostrof
  znaczący — bez zmian). Deduplikacja przez `Set`.
- Pusta lista (`emails: []`) = brak adresata; plik pomijany przy wysyłce (jak
  dziś brak maila).
- **Konflikt maili przestaje być błędem.** Różne maile dla SID-ów jednej
  organizacji to teraz po prostu wielu adresatów → `emails` z wieloma pozycjami.
- Pole `emailError` znika z modelu (nie ma już ścieżki błędu).

Kolejność maili: stabilna względem kolejności wierszy mapowania (pierwsze
wystąpienie wygrywa w deduplikacji), żeby wynik był deterministyczny w testach.

### `sendBatch` (src/mailer.js)

Job zmienia kształt: zamiast `job.email` (string) ma `job.emails` (string[]).

- Dla każdego joba iteruje po `job.emails` i wysyła **osobną wiadomość na każdy
  adres** (ten sam załącznik, ten sam temat/treść).
- Odstęp antyspamowy (`mail.delaySeconds`) liczony **między każdą realną
  wysyłką** — również między kolejnymi mailami tego samego pliku. Licznik
  „ostatnia realna wysyłka" jest globalny dla całej partii, nie per-job.
- Job z pustą listą `emails` → wynik `{ organizacja, ok: false, skipped: true }`
  (bez próby SMTP, bez odstępu) — jak dziś.
- Kopia w „Wysłane" (IMAP, `deps.saveSent`) wykonywana po każdej udanej
  wysyłce SMTP, dla każdego adresu osobno; błąd kopii nie psuje wysyłki
  (bez zmian semantyki, tylko w pętli per-adres).
- Wynik per job: `{ organizacja, ok, sent: string[], errors?: [{email,error}],
  skipped? }`.
  - `ok: true` gdy co najmniej jeden adres wysłany pomyślnie.
  - `sent` = lista adresów wysłanych pomyślnie.
  - `errors` = lista nieudanych adresów z komunikatem (jeśli były).
  - `copyError` (jeśli kopia IMAP zawiodła dla któregoś adresu) — zachowany dla
    kompatybilności komunikatów; może być pierwszym napotkanym błędem kopii.
- `onProgress` raportuje po każdym **jobie** (nie po każdym adresie), żeby pasek
  postępu liczył pliki, nie pojedyncze maile — `{ index, total, last }` jak dziś.

### Test mail / send-one / send-all (electron/ipc.js)

- `send-one` i `send-all` budują joby z `emails` zamiast `email`:
  `{ organizacja, emails: f.emails, attachmentPath: f.path, period }`.
- `smtp:send-test` (próbny mail) bez zmian modelu — wysyła pojedynczo na adres
  nadawcy/login (jeden adres), tak jak dziś.

## Sekcja 2 — Import CSV: kodowanie i wiele wartości w komórce

### Wykrywanie kodowania — `src/encoding.js` (nowy moduł)

`decodeCsvBytes(bytes)` → string:

1. **UTF-8 BOM** (`EF BB BF` na początku) → dekoduj UTF-8, obetnij BOM.
2. W przeciwnym razie spróbuj `new TextDecoder('utf-8', { fatal: true })`.
   Sukces → tekst jest poprawnym UTF-8.
3. Wyjątek (niepoprawne bajty UTF-8) → `new TextDecoder('windows-1250')`
   (Excel „CSV" na polskim Windowsie).

Czysta funkcja, testowalna — wejście `Uint8Array`/`Buffer`, wyjście string.
`TextDecoder` jest dostępny w Node 18+ globalnie.

### Renderer — przekazanie bajtów

`renderer/config.ui.js`: zamiast `file.text()` użyć `file.arrayBuffer()` i
przekazać bajty do backendu. Sygnatura IPC `importCsv` przyjmuje bajty zamiast
stringa. Preload i handler `config:import-csv` przyjmują `Uint8Array`/`ArrayBuffer`,
wołają `decodeCsvBytes` przed `parseMappingCsv`.

### `parseMappingCsv(text)` — rozbijanie komórek (src/csv.js)

Wejście: zdekodowany już string (kodowanie rozwiązane wcześniej).

- **Separator kolumn**: jeśli linia zawiera `;` → separatorem jest `;`
  (przecinek wtedy traktowany wyłącznie jako wewnątrzkomórkowy). W przeciwnym
  razie separatorem jest `,`. (Zgodne z plikiem klienta, który używa `;`.)
- **Wykrywanie nagłówka**: jak dziś — pierwszy wiersz jest nagłówkiem, jeśli
  3. kolumna nie wygląda na e-mail.
- **Rozbijanie komórki SID**: dzielimy po `,` / `;` / białych znakach → lista
  SID-ów (przycięte, niepuste).
- **Rozbijanie komórki e-mail**: dzielimy po `,` / `;` / białych znakach →
  lista maili; odfiltrowujemy te bez `\S+@\S+`.
- **Iloczyn kartezjański**: dla każdego SID × każdy mail tworzymy osobny wiersz
  `{ organizacja, sid, email }`. Model mapowania pozostaje **płaski** (jeden
  wiersz = jeden SID + jeden mail) — `resolveRecipient`, `mergeMapping` i tabela
  adresatów nie zmieniają struktury.
- Wiersze bez żadnego poprawnego maila są pomijane (jak dziś).

### `mergeMapping` (src/config.js)

Bez zmian strukturalnych. Klucz dedup `organizacja||sid` może powodować, że
import dwóch maili dla tego samego SID nadpisze się — dlatego klucz dedup
rozszerzamy do `organizacja||sid||email`, by współistniejące maile tego samego
SID nie wypierały się nawzajem.

## Sekcja 3 — UI: zakładki + tabela adresatów

### Zakładki (renderer/config.html + config.ui.js)

- Pasek zakładek nad sekcjami: **Konto e-mail** · **Szablon e-maila** ·
  **Adresaci**. Trzy istniejące `<section class="card">` zostają, owinięte tak,
  by każda była panelem jednej zakładki.
- Przełączanie czysto w rendererze: klasa `active` na przycisku zakładki i
  odpowiadającym panelu; pozostałe panele ukryte (`hidden`/`display:none`).
- **Jeden wspólny „Zapisz"** w stopce okna — `collect()` zbiera całość ze
  wszystkich paneli (ukryte pola pozostają w DOM), bez zmian IPC.
- Domyślnie aktywna zakładka „Konto e-mail".
- Style zakładek dodane do `renderer/styles.css` (spójne z istniejącym
  designem; bez frameworka).

### Tabela adresatów

- Wiersze mapowania pozostają płaskie — wiele SID/maili z CSV wpada jako osobne
  wiersze (czytelne i edytowalne pojedynczo). Renderowanie tabeli bez zmian.
- Pomoc „Jak wygląda plik CSV?" zaktualizowana: dopisać, że w komórce SID oraz
  e-mail można podać kilka wartości po przecinku, oraz że polskie znaki działają
  niezależnie od sposobu zapisu z Excela (zwykły „CSV" i „CSV UTF-8").

### Renderer główny — `email` → `emails` (renderer/main.ui.js)

Przejście modelu pliku z `email: string|null` na `emails: string[]`:

- `state.result.files.some(f => f.email)` → `f.emails.length` (gotowość kroku 3).
- Licznik pominiętych / „brak maila" → `f.emails.length === 0`.
- Kolumna e-mail w tabeli kroku 2: pokazuje adresy złączone `, ` lub „— brak —".
- Dialog potwierdzenia przed wysyłką: lista organizacji bez adresu =
  `f.emails.length === 0`.
- Payload `send-all` / `send-one`: `emails: f.emails` zamiast `email: f.email`.
- `applyEmails` po przeliczeniu adresatów (`resolve-emails`): `f.emails = r.emails`
  (usuń `f.emailError`).

### `electron/ipc.js` — handlery

- `resolve-emails`: zwraca `{ organizacja, sidy, emails: rec.emails }`
  (usuń `email`/`emailError`).
- `generate`: dla każdego pliku `emails: rec.emails` zamiast
  `email`/`emailError`.

## Niezmienniki (nie „naprawiać")

- Dopasowanie adresata **po samym SID**, dokładny string, apostrof znaczący.
- Nazwa organizacji służy tylko do etykiet/komunikatów, nie do dopasowania.
- Jeden plik `.xlsx` per organizacja (układ „stos") — bez zmian.
- 1:1 wierność wizualna generatora — poza zakresem tej zmiany.

## Testy

- `test/encoding.test.js` (nowy): UTF-8 BOM, czysty UTF-8 z polskimi znakami,
  Windows-1250 z polskimi znakami (`ł`, `ż`, `ń`, `ś`) → poprawny string.
- `test/csv.test.js`: rozbijanie wielu SID w komórce; rozbijanie wielu maili;
  iloczyn kartezjański; separator `;` z przecinkami wewnątrz komórki; istniejące
  testy (separator, nagłówek, puste linie) dostosowane do nowego modelu.
- `test/config.test.js`: `resolveRecipient` zwraca `{ emails }` — pojedynczy
  mail, wiele maili (dawny „konflikt"), brak maila (pusta lista), apostrof.
- `test/mailer.test.js`: `sendBatch` z `emails` — wiele adresów = wiele wysyłek;
  odstęp między każdym adresem; job z pustą listą pominięty; raport `sent`.

## Plan wdrożenia

Kolejność (czysta logika → IPC → UI):

1. `src/encoding.js` + testy.
2. `src/csv.js` (rozbijanie komórek) + testy.
3. `src/config.js` (`resolveRecipient` → `emails`, `mergeMapping` klucz) + testy.
4. `src/mailer.js` (`sendBatch` per-adres) + testy.
5. `electron/ipc.js` + `electron/preload.cjs` (bajty CSV, `emails` w handlerach).
6. `renderer/config.html` + `config.ui.js` (zakładki, bajty CSV, pomoc).
7. `renderer/main.ui.js` (`email` → `emails`).
8. `renderer/styles.css` (style zakładek).
9. `npm test` — zielono; aktualizacja `CLAUDE.md`.
