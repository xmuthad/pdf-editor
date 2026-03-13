const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const { mergePDFs, splitPDF, addWatermark, loadPDF, applyEdits, rotatePDF, deletePages, protectPDF, getBookmarks, addBookmarks } = require('./pdf-utils');
const fs = require('fs').promises;

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

// Original IPC handlers
ipcMain.handle('pdf:merge', async (_, files) => await mergePDFs(files));
ipcMain.handle('pdf:split', async (_, file, ranges) => await splitPDF(file, ranges));
ipcMain.handle('pdf:watermark', async (_, file, text) => await addWatermark(file, text));

// New editor IPC handlers
ipcMain.handle('pdf:load', async (_, filePath) => await loadPDF(filePath));
ipcMain.handle('pdf:applyEdits', async (_, filePath, operations) => await applyEdits(filePath, operations));

// File dialog for saving PDF
ipcMain.handle('file:saveDialog', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  return result;
});

// Write file to disk
ipcMain.handle('file:write', async (_, filePath, buffer) => {
  try {
    await fs.writeFile(filePath, Buffer.from(buffer));
    return true;
  } catch (error) {
    console.error('File write error:', error);
    if (error.code === 'EPERM' || error.code === 'EBUSY') {
      throw new Error('无法写入文件。请检查文件是否被其他程序（如 PDF 阅读器）占用，或者您是否有权限写入该位置。');
    }
    throw error;
  }
});

// File picker for images
ipcMain.handle('file:pickImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }]
  });
  return result;
});

// File picker for PDF files
ipcMain.handle('file:pickPDF', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  return result;
});

// Read file for PDF.js
ipcMain.handle('pdf:readFile', async (_, filePath) => {
  const data = await fs.readFile(filePath);
  return Array.from(data);
});

// Rotate PDF pages
ipcMain.handle('pdf:rotate', async (_, filePath, pageNumbers, degrees) => {
  return await rotatePDF(filePath, pageNumbers, degrees);
});

// Delete PDF pages
ipcMain.handle('pdf:deletePages', async (_, filePath, pageNumbers) => {
  return await deletePages(filePath, pageNumbers);
});

// Convert PDF page to image - returns raw image data for renderer to process
ipcMain.handle('pdf:convertToImage', async (_, filePath, pageNum, format, scale) => {
  const pdfjsLib = await getPdfjsLib();
  const fileData = await fs.readFile(filePath);
  const typedArray = new Uint8Array(fileData);
  const pdf = await pdfjsLib.getDocument(typedArray).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  return {
    width: viewport.width,
    height: viewport.height,
    pageNum,
    format,
    scale
  };
});

// Protect PDF with password
ipcMain.handle('pdf:protect', async (_, filePath, userPassword, ownerPassword, permissions) => {
  return await protectPDF(filePath, userPassword, ownerPassword, permissions);
});

// Get PDF bookmarks
ipcMain.handle('pdf:getBookmarks', async (_, filePath) => {
  return await getBookmarks(filePath);
});

// Add PDF bookmarks
ipcMain.handle('pdf:addBookmarks', async (_, filePath, bookmarks) => {
  return await addBookmarks(filePath, bookmarks);
});

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
