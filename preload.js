// Input validation helper
function validateString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function validateArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function validateNumber(value, name) {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`${name} must be a valid number`);
  }
  return value;
}

const { contextBridge, ipcRenderer } = require('electron');

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
  // New editor APIs
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
    validateArray(buffer, 'buffer');
    return ipcRenderer.invoke('file:write', filePath, buffer);
  },
  pickImage: () => ipcRenderer.invoke('file:pickImage'),
  readFile: (filePath) => {
    validateString(filePath, 'filePath');
    return ipcRenderer.invoke('pdf:readFile', filePath);
  },
  // File picker for PDF files
  pickPDF: () => ipcRenderer.invoke('file:pickPDF'),
  // New features
  rotate: (filePath, pageNumbers, degrees) => {
    validateString(filePath, 'filePath');
    validateArray(pageNumbers, 'pageNumbers');
    validateNumber(degrees, 'degrees');
    return ipcRenderer.invoke('pdf:rotate', filePath, pageNumbers, degrees);
  },
  deletePages: (filePath, pageNumbers) => {
    validateString(filePath, 'filePath');
    validateArray(pageNumbers, 'pageNumbers');
    return ipcRenderer.invoke('pdf:deletePages', filePath, pageNumbers);
  },
  convertToImage: (filePath, pageNum, format, scale) => {
    validateString(filePath, 'filePath');
    validateNumber(pageNum, 'pageNum');
    if (format !== undefined) validateString(format, 'format');
    if (scale !== undefined) validateNumber(scale, 'scale');
    return ipcRenderer.invoke('pdf:convertToImage', filePath, pageNum, format, scale);
  },
  protect: (filePath, userPassword, ownerPassword, permissions) => {
    validateString(filePath, 'filePath');
    if (userPassword !== undefined) validateString(userPassword, 'userPassword');
    if (ownerPassword !== undefined) validateString(ownerPassword, 'ownerPassword');
    return ipcRenderer.invoke('pdf:protect', filePath, userPassword, ownerPassword, permissions);
  },
  exportImage: (filePath, pageNum, format, scale, outputPath) => {
    validateString(filePath, 'filePath');
    validateNumber(pageNum, 'pageNum');
    if (format !== undefined) validateString(format, 'format');
    if (scale !== undefined) validateNumber(scale, 'scale');
    if (outputPath !== undefined) validateString(outputPath, 'outputPath');
    return ipcRenderer.invoke('file:exportImage', filePath, pageNum, format, scale, outputPath);
  },
  // Bookmark APIs
  getBookmarks: (filePath) => {
    validateString(filePath, 'filePath');
    return ipcRenderer.invoke('pdf:getBookmarks', filePath);
  },
  addBookmarks: (filePath, bookmarks) => {
    validateString(filePath, 'filePath');
    validateArray(bookmarks, 'bookmarks');
    return ipcRenderer.invoke('pdf:addBookmarks', filePath, bookmarks);
  }
});

// Expose buffer helper for sandboxed renderer
contextBridge.exposeInMainWorld('bufferHelper', {
  from: (data) => Buffer.from(data),
  toBase64: (data) => Buffer.from(data).toString('base64'),
  fromBase64: (base64) => Array.from(Buffer.from(base64, 'base64'))
});

// Expose PDF.js lib getter for editor
contextBridge.exposeInMainWorld('getPdfjsLib', async () => {
  // Will be set by renderer process after initialization
  return window.pdfjsLibInstance || null;
});
