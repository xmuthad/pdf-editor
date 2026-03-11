const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const fs = require('fs').promises;

async function mergePDFs(filePaths) {
  const mergedPdf = await PDFDocument.create();

  for (const filePath of filePaths) {
    const fileData = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(fileData);
    const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
    pages.forEach(page => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  return Buffer.from(mergedBytes);
}

async function splitPDF(filePath, ranges) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);

  const result = [];
  for (const range of ranges) {
    // Support both single page (e.g., "5") and range (e.g., "1-3")
    const pageIndices = parsePageRange(range.trim());
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(pdfDoc, pageIndices);
    pages.forEach(page => newDoc.addPage(page));
    result.push(await newDoc.save());
  }

  return result.map(b => Buffer.from(b));
}

/**
 * Parse page range string to array of 0-indexed page numbers
 * @param {string} range - Page range (e.g., "1-3", "5", "7-9")
 * @returns {number[]} Array of 0-indexed page numbers
 */
function parsePageRange(range) {
  if (range.includes('-')) {
    // Range format: "1-3"
    const [start, end] = range.split('-').map(Number);
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  } else {
    // Single page: "5"
    return [Number(range) - 1];
  }
}

async function addWatermark(filePath, text) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);

  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont('Helvetica');

  pages.forEach(page => {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - 50,
      y: height / 2,
      size: 24,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.5,
      rotate: degrees(-45)
    });
  });

  return Buffer.from(await pdfDoc.save());
}

/**
 * Load a PDF document and return document info
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<object>} PDF document info
 */
async function loadPDF(filePath) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);
  return {
    pageCount: pdfDoc.getPageCount(),
    filePath
  };
}

/**
 * Apply edit operations to a PDF
 * @param {string} filePath - Path to PDF file
 * @param {Array} operations - Array of edit operations
 * @returns {Promise<Buffer>} Modified PDF buffer
 */
async function applyEdits(filePath, operations) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Group operations by page
  const opsByPage = {};
  operations.forEach(op => {
    if (!opsByPage[op.page]) {
      opsByPage[op.page] = [];
    }
    opsByPage[op.page].push(op);
  });

  // Apply operations for each page
  for (const [pageNum, pageOps] of Object.entries(opsByPage)) {
    const pageIndex = parseInt(pageNum) - 1;
    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    for (const op of pageOps) {
      // Convert canvas coordinates to PDF coordinates
      // Canvas Y is from top, PDF Y is from bottom
      const pdfX = op.x;
      const pdfY = height - op.y;

      switch (op.type) {
        case 'eraser':
          // Draw white rectangle to cover content
          page.drawRectangle({
            x: pdfX,
            y: pdfY - op.height,
            width: op.width,
            height: op.height,
            color: rgb(1, 1, 1)
          });
          break;

        case 'text':
          // Parse hex color to RGB
          const color = hexToRgb(op.color);
          page.drawText(op.text, {
            x: pdfX,
            y: pdfY,
            size: op.fontSize,
            font,
            color: rgb(color.r / 255, color.g / 255, color.b / 255)
          });
          break;

        case 'image':
          // Load and embed image
          let image;
          if (op.imagePath.startsWith('data:image')) {
            // Data URL
            const imageData = op.imagePath.split(',')[1];
            const buffer = Buffer.from(imageData, 'base64');
            if (op.imagePath.includes('image/png')) {
              image = await pdfDoc.embedPng(buffer);
            } else {
              image = await pdfDoc.embedJpg(buffer);
            }
          } else {
            // File path
            const imageBytes = await fs.readFile(op.imagePath);
            if (op.imagePath.endsWith('.png')) {
              image = await pdfDoc.embedPng(imageBytes);
            } else {
              image = await pdfDoc.embedJpg(imageBytes);
            }
          }

          page.drawImage(image, {
            x: pdfX,
            y: pdfY - op.height,
            width: op.width,
            height: op.height
          });
          break;

        case 'highlight':
          // Draw semi-transparent highlight rectangle
          const highlightColor = hexToRgb(op.color);
          page.drawRectangle({
            x: pdfX,
            y: pdfY - op.height,
            width: op.width,
            height: op.height,
            color: rgb(highlightColor.r / 255, highlightColor.g / 255, highlightColor.b / 255),
            opacity: 0.4
          });
          break;

        case 'underline':
          // Draw underline
          const underlineColor = hexToRgb(op.color);
          page.drawLine({
            start: { x: pdfX, y: pdfY },
            end: { x: pdfX + op.width, y: pdfY },
            color: rgb(underlineColor.r / 255, underlineColor.g / 255, underlineColor.b / 255),
            thickness: op.lineWidth || 2
          });
          break;
      }
    }
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Convert hex color to RGB object
 * @param {string} hex - Hex color string (e.g., '#ff0000')
 * @returns {object} RGB object
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Rotate specific pages in a PDF
 * @param {string} filePath - Path to PDF file
 * @param {Array} pageNumbers - Page numbers to rotate (1-indexed)
 * @param {number} degrees - Degrees to rotate (90, 180, 270)
 * @returns {Promise<Buffer>} Modified PDF buffer
 */
async function rotatePDF(filePath, pageNumbers, degrees) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);
  const pages = pdfDoc.getPages();

  pageNumbers.forEach(pageNum => {
    const page = pages[pageNum - 1];
    if (page) {
      const currentRotation = page.getRotation().angle;
      page.setRotation({ type: 'degrees', angle: currentRotation + degrees });
    }
  });

  return Buffer.from(await pdfDoc.save());
}

