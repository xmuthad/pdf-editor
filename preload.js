const { contextBridge, ipcRenderer } = require('electron');
const OCREngine = require('./ocr-engine');
const {
  validateString,
  validateArray,
  validateNumber,
  validateBuffer,
  validateObject
} = require('./validation');

contextBridge.exposeInMainWorld('pdfAPI', {
  merge: (files) => {
    validateArray(files, 'files');
    return ipcRenderer.invoke('pdf:merge', files);
  },
  split: (file, ranges) => {
    validateString(file, 'file');
    validateArray(ranges, 'ranges');
    return ipcRenderer.invoke('pdf:split', file, ranges);
  },
  watermark: (file, text) => {
    validateString(file, 'file');
    validateString(text, 'text');
    return ipcRenderer.invoke('pdf:watermark', file, text);
  },
  loadPDF: (filePath) => {
    validateString(filePath, 'filePath');
    return ipcRenderer.invoke('pdf:load', filePath);
  },
  applyEdits: (filePath, operations) => {
    validateString(filePath, 'filePath');
    validateArray(operations, 'operations');
    return ipcRenderer.invoke('pdf:applyEdits', filePath, operations);
  },
  saveDialog: (defaultPath) => {
    if (defaultPath !== undefined) validateString(defaultPath, 'defaultPath');
    return ipcRenderer.invoke('file:saveDialog', defaultPath);
  },
  writeFile: (filePath, buffer) => {
    validateString(filePath, 'filePath');
    validateBuffer(buffer, 'buffer');
    return ipcRenderer.invoke('file:write', filePath, buffer);
  },
  pickImage: () => ipcRenderer.invoke('file:pickImage'),
  readFile: (filePath) => {
    validateString(filePath, 'filePath');
    return ipcRenderer.invoke('pdf:readFile', filePath);
  },
  pickPDF: () => ipcRenderer.invoke('file:pickPDF'),
  rotate: (filePath, pageNumbers, degrees) => {
    validateString(filePath, 'filePath');
    validateArray(pageNumbers, 'pageNumbers');
    validateNumber(degrees, 'degrees', -360, 360);
    return ipcRenderer.invoke('pdf:rotate', filePath, pageNumbers, degrees);
  },
  deletePages: (filePath, pageNumbers) => {
    validateString(filePath, 'filePath');
    validateArray(pageNumbers, 'pageNumbers');
    return ipcRenderer.invoke('pdf:deletePages', filePath, pageNumbers);
  },
  convertToImage: (filePath, pageNum, format, scale) => {
    validateString(filePath, 'filePath');
    validateNumber(pageNum, 'pageNum', 1);
    if (format !== undefined) validateString(format, 'format');
    if (scale !== undefined) validateNumber(scale, 'scale', 0.1, 10);
    return ipcRenderer.invoke('pdf:convertToImage', filePath, pageNum, format, scale);
  },
  protect: (filePath, userPassword, ownerPassword, permissions) => {
    validateString(filePath, 'filePath');
    if (userPassword !== undefined) validateString(userPassword, 'userPassword');
    if (ownerPassword !== undefined) validateString(ownerPassword, 'ownerPassword');
    if (permissions !== undefined) validateObject(permissions, 'permissions');
    return ipcRenderer.invoke('pdf:protect', filePath, userPassword, ownerPassword, permissions);
  },
  getBookmarks: (filePath) => {
    validateString(filePath, 'filePath');
    return ipcRenderer.invoke('pdf:getBookmarks', filePath);
  },
  addBookmarks: (filePath, bookmarks) => {
    validateString(filePath, 'filePath');
    validateArray(bookmarks, 'bookmarks');
    return ipcRenderer.invoke('pdf:addBookmarks', filePath, bookmarks);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => {
    validateObject(settings, 'settings');
    return ipcRenderer.invoke('settings:set', settings);
  }
});

contextBridge.exposeInMainWorld('OCREngine', OCREngine);

contextBridge.exposeInMainWorld('bufferHelper', {
  from: (data) => Buffer.from(data),
  toBase64: (data) => Buffer.from(data).toString('base64'),
  fromBase64: (base64) => Array.from(Buffer.from(base64, 'base64'))
});

contextBridge.exposeInMainWorld('getPdfjsLib', async () => {
  return window.pdfjsLibInstance || null;
});
