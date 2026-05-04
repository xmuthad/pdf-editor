const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfAPI', {
  merge: (files) => {
    if (!Array.isArray(files)) throw new Error('files must be an array');
    return ipcRenderer.invoke('pdf:merge', files);
  },
  split: (file, ranges) => {
    if (typeof file !== 'string' || !file) throw new Error('file must be a non-empty string');
    if (!Array.isArray(ranges)) throw new Error('ranges must be an array');
    return ipcRenderer.invoke('pdf:split', file, ranges);
  },
  watermark: (file, text, options) => {
    if (typeof file !== 'string' || !file) throw new Error('file must be a non-empty string');
    if (typeof text !== 'string' || !text) throw new Error('text must be a non-empty string');
    if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) throw new Error('options must be a valid object');
    return ipcRenderer.invoke('pdf:watermark', file, text, options);
  },
  loadPDF: (filePath) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    return ipcRenderer.invoke('pdf:load', filePath);
  },
  applyEdits: (filePath, operations) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (!Array.isArray(operations)) throw new Error('operations must be an array');
    return ipcRenderer.invoke('pdf:applyEdits', filePath, operations);
  },
  saveDialog: (defaultPath) => {
    if (defaultPath !== undefined && (typeof defaultPath !== 'string' || !defaultPath)) {
      throw new Error('defaultPath must be a non-empty string if provided');
    }
    return ipcRenderer.invoke('file:saveDialog', defaultPath);
  },
  writeFile: (filePath, buffer) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (!Array.isArray(buffer) && !(buffer instanceof Uint8Array)) throw new Error('buffer must be an array or Uint8Array');
    return ipcRenderer.invoke('file:write', filePath, buffer);
  },
  pickImage: () => ipcRenderer.invoke('file:pickImage'),
  readFile: (filePath) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    return ipcRenderer.invoke('pdf:readFile', filePath);
  },
  pickPDF: () => ipcRenderer.invoke('file:pickPDF'),
  rotate: (filePath, pageNumbers, degrees) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (!Array.isArray(pageNumbers)) throw new Error('pageNumbers must be an array');
    if (typeof degrees !== 'number' || isNaN(degrees) || degrees < -360 || degrees > 360) throw new Error('degrees must be a number between -360 and 360');
    return ipcRenderer.invoke('pdf:rotate', filePath, pageNumbers, degrees);
  },
  deletePages: (filePath, pageNumbers) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (!Array.isArray(pageNumbers)) throw new Error('pageNumbers must be an array');
    return ipcRenderer.invoke('pdf:deletePages', filePath, pageNumbers);
  },
  convertToImage: (filePath, pageNum, format, scale) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (typeof pageNum !== 'number' || pageNum < 1) throw new Error('pageNum must be a positive number');
    if (format !== undefined && (typeof format !== 'string' || !format)) throw new Error('format must be a non-empty string if provided');
    if (scale !== undefined && (typeof scale !== 'number' || scale < 0.1 || scale > 10)) throw new Error('scale must be between 0.1 and 10');
    return ipcRenderer.invoke('pdf:convertToImage', filePath, pageNum, format, scale);
  },
  protect: (filePath, userPassword, ownerPassword, permissions) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (userPassword !== undefined && (typeof userPassword !== 'string' || !userPassword)) throw new Error('userPassword must be a non-empty string if provided');
    if (ownerPassword !== undefined && (typeof ownerPassword !== 'string' || !ownerPassword)) throw new Error('ownerPassword must be a non-empty string if provided');
    if (permissions !== undefined && (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions))) throw new Error('permissions must be a valid object');
    return ipcRenderer.invoke('pdf:protect', filePath, userPassword, ownerPassword, permissions);
  },
  getBookmarks: (filePath) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    return ipcRenderer.invoke('pdf:getBookmarks', filePath);
  },
  addBookmarks: (filePath, bookmarks) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (!Array.isArray(bookmarks)) throw new Error('bookmarks must be an array');
    return ipcRenderer.invoke('pdf:addBookmarks', filePath, bookmarks);
  },
  movePage: (filePath, fromIndex, toIndex) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    if (typeof fromIndex !== 'number' || fromIndex < 0) throw new Error('fromIndex must be a non-negative number');
    if (typeof toIndex !== 'number' || toIndex < 0) throw new Error('toIndex must be a non-negative number');
    return ipcRenderer.invoke('pdf:movePage', filePath, fromIndex, toIndex);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw new Error('settings must be a valid object');
    return ipcRenderer.invoke('settings:set', settings);
  },
  ocrRecognize: (filePath, pageNum, options) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('filePath must be a non-empty string');
    return ipcRenderer.invoke('ocr:recognize', filePath, pageNum, options);
  }
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToArray(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(bytes);
}

contextBridge.exposeInMainWorld('bufferHelper', {
  toBase64: (data) => arrayBufferToBase64(data),
  fromBase64: (base64) => base64ToArray(base64)
});