/**
 * Delete specific pages from a PDF
 * @param {string} filePath - Path to PDF file
 * @param {Array} pageNumbers - Page numbers to delete (1-indexed)
 * @returns {Promise<Buffer>} Modified PDF buffer
 */
async function deletePages(filePath, pageNumbers) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);

  // Sort page numbers in descending order to avoid index shifting
  const sortedPages = [...pageNumbers].sort((a, b) => b - a);

  sortedPages.forEach(pageNum => {
    pdfDoc.removePage(pageNum - 1);
  });

  return Buffer.from(await pdfDoc.save());
}

/**
 * Convert a PDF page to image buffer
 * @param {string} filePath - Path to PDF file
 * @param {number} pageNum - Page number (1-indexed)
 * @param {string} format - Image format ('png' or 'jpeg')
 * @param {number} scale - Scale factor for rendering
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>} Image buffer and dimensions
 */
async function convertPageToImage(filePath, pageNum, format = 'png', scale = 2) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

  const fileData = await fs.readFile(filePath);
  const typedArray = new Uint8Array(fileData);

  const pdf = await pdfjsLib.getDocument(typedArray).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Create an offscreen canvas
  const canvas = {
    width: viewport.width,
    height: viewport.height,
    data: new Uint8ClampedArray(viewport.width * viewport.height * 4)
  };

  const ctx = {
    canvas,
    fillStyle: '',
    imageData: canvas.data,
    fillRect: function(x, y, w, h) {
      // Fill with white background
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
          const idx = ((y + i) * viewport.width + (x + j)) * 4;
          this.imageData[idx] = 255;
          this.imageData[idx + 1] = 255;
          this.imageData[idx + 2] = 255;
          this.imageData[idx + 3] = 255;
        }
      }
    },
    drawImage: function(source, x, y) {
      // Copy image data
      if (source.data) {
        for (let i = 0; i < source.height; i++) {
          for (let j = 0; j < source.width; j++) {
            const srcIdx = (i * source.width + j) * 4;
            const dstIdx = ((y + i) * viewport.width + (x + j)) * 4;
            if (dstIdx + 3 < this.imageData.length) {
              this.imageData[dstIdx] = source.data[srcIdx];
              this.imageData[dstIdx + 1] = source.data[srcIdx + 1];
              this.imageData[dstIdx + 2] = source.data[srcIdx + 2];
              this.imageData[dstIdx + 3] = source.data[srcIdx + 3];
            }
          }
        }
      }
    }
  };

  await page.render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  // Create a simple PNG-like buffer (in reality, we need canvas for proper image encoding)
  // For now, return the raw RGBA data
  return {
    data: canvas.data,
    width: viewport.width,
    height: viewport.height,
    format
  };
}

/**
 * Add password protection to a PDF
 * @param {string} filePath - Path to PDF file
 * @param {string} userPassword - Password to open the PDF
 * @param {string} ownerPassword - Owner password for full access
 * @param {object} permissions - Permission settings
 * @returns {Promise<Buffer>} Encrypted PDF buffer
 */
async function protectPDF(filePath, userPassword, ownerPassword, permissions) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);

  const encryptedPdf = await pdfDoc.save({
    userPassword,
    ownerPassword: ownerPassword || userPassword + '_owner',
    permissions: {
      printing: permissions?.printing || 'highResolution',
      modifying: permissions?.modifying || false,
      copying: permissions?.copying || false,
      annotating: permissions?.annotating || false,
      fillingForms: permissions?.fillingForms || false,
      contentAccessibility: permissions?.contentAccessibility || false,
      documentAssembly: permissions?.documentAssembly || false
    }
  });

  return Buffer.from(encryptedPdf);
}

module.exports = {
  mergePDFs,
  splitPDF,
  addWatermark,
  loadPDF,
  applyEdits,
  rotatePDF,
  deletePages,
  convertPageToImage,
  protectPDF
};
