// Input validation helpers
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

// Shared helper: Load PDF document with error handling
// Avoids duplicating the same file read + load pattern in every function
async function loadPdfDocument(filePath) {
  validateString(filePath, 'filePath');
  try {
    const fileData = await fs.readFile(filePath);
    return await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }
}

const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const { PDFName, PDFDict, PDFNumber, PDFString, PDFArray, PDFRef } = require('pdf-lib');
const fs = require('fs').promises;

async function mergePDFs(filePaths) {
  validateArray(filePaths, 'filePaths');

  // Read and load all PDFs in parallel for efficiency
  const pdfDocs = await Promise.all(
    filePaths.map(async (filePath) => {
      validateString(filePath, 'filePath');
      try {
        const fileData = await fs.readFile(filePath);
        return await PDFDocument.load(fileData);
      } catch (error) {
        throw new Error(`无法读取 PDF 文件 ${filePath}: ${error.message}`);
      }
    })
  );

  const mergedPdf = await PDFDocument.create();

  for (const pdfDoc of pdfDocs) {
    const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
    pages.forEach(page => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  return Buffer.from(mergedBytes);
}

async function splitPDF(filePath, ranges) {
  validateString(filePath, 'filePath');
  validateArray(ranges, 'ranges');

  const pdfDoc = await loadPdfDocument(filePath);

  const totalPages = pdfDoc.getPageCount();

  const result = [];
  for (const range of ranges) {
    // Support both single page (e.g., "5") and range (e.g., "1-3")
    const pageIndices = parsePageRange(range.trim(), totalPages);
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(pdfDoc, pageIndices);
    pages.forEach(page => newDoc.addPage(page));
    result.push(await newDoc.save());
  }

  return result.map(b => Buffer.from(b));
}

async function addWatermark(filePath, text) {
  validateString(filePath, 'filePath');
  validateString(text, 'text');

  const pdfDoc = await loadPdfDocument(filePath);

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
  const pdfDoc = await loadPdfDocument(filePath);

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
  validateString(filePath, 'filePath');
  validateArray(operations, 'operations');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }

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
 * @param {string} hex - Hex color string (e.g., '#ff0000' or '#f00')
 * @returns {object} RGB object with r, g, b values (0-255)
 */
function hexToRgb(hex) {
  // Support both #ff0000 and #f00 formats
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Parse page range string to array of 0-indexed page numbers
 * @param {string} range - Page range (e.g., "1-3", "5", "7-9")
 * @param {number} totalPages - Total pages in PDF for validation
 * @returns {number[]} Array of 0-indexed page numbers
 * @throws {Error} If range is invalid or out of bounds
 */
function parsePageRange(range, totalPages) {
  const trimmed = range.trim();

  if (trimmed.includes('-')) {
    // Range format: "1-3"
    const [start, end] = trimmed.split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
      throw new Error(`无效的页面范围：${range}`);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  } else {
    // Single page: "5"
    const pageNum = Number(trimmed);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      throw new Error(`无效的页码：${range}`);
    }
    return [pageNum - 1];
  }
}

/**
 * Rotate specific pages in a PDF
 * @param {string} filePath - Path to PDF file
 * @param {Array} pageNumbers - Page numbers to rotate (1-indexed)
 * @param {number} degrees - Degrees to rotate (90, 180, 270)
 * @returns {Promise<Buffer>} Modified PDF buffer
 */
async function rotatePDF(filePath, pageNumbers, degrees) {
  validateString(filePath, 'filePath');
  validateArray(pageNumbers, 'pageNumbers');
  validateNumber(degrees, 'degrees');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }

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
  validateString(filePath, 'filePath');
  validateArray(pageNumbers, 'pageNumbers');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }

  // Sort page numbers in descending order to avoid index shifting
  const sortedPages = [...pageNumbers].sort((a, b) => b - a);

  sortedPages.forEach(pageNum => {
    pdfDoc.removePage(pageNum - 1);
  });

  return Buffer.from(await pdfDoc.save());
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
  validateString(filePath, 'filePath');
  if (userPassword !== undefined) validateString(userPassword, 'userPassword');
  if (ownerPassword !== undefined) validateString(ownerPassword, 'ownerPassword');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }

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

/**
 * Get bookmarks from a PDF
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<Array>} Array of bookmark objects
 */
