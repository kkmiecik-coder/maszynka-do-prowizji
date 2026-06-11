// CommonJS preload: w piaskownicy (sandbox: true, domyślnie) preload NIE może być ESM.
// Dlatego require(), nie import — inaczej preload się nie wykonuje i window.api jest undefined.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  validateSource: (args) => ipcRenderer.invoke('validate-source', args),
  resolveEmails: (files) => ipcRenderer.invoke('resolve-emails', files),
  openConfig: () => ipcRenderer.invoke('open-config'),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', () => cb()),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  importCsv: (text, existing) => ipcRenderer.invoke('config:import-csv', { text, existing }),
  testSmtp: (smtp) => ipcRenderer.invoke('smtp:test', smtp),
  testImap: (imap) => ipcRenderer.invoke('imap:test', imap),
  sendTest: (args) => ipcRenderer.invoke('smtp:send-test', args),
  generate: (args) => ipcRenderer.invoke('generate', args),
  sendOne: (args) => ipcRenderer.invoke('send-one', args),
  sendAll: (args) => ipcRenderer.invoke('send-all', args),
  onGenerateProgress: (cb) => ipcRenderer.on('generate-progress', (_e, p) => cb(p)),
  onSendProgress: (cb) => ipcRenderer.on('send-progress', (_e, p) => cb(p)),
  getVersion: () => ipcRenderer.invoke('app:version'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, p) => cb(p)),
});
