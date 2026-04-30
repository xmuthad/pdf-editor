const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const { mergePDFs, splitPDF, addWatermark, loadPDF, applyEdits, rotatePDF, deletePages, protectPDF, getBookmarks, addBookmarks } = require('./pdf-utils');
const fs = require('fs').promises;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

async function loadSettings() {
  try {
    const data = await fs.readFile(settingsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveSettings(settings) {
  try {
    const dir = path.dirname(settingsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

let pdfjsLibPromise = null;

async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    const pdfjsPath = path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/');
    pdfjsLibPromise = import(path.join(pdfjsPath, 'pdf.mjs')).then(mod => {
      mod.GlobalWorkerOptions.workerSrc = path.join(pdfjsPath, 'pdf.worker.min.mjs');
      return mod;
    });
  }
  return pdfjsLibPromise;
}

let mainWindow;

// Create icon from SVG data
function createIcon() {
  const svgData = `<svg width="128" height="128" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="4" width="48" height="56" rx="6" ry="6" fill="#E8F3FF"/>
    <rect x="10" y="6" width="44" height="52" rx="4" ry="4" fill="#FFFFFF" stroke="#165DFF" stroke-width="1.5"/>
    <path d="M10 6 L20 6 L20 16 Z" fill="#165DFF"/>
    <path d="M28 24 L40 36 L38 40 L26 28 Z" fill="#165DFF"/>
    <path d="M38 40 L42 44 L36 48 L32 44 Z" fill="#36CFC9"/>
    <path d="M48 48 L48 56 M48 52 L52 52 M52 48 L52 56" stroke="#165DFF" stroke-width="2" stroke-linecap="round"/>
    <text x="16" y="36" font-size="6" font-weight="bold" fill="#165DFF">PDF</text>
  </svg>`;
  const base64 = Buffer.from(svgData).toString('base64');
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${base64}`);
}

function createWindow() {
  const icon = createIcon();

  // Set macOS Dock icon
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, 'icon.png');
    const dockIcon = nativeImage.createFromPath(iconPath);
    app.dock.setIcon(dockIcon);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handler with error handling
function safeIpcHandler(handlerName, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`Error in IPC handler ${handlerName}:`, error);
      // Don't leak internal error details to renderer
      throw new Error(`Operation failed: ${handlerName}`);
    }
  };
}

// Validate file path to prevent path traversal attacks
function validateFilePath(filePath) {
  if (typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }
  // Check for path traversal attempts
  if (filePath.includes('..') || filePath.includes('~')) {
    throw new Error('Invalid file path');
  }
  return filePath;
}

// Validate array of file paths
function validateFilePaths(filePaths) {
  if (!Array.isArray(filePaths)) {
    throw new Error('Invalid file paths');
  }
  return filePaths.map(validateFilePath);
}

// Validate page numbers array
function validatePageNumbers(pageNumbers) {
  if (!Array.isArray(pageNumbers)) {
    throw new Error('Invalid page numbers');
  }
  for (const num of pageNumbers) {
    if (typeof num !== 'number' || num < 1 || !Number.isInteger(num)) {
      throw new Error('Invalid page number');
    }
  }
  return pageNumbers;
}

// Original IPC handlers
ipcMain.handle('pdf:merge', safeIpcHandler('pdf:merge', (_, files) => mergePDFs(validateFilePaths(files))));
ipcMain.handle('pdf:split', safeIpcHandler('pdf:split', (_, file, ranges) => splitPDF(validateFilePath(file), ranges)));
ipcMain.handle('pdf:watermark', safeIpcHandler('pdf:watermark', (_, file, text) => addWatermark(validateFilePath(file), text)));

// New editor IPC handlers
ipcMain.handle('pdf:load', safeIpcHandler('pdf:load', (_, filePath) => loadPDF(validateFilePath(filePath))));
ipcMain.handle('pdf:applyEdits', safeIpcHandler('pdf:applyEdits', (_, filePath, operations) => applyEdits(validateFilePath(filePath), operations)));

// File dialog for saving PDF
ipcMain.handle('file:saveDialog', safeIpcHandler('file:saveDialog', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath ? validateFilePath(defaultPath) : undefined,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  return result;
}));

// Write file to disk
ipcMain.handle('file:write', safeIpcHandler('file:write', async (_, filePath, buffer) => {
  await fs.writeFile(validateFilePath(filePath), Buffer.from(buffer));
  return true;
}));

// File picker for images
ipcMain.handle('file:pickImage', safeIpcHandler('file:pickImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  });
  return result;
}));

// File picker for PDF files
ipcMain.handle('file:pickPDF', safeIpcHandler('file:pickPDF', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  return result;
}));

// Read file for PDF.js
ipcMain.handle('pdf:readFile', safeIpcHandler('pdf:readFile', async (_, filePath) => {
  const data = await fs.readFile(validateFilePath(filePath));
  return Array.from(data);
}));

// Rotate PDF pages
ipcMain.handle('pdf:rotate', safeIpcHandler('pdf:rotate', (_, filePath, pageNumbers, degrees) =>
  rotatePDF(validateFilePath(filePath), validatePageNumbers(pageNumbers), degrees)
));

// Delete PDF pages
ipcMain.handle('pdf:deletePages', safeIpcHandler('pdf:deletePages', (_, filePath, pageNumbers) =>
  deletePages(validateFilePath(filePath), validatePageNumbers(pageNumbers))
));

// Convert PDF page to image - returns raw image data for renderer to process
ipcMain.handle('pdf:convertToImage', safeIpcHandler('pdf:convertToImage', async (_, filePath, pageNum, format, scale) => {
  validateFilePath(filePath);
  if (typeof pageNum !== 'number' || pageNum < 1 || !Number.isInteger(pageNum)) {
    throw new Error('Invalid page number');
  }

  const pdfjsLib = await getPdfjsLib();
  const fileData = await fs.readFile(filePath);
  const typedArray = new Uint8Array(fileData);
  const pdf = await pdfjsLib.getDocument(typedArray).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  return {
    width: viewport.width,
    height: viewport.height, pageNum, format, scale
  };
}));

// Protect PDF with password
ipcMain.handle('pdf:protect', safeIpcHandler('pdf:protect', (_, filePath, userPassword, ownerPassword, permissions) =>
  protectPDF(validateFilePath(filePath), userPassword, ownerPassword, permissions)
));

// Get PDF bookmarks
ipcMain.handle('pdf:getBookmarks', safeIpcHandler('pdf:getBookmarks', (_, filePath) => getBookmarks(validateFilePath(filePath))));

// Add PDF bookmarks
ipcMain.handle('pdf:addBookmarks', safeIpcHandler('pdf:addBookmarks', (_, filePath, bookmarks) =>
  addBookmarks(validateFilePath(filePath), bookmarks)
));

// Settings IPC handlers
ipcMain.handle('settings:get', safeIpcHandler('settings:get', async () => {
  return await loadSettings();
}));

ipcMain.handle('settings:set', safeIpcHandler('settings:set', async (_, settings) => {
  return await saveSettings(settings);
}));

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
    createWindow();
  }
});