async function getBookmarks(filePath) {
  validateString(filePath, 'filePath');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }

  const catalog = pdfDoc.catalog;

  // Get the Outlines dictionary
  const outlinesRef = catalog.get(PDFName.of('Outlines'));
  if (!outlinesRef) {
    return [];
  }

  // Look up the actual Outlines object using the PDF context
  const outlines = pdfDoc.context.lookup(outlinesRef);
  if (!outlines || typeof outlines.get !== 'function') {
    return [];
  }

  // Get the First bookmark
  const firstRef = outlines.get(PDFName.of('First'));
  if (!firstRef) {
    return [];
  }

  // Parse bookmarks
  const bookmarks = [];

  function parseBookmark(bookmarkRef, level = 0) {
    const bookmark = pdfDoc.context.lookup(bookmarkRef);
    if (!bookmark || typeof bookmark.get !== 'function') return null;

    const title = bookmark.get(PDFName.of('Title'));
    const dest = bookmark.get(PDFName.of('Dest'));
    const action = bookmark.get(PDFName.of('Action'));

    let pageNum = null;
    let pageIndex = null;

    // Try to get destination page
    if (dest) {
      if (Array.isArray(dest)) {
        const pageRef = dest[0];
        if (pageRef && typeof pageRef === 'object' && 'gen' in pageRef) {
          try {
            const pageIndex_ = pdfDoc.getPageIndex(pageRef);
            if (pageIndex_ >= 0) {
              pageIndex = pageIndex_;
              pageNum = pageIndex + 1;
            }
          } catch (e) {
            // ignore
          }
        }
      }
    } else if (action) {
      // Handle GoTo actions
      try {
        const actionType = action.get(PDFName.of('S'));
        if (actionType && actionType.toString() === 'GoTo') {
          const actionDest = action.get(PDFName.of('D'));
          if (actionDest && Array.isArray(actionDest)) {
            const pageRef = actionDest[0];
            if (pageRef && typeof pageRef === 'object' && 'gen' in pageRef) {
              try {
                const pageIndex_ = pdfDoc.getPageIndex(pageRef);
                if (pageIndex_ >= 0) {
                  pageIndex = pageIndex_;
                  pageNum = pageIndex + 1;
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    const titleStr = title ? title.value : 'Untitled';

    const result = {
      title: titleStr,
      page: pageNum,
      pageIndex: pageIndex,
      level,
      ref: bookmarkRef.toString()
    };

    return result;
  }

  // Parse first level bookmarks
  let currentRef = firstRef;
  while (currentRef) {
    const bookmark = parseBookmark(currentRef, 0);
    if (bookmark) {
      bookmarks.push(bookmark);
    }

    // Get Next reference
    try {
      const current = pdfDoc.context.lookup(currentRef);
      const nextRef = current && typeof current.get === 'function' ? current.get(PDFName.of('Next')) : null;
      currentRef = nextRef;
    } catch (e) {
      break;
    }
  }

  return bookmarks;
}

/**
 * Add bookmarks to a PDF
 * @param {string} filePath - Path to PDF file
 * @param {Array} bookmarks - Array of bookmark objects {title, page}
 * @returns {Promise<Buffer>} Modified PDF buffer
 */
async function addBookmarks(filePath, bookmarks) {
  validateString(filePath, 'filePath');
  validateArray(bookmarks, 'bookmarks');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`无法读取 PDF 文件：${error.message}`);
  }

  const pages = pdfDoc.getPages();

  if (!bookmarks || bookmarks.length === 0) {
    return Buffer.from(await pdfDoc.save());
  }

  // Validate all bookmarks before modifying
  for (const bm of bookmarks) {
    if (!bm.title || typeof bm.title !== 'string') {
      throw new Error('Bookmark title must be a non-empty string');
    }
    if (typeof bm.page !== 'number' || bm.page < 1 || bm.page > pages.length) {
      throw new Error(`Invalid bookmark page: ${bm.page}. PDF has ${pages.length} pages.`);
    }
  }

  // Create outlines dictionary
  const outlinesDict = pdfDoc.context.obj({
    Type: 'Outlines',
    Count: bookmarks.length
  });

  // Create bookmark refs
  const bookmarkRefs = bookmarks.map(() => pdfDoc.context.nextRef());

  // Build bookmark structure
  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const bookmarkRef = bookmarkRefs[i];

    const pageIndex = bm.page - 1; // bm.page is already validated to be >= 1
    const targetPage = pages[pageIndex];

    if (!targetPage) {
      // This should not happen due to validation above, but handle gracefully
      console.warn(`Skipping bookmark "${bm.title}" - page ${bm.page} does not exist`);
      continue;
    }

    // Create destination array [pageRef, XYZ, left, top, zoom]
    const dest = pdfDoc.context.obj([
      targetPage.ref,
      'XYZ',
      null,
      null,
      null
    ]);

    // Create bookmark dictionary
    const bookmarkDict = pdfDoc.context.obj({
      Title: PDFString.of(bm.title),
      Dest: dest
    });

    // Add parent/child relationships
    if (i > 0) {
      bookmarkDict.set(PDFName.of('Prev'), bookmarkRefs[i - 1]);
    }
    if (i < bookmarks.length - 1) {
      bookmarkDict.set(PDFName.of('Next'), bookmarkRefs[i + 1]);
    }

    // Add to document
    pdfDoc.context.assign(bookmarkRef, bookmarkDict);
  }

  if (bookmarkRefs.length > 0) {
    outlinesDict.set(PDFName.of('First'), bookmarkRefs[0]);
    outlinesDict.set(PDFName.of('Last'), bookmarkRefs[bookmarkRefs.length - 1]);
  }

  // Add outlines to catalog
  const outlinesRef = pdfDoc.context.register(outlinesDict);
  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  return Buffer.from(await pdfDoc.save());
}

module.exports = {
  mergePDFs,
  splitPDF,
  addWatermark,
  loadPDF,
  applyEdits,
  rotatePDF,
  deletePages,
  protectPDF,
  getBookmarks,
  addBookmarks
};
