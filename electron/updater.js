// Auto-aktualizacja przez electron-updater + GitHub Releases.
// Tryb „wymuszony": gdy przy starcie wykryto nowszą wersję, renderer pokazuje
// BLOKUJĄCY modal („Wymagana aktualizacja") z przyciskami Aktualizuj / Anuluj.
//   • Anuluj   → zamyka całą aplikację (brak pracy na starej wersji).
//   • Aktualizuj → pobiera wydanie (modal pokazuje progressbar), a po pobraniu
//     aplikacja sama się zamyka, instaluje i uruchamia ponownie (quitAndInstall).
//
// Działa TYLKO w spakowanej aplikacji (app.isPackaged). W trybie dev jest pomijane,
// bo electron-updater nie ma metadanych wydania i rzucałby błędy.
//
// Błędy sprawdzania (brak sieci itp.) są łykane po cichu — jeśli nie da się
// sprawdzić aktualizacji, apka po prostu działa dalej na obecnej wersji.

import electronUpdater from 'electron-updater';

// Wysyła stan aktualizacji do okna (renderer steruje modalem).
function notify(win, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('update-status', payload);
}

// Inicjalizuje auto-update i zwraca uchwyty sterujące (start/cancel) dla IPC.
export function initAutoUpdate(app, getWindow) {
  // W dev nie ma czego aktualizować — pomijamy, by nie sypać błędami.
  if (!app.isPackaged) {
    return { startDownload() {}, cancelAndQuit() { app.quit(); } };
  }

  // autoUpdater to leniwy getter sięgający do electron.app — pobieramy go DOPIERO
  // tutaj (po app.whenReady), nie na poziomie modułu, by import nie rzucał.
  const { autoUpdater } = electronUpdater;

  // NIE pobieramy automatycznie — czekamy aż użytkownik kliknie „Aktualizuj".
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  // Wykryto nowszą wersję → modal blokujący (wymagana decyzja użytkownika).
  autoUpdater.on('update-available', (info) =>
    notify(getWindow(), { state: 'required', version: info?.version }));
  // Brak nowszej wersji → nic, apka działa normalnie.
  autoUpdater.on('update-not-available', () => notify(getWindow(), { state: 'current' }));
  autoUpdater.on('download-progress', (p) =>
    notify(getWindow(), { state: 'downloading', percent: Math.round(p?.percent || 0) }));
  autoUpdater.on('update-downloaded', () => {
    notify(getWindow(), { state: 'installing' });
    // Zamknij, zainstaluj i uruchom ponownie. isSilent=true (instalacja bez
    // klikania przez użytkownika), isForceRunAfter=true (auto-start po instalacji).
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
  autoUpdater.on('error', (err) =>
    notify(getWindow(), { state: 'error', message: (err && err.message) || String(err) }));

  // Sprawdź zaraz po starcie (z drobnym opóźnieniem, by okno zdążyło się załadować).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => { /* brak sieci/wydań — ignorujemy */ });
  }, 1500);

  return {
    // „Aktualizuj" — rozpocznij pobieranie wybranego wydania.
    startDownload() {
      autoUpdater.downloadUpdate().catch((err) =>
        notify(getWindow(), { state: 'error', message: (err && err.message) || String(err) }));
    },
    // „Anuluj" — zamknij całą aplikację.
    cancelAndQuit() {
      app.quit();
    },
  };
}
