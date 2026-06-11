# Maszynka do prowizji

Narzędzie do automatycznego obliczania prowizji i generowania raportów.

## Budowanie aplikacji

Wymagania: Node.js 18+.

Instalacja zależności:

    npm install

Uruchomienie w trybie deweloperskim:

    npm start

Budowanie instalatora:

    npm run dist        # bieżąca platforma
    npm run dist:mac    # macOS (.dmg)
    npm run dist:win    # Windows (.exe / NSIS)

Build dla Windows wykonaj na maszynie Windows (lub w CI), a dla macOS na macOS.
Szablony plików wyjściowych (templates/) i czcionki (renderer/fonts/) są dołączane do paczki automatycznie.

## Auto-aktualizacja

Aplikacja przy każdym uruchomieniu sprawdza najnowsze wydanie w **GitHub Releases**
(`kkmiecik-coder/maszynka-do-prowizji`). Jeśli jest nowsza wersja, pobiera ją w tle
i **instaluje automatycznie przy następnym zamknięciu programu** — użytkownik nic nie klika.
Działa tylko w zainstalowanej aplikacji (nie w `npm start`).

### Jak wydać nową wersję

1. Podnieś numer wersji w `package.json` (pole `version`, np. `0.6.0`).
2. Ustaw token GitHub z prawem zapisu do repo (do publikacji wydania):

       $env:GH_TOKEN = "ghp_twoj_token"   # PowerShell

3. Zbuduj i opublikuj wydanie jednym poleceniem:

       npm run release:win

   electron-builder zbuduje instalator `.exe`, wygeneruje `latest.yml` (metadane dla
   auto-updatera) i wrzuci oba pliki do nowego GitHub Release oznaczonego `v<wersja>`.

4. Gotowe. Uruchomione u użytkowników kopie wykryją wydanie i zaktualizują się same.

**Ważne:** `latest.yml` MUSI trafić do release razem z `.exe` — bez niego auto-updater
nie rozpozna nowej wersji. `npm run release:win` robi to automatycznie.

Wersja instalatora i wersja w `package.json` muszą się zgadzać — auto-updater porównuje
właśnie pole `version`.
