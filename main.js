const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { mergePDFs, splitPDF, addWatermark } = require('./pdf-utils');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('pdf:merge', async (_, files) => await mergePDFs(files));
ipcMain.handle('pdf:split', async (_, file, ranges) => await splitPDF(file, ranges));
ipcMain.handle('pdf:watermark', async (_, file, text) => await addWatermark(file, text));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});