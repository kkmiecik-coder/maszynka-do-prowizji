// Auto-aktualizacja przez electron-updater + GitHub Releases.
// Tryb „cicho, instaluj przy wyjściu": przy starcie sprawdzamy najnowsze wydanie,
// pobieramy je w tle bez pytania, a nowa wersja instaluje się przy zamknięciu apki.
//
// Działa TYLKO w spakowanej aplikacji (app.isPackaged). W trybie dev jest pomijane,
// bo electron-updater nie ma metadanych wydania i rzucałby błędy.
//
// Wszystkie błędy (brak sieci, brak wydań) są łykane po cichu — aktualizacja jest
// udogodnieniem, nie może blokować uruchomienia narzędzia.

import electronUpdater from 'electron-updater';

// Wysyła stan aktualizacji do okna (renderer pokazuje dyskretny komunikat).
function notify(win, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update-status', payload);
}

export function initAutoUpdate(app, getWindow) {
  // W dev nie ma czego aktualizować — pomijamy, by nie sypać błędami.
  if (!app.isPackaged) return;

  // autoUpdater to leniwy getter sięgający do electron.app — pobieramy go DOPIERO
  // tutaj (po app.whenReady), nie na poziomie modułu, by import nie rzucał.
  const { autoUpdater } = electronUpdater;

  // Pobieraj w tle automatycznie; instaluj dopiero przy zamknięciu apki.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => notify(getWindow(), { state: 'checking' }));
  autoUpdater.on('update-available', (info) => notify(getWindow(), { state: 'available', version: info?.version }));
  autoUpdater.on('update-not-available', () => notify(getWindow(), { state: 'current' }));
  autoUpdater.on('download-progress', (p) =>
    notify(getWindow(), { state: 'downloading', percent: Math.round(p?.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) =>
    // Pobrane — zainstaluje się automatycznie przy następnym zamknięciu apki.
    notify(getWindow(), { state: 'downloaded', version: info?.version }));
  autoUpdater.on('error', (err) =>
    notify(getWindow(), { state: 'error', message: (err && err.message) || String(err) }));

  // Sprawdź zaraz po starcie (z drobnym opóźnieniem, by okno zdążyło się załadować).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => { /* brak sieci/wydań — ignorujemy */ });
  }, 3000);
}
