import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerIpc } from './ipc.js';
import { initAutoUpdate } from './updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRELOAD = () => join(__dirname, 'preload.cjs');
let win;
let configWin = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 860,
    webPreferences: { preload: PRELOAD(), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

function openConfigWindow() {
  if (configWin && !configWin.isDestroyed()) { configWin.focus(); return; }
  configWin = new BrowserWindow({
    width: 880, height: 720,
    parent: win, modal: true,
    title: 'Konfiguracja · Maszynka do prowizji',
    minimizable: false, maximizable: false,
    webPreferences: { preload: PRELOAD(), contextIsolation: true, nodeIntegration: false },
  });
  configWin.setMenuBarVisibility(false);
  configWin.loadFile(join(__dirname, '..', 'renderer', 'config.html'));
  configWin.on('closed', () => {
    configWin = null;
    // Po zamknięciu konfiguracji odśwież adresatów w głównym oknie.
    if (win && !win.isDestroyed()) win.webContents.send('config-updated');
  });
}

app.whenReady().then(() => {
  registerIpc();
  ipcMain.handle('open-config', () => { openConfigWindow(); });
  // Udostępnij rendererowi numer wersji (do stopki/„o programie").
  ipcMain.handle('app:version', () => app.getVersion());
  createWindow();
  // Auto-aktualizacja (wymuszona): wykrycie nowszej wersji → blokujący modal w UI.
  // Pomijane w trybie dev. Zwraca uchwyty sterowane z renderera przez IPC.
  const updater = initAutoUpdate(app, () => win);
  ipcMain.handle('update:start', () => updater.startDownload());
  ipcMain.handle('update:cancel', () => updater.cancelAndQuit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
