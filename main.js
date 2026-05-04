const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const { mergePDFs, splitPDF, addWatermark, loadPDF, applyEdits, rotatePDF, deletePages, protectPDF, getBookmarks, addBookmarks, movePage, addPageNumbers, setPDFMetadata, insertPages, insertBlankPage, cropPages, getPageDimensions, compressPDF } = require('./pdf-utils');
const OCREngine = require('./ocr-engine');
const { validateString, validateArray, validateNumber, validateBuffer, validateObject } = require('./validation');
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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
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
  validateString(filePath, 'filePath', 4096);
  const resolved = path.resolve(filePath);
  if (resolved.includes('..') || resolved !== path.normalize(resolved)) {
    throw new Error('Invalid file path');
  }
  if (filePath.includes('~')) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

function validateFilePaths(filePaths) {
  validateArray(filePaths, 'filePaths', 100);
  return filePaths.map(validateFilePath);
}

function validatePageNumbers(pageNumbers) {
  validateArray(pageNumbers, 'pageNumbers', 10000);
  for (const num of pageNumbers) {
    validateNumber(num, 'pageNumber', 1, 100000);
  }
  return pageNumbers;
}

const VALID_IMAGE_FORMATS = ['png', 'jpeg', 'jpg'];

ipcMain.handle('pdf:merge', safeIpcHandler('pdf:merge', (_, files) => mergePDFs(validateFilePaths(files))));
ipcMain.handle('pdf:split', safeIpcHandler('pdf:split', (_, file, ranges) => {
  validateFilePath(file);
  validateArray(ranges, 'ranges', 1000);
  return splitPDF(file, ranges);
}));
ipcMain.handle('pdf:watermark', safeIpcHandler('pdf:watermark', (_, file, text, options) => {
  validateFilePath(file);
  validateString(text, 'watermark text', 500);
  if (options !== undefined) validateObject(options, 'options');
  return addWatermark(file, text, options);
}));

ipcMain.handle('pdf:load', safeIpcHandler('pdf:load', (_, filePath) => loadPDF(validateFilePath(filePath))));
ipcMain.handle('pdf:applyEdits', safeIpcHandler('pdf:applyEdits', (_, filePath, operations) => {
  validateFilePath(filePath);
  validateArray(operations, 'operations', 10000);
  return applyEdits(filePath, operations);
}));

let allowedWritePaths = new Set();

ipcMain.handle('file:saveDialog', safeIpcHandler('file:saveDialog', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath ? validateFilePath(defaultPath) : undefined,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }, { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  if (!result.canceled && result.filePath) {
    allowedWritePaths.add(result.filePath);
    setTimeout(() => allowedWritePaths.delete(result.filePath), 60000);
  }
  return result;
}));

