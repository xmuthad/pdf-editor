const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { mergePDFs, splitPDF, addWatermark, loadPDF, applyEdits, rotatePDF, deletePages, protectPDF } = require('./pdf-utils');
const fs = require('fs').promises;

let pdfjsLibPromise = null;

async function getPdfjsLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
      return mod;
    });
  }
  return pdfjsLibPromise;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

// Export page as image file
ipcMain.handle('file:exportImage', async (_, filePath, pageNum, format, scale, outputPath) => {
  const pdfjsLib = await getPdfjsLib();
  const fileData = await fs.readFile(filePath);
  const typedArray = new Uint8Array(fileData);
  const pdf = await pdfjsLib.getDocument(typedArray).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Create canvas using pdf.js
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');

  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  // Convert to buffer based on format
  let buffer;
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  buffer = canvas.toBuffer(mime);

  if (outputPath) {
    await fs.writeFile(outputPath, buffer);
  }

  return { buffer: Array.from(buffer), width: viewport.width, height: viewport.height };
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
