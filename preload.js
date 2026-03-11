const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfAPI', {
  merge: (files) => ipcRenderer.invoke('pdf:merge', files),
  split: (file, ranges) => ipcRenderer.invoke('pdf:split', file, ranges),
  watermark: (file, text) => ipcRenderer.invoke('pdf:watermark', file, text),
  // New editor APIs
  loadPDF: (filePath) => ipcRenderer.invoke('pdf:load', filePath),
  applyEdits: (filePath, operations) => ipcRenderer.invoke('pdf:applyEdits', filePath, operations),
  saveDialog: (defaultPath) => ipcRenderer.invoke('file:saveDialog', defaultPath),
  writeFile: (filePath, buffer) => ipcRenderer.invoke('file:write', filePath, buffer),
  pickImage: () => ipcRenderer.invoke('file:pickImage'),
  readFile: (filePath) => ipcRenderer.invoke('pdf:readFile', filePath),
  // File picker for PDF files
  pickPDF: () => ipcRenderer.invoke('file:pickPDF'),
  // New features
  rotate: (filePath, pageNumbers, degrees) => ipcRenderer.invoke('pdf:rotate', filePath, pageNumbers, degrees),
  deletePages: (filePath, pageNumbers) => ipcRenderer.invoke('pdf:deletePages', filePath, pageNumbers),
  convertToImage: (filePath, pageNum, format, scale) => ipcRenderer.invoke('pdf:convertToImage', filePath, pageNum, format, scale),
  protect: (filePath, userPassword, ownerPassword, permissions) => ipcRenderer.invoke('pdf:protect', filePath, userPassword, ownerPassword, permissions),
  exportImage: (filePath, pageNum, format, scale, outputPath) => ipcRenderer.invoke('file:exportImage', filePath, pageNum, format, scale, outputPath)
});

// Expose buffer helper for sandboxed renderer
contextBridge.exposeInMainWorld('bufferHelper', {
  from: (data) => {
    if (Array.isArray(data)) {
      return Buffer.from(data);
    }
    return Buffer.from(data);
  },
  toBase64: (data) => {
    return Buffer.from(data).toString('base64');
  },
  fromBase64: (base64) => {
    return Array.from(Buffer.from(base64, 'base64'));
  }
});