ipcMain.handle('file:write', safeIpcHandler('file:write', async (_, filePath, buffer) => {
  const resolvedPath = validateFilePath(filePath);
  validateBuffer(buffer, 'buffer');
  if (!allowedWritePaths.has(resolvedPath)) {
    throw new Error('Write access denied: path must be selected via save dialog');
  }
  allowedWritePaths.delete(resolvedPath);
  await fs.writeFile(resolvedPath, Buffer.from(buffer));
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
  rotatePDF(validateFilePath(filePath), validatePageNumbers(pageNumbers), validateNumber(degrees, 'degrees', -360, 360))
));

// Delete PDF pages
ipcMain.handle('pdf:deletePages', safeIpcHandler('pdf:deletePages', (_, filePath, pageNumbers) =>
  deletePages(validateFilePath(filePath), validatePageNumbers(pageNumbers))
));

ipcMain.handle('pdf:convertToImage', safeIpcHandler('pdf:convertToImage', async (_, filePath, pageNum, format, scale) => {
  validateFilePath(filePath);
  validateNumber(pageNum, 'pageNum', 1, 100000);
  if (format !== undefined && !VALID_IMAGE_FORMATS.includes(format)) {
    throw new Error('Invalid image format');
  }
  if (scale !== undefined) {
    validateNumber(scale, 'scale', 0.1, 10);
  }

  const pdfjsLib = await getPdfjsLib();
  const fileData = await fs.readFile(filePath);
  const typedArray = new Uint8Array(fileData);
  const pdf = await pdfjsLib.getDocument(typedArray).promise;
  const page = await pdf.getPage(pageNum);
  const actualScale = scale || 2.0;
  const viewport = page.getViewport({ scale: actualScale });

  const { createCanvas } = await import('canvas');
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');

  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  const imageFormat = format || 'png';
  const mimeType = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const buffer = canvas.toBuffer(mimeType);

  return {
    width: viewport.width,
    height: viewport.height,
    pageNum,
    format: imageFormat,
    scale: actualScale,
    data: Array.from(buffer)
  };
}));

// Protect PDF with password
ipcMain.handle('pdf:protect', safeIpcHandler('pdf:protect', (_, filePath, userPassword, ownerPassword, permissions) => {
  validateFilePath(filePath);
  if (userPassword !== undefined) validateString(userPassword, 'userPassword', 128);
  if (ownerPassword !== undefined) validateString(ownerPassword, 'ownerPassword', 128);
  if (permissions !== undefined) validateObject(permissions, 'permissions');
  return protectPDF(filePath, userPassword, ownerPassword, permissions);
}));

// Get PDF bookmarks
ipcMain.handle('pdf:getBookmarks', safeIpcHandler('pdf:getBookmarks', (_, filePath) => getBookmarks(validateFilePath(filePath))));

// Add PDF bookmarks
ipcMain.handle('pdf:addBookmarks', safeIpcHandler('pdf:addBookmarks', (_, filePath, bookmarks) => {
  validateFilePath(filePath);
  validateArray(bookmarks, 'bookmarks', 1000);
  return addBookmarks(filePath, bookmarks);
}));

// Move PDF page
ipcMain.handle('pdf:movePage', safeIpcHandler('pdf:movePage', (_, filePath, fromIndex, toIndex) => {
  validateFilePath(filePath);
  validateNumber(fromIndex, 'fromIndex', 0, 100000);
  validateNumber(toIndex, 'toIndex', 0, 100000);
  return movePage(filePath, fromIndex, toIndex);
}));

// Add page numbers
ipcMain.handle('pdf:addPageNumbers', safeIpcHandler('pdf:addPageNumbers', (_, filePath, options) => {
  validateFilePath(filePath);
  if (options !== undefined) validateObject(options, 'options');
  return addPageNumbers(filePath, options);
}));

// Set PDF metadata
ipcMain.handle('pdf:setMetadata', safeIpcHandler('pdf:setMetadata', (_, filePath, metadata) => {
  validateFilePath(filePath);
  validateObject(metadata, 'metadata');
  return setPDFMetadata(filePath, metadata);
}));

// Insert pages from another PDF
ipcMain.handle('pdf:insertPages', safeIpcHandler('pdf:insertPages', (_, targetPath, sourcePath, insertAfterPage, sourcePages) => {
  validateFilePath(targetPath);
  validateFilePath(sourcePath);
  validateNumber(insertAfterPage, 'insertAfterPage', 0, 100000);
  validateArray(sourcePages, 'sourcePages');
  return insertPages(targetPath, sourcePath, insertAfterPage, sourcePages);
}));

// Insert blank page
ipcMain.handle('pdf:insertBlankPage', safeIpcHandler('pdf:insertBlankPage', (_, filePath, insertAfterPage, width, height) => {
  validateFilePath(filePath);
  validateNumber(insertAfterPage, 'insertAfterPage', 0, 100000);
  return insertBlankPage(filePath, insertAfterPage, width, height);
}));

// Crop pages
ipcMain.handle('pdf:cropPages', safeIpcHandler('pdf:cropPages', (_, filePath, pageCrops) => {
  validateFilePath(filePath);
  validateArray(pageCrops, 'pageCrops');
  return cropPages(filePath, pageCrops);
}));

// Get page dimensions
ipcMain.handle('pdf:getPageDimensions', safeIpcHandler('pdf:getPageDimensions', (_, filePath, pageNum) => {
  validateFilePath(filePath);
  validateNumber(pageNum, 'pageNum', 1, 100000);
  return getPageDimensions(filePath, pageNum);
}));

// Compress PDF
ipcMain.handle('pdf:compress', safeIpcHandler('pdf:compress', async (_, filePath, options) => {
  validateFilePath(filePath);
  if (options !== undefined) validateObject(options, 'options');
  const result = await compressPDF(filePath, options);
  return {
    data: Array.from(result.data),
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    compressionRatio: result.compressionRatio
  };
}));

// Settings IPC handlers
ipcMain.handle('settings:get', safeIpcHandler('settings:get', async () => {
  return await loadSettings();
}));

ipcMain.handle('settings:set', safeIpcHandler('settings:set', async (_, settings) => {
  validateObject(settings, 'settings');
  return await saveSettings(settings);
}));

let ocrEngineInstance = null;

ipcMain.handle('ocr:recognize', safeIpcHandler('ocr:recognize', async (_, filePath, pageNum, options) => {
  validateFilePath(filePath);
  validateNumber(pageNum, 'pageNum', 1, 100000);
  if (options !== undefined) validateObject(options, 'options');
  if (!ocrEngineInstance) {
    ocrEngineInstance = new OCREngine({
      lang: 'eng+chi_sim',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${(m.progress * 100).toFixed(1)}%`);
        }
      }
    });
  }
  await ocrEngineInstance.init();
  const fileData = await fs.readFile(filePath);
  const result = await ocrEngineInstance.recognize(fileData, { page: pageNum, ...options });
  return result;
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
