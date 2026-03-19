const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, path) => callback(path)),
  platform: process.platform,
  isElectron: true,
});
