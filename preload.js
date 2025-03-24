const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfAPI', {
  merge: (files) => ipcRenderer.invoke('pdf:merge', files),
  split: (file, ranges) => ipcRenderer.invoke('pdf:split', file, ranges),
  watermark: (file, text) => ipcRenderer.invoke('pdf:watermark', file, text)
});