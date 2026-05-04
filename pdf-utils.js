const { PDFDocument, rgb, StandardFonts, degrees, PDFName, PDFHexString } = require('pdf-lib');
const fs = require('fs').promises;
const {
  validateString,
  validateArray,
  validateNumber
} = require('./validation');

let fontkit = null;
try {
  fontkit = require('@pdf-lib/fontkit');
} catch (error) {
  fontkit = null;
}

async function loadPdfDocument(filePath) {
  validateString(filePath, 'filePath');
  try {
    const fileData = await fs.readFile(filePath);
    return await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }
}

let mergePromise = null;

// Exposed for testing only
function _resetMergePromise() {
  mergePromise = null;
}

async function mergePDFs(filePaths) {
  if (mergePromise) {
    throw new Error('Another merge operation is in progress');
  }

  mergePromise = (async () => {
    try {
      validateArray(filePaths, 'filePaths');

      const pdfDocs = await Promise.all(
        filePaths.map(async (filePath) => {
          validateString(filePath, 'filePath');
          try {
            const fileData = await fs.readFile(filePath);
            return await PDFDocument.load(fileData);
          } catch (error) {
            throw new Error(`Failed to read PDF file ${filePath}: ${error.message}`);
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
    } finally {
      mergePromise = null;
    }
  })();

  return mergePromise;
}

async function splitPDF(filePath, ranges) {
  validateString(filePath, 'filePath');
  validateArray(ranges, 'ranges');

  const pdfDoc = await loadPdfDocument(filePath);

  const totalPages = pdfDoc.getPageCount();

  const result = [];
  for (const range of ranges) {
    const pageIndices = parsePageRange(range.trim(), totalPages);
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(pdfDoc, pageIndices);
    pages.forEach(page => newDoc.addPage(page));
    result.push(await newDoc.save());
  }

  return result.map(b => Buffer.from(b));
}

async function addWatermark(filePath, text, options = {}) {
  validateString(filePath, 'filePath');
  validateString(text, 'text');

  const pdfDoc = await loadPdfDocument(filePath);

  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont('Helvetica');
  const opacity = options.opacity !== undefined ? options.opacity : 0.5;

  pages.forEach(page => {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - 100,
      y: height / 2,
      size: 40,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: opacity,
      rotate: degrees(-45)
    });
  });

  return Buffer.from(await pdfDoc.save());
}

async function loadPDF(filePath) {
  const pdfDoc = await loadPdfDocument(filePath);

  return {
    pageCount: pdfDoc.getPageCount(),
    filePath
  };
}

async function applyEdits(filePath, operations) {
  validateString(filePath, 'filePath');
  validateArray(operations, 'operations');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const fontCache = {};
  if (fontkit && typeof pdfDoc.registerFontkit === 'function') {
    pdfDoc.registerFontkit(fontkit);
  }

  async function findChineseFont() {
    const fontPaths = [
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/PingFang.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
      'C:\\Windows\\Fonts\\simsun.ttc',
    ];

    for (const fontPath of fontPaths) {
      try {
        await fs.access(fontPath);
        return fontPath;
      } catch (e) {
        // Continue searching
      }
    }
    return null;
  }

  function containsNonWinAnsiText(text) {
    return typeof text === 'string' && /[^\u0000-\u00ff]/.test(text);
  }

  async function getFont(pdfDoc, fontName, fontPath = null, text = '') {
    const needsUnicodeFont = containsNonWinAnsiText(text);
    const resolvedFontPath = fontPath || (needsUnicodeFont ? await findChineseFont() : null);
    const cacheKey = `${pdfDoc.docId}_${fontName}_${resolvedFontPath || 'default'}_${needsUnicodeFont ? 'unicode' : 'latin'}`;
    if (fontCache[cacheKey]) {
      return fontCache[cacheKey];
    }

    let font;
    const normalizedName = fontName.toLowerCase().replace(/\s+/g, '');

    try {
      if (resolvedFontPath) {
        if (!fontkit) {
          throw new Error('Writing Chinese text requires @pdf-lib/fontkit');
        }
        try {
          await fs.access(resolvedFontPath);
          const fontBytes = await fs.readFile(resolvedFontPath);
          font = await pdfDoc.embedFont(fontBytes);
        } catch (e) {
          console.warn(`Font file not found: ${resolvedFontPath}, using fallback`);
          font = pdfDoc.embedFont(StandardFonts.Helvetica);
        }
      } else if (normalizedName.includes('simsun') || normalizedName.includes('songti')) {
        font = pdfDoc.embedFont(StandardFonts.Helvetica);
      } else if (normalizedName.includes('times')) {
        font = pdfDoc.embedFont(StandardFonts.TimesRoman);
      } else {
        try {
          font = await pdfDoc.embedFont(fontName);
        } catch (e) {
          font = pdfDoc.embedFont(StandardFonts.Helvetica);
        }
      }
    } catch (error) {
      console.warn(`Failed to load font ${fontName}, using Helvetica fallback:`, error.message);
      font = pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    fontCache[cacheKey] = font;
    return font;
  }

  const opsByPage = {};
  operations.forEach(op => {
    if (!opsByPage[op.page]) {
      opsByPage[op.page] = [];
    }
    opsByPage[op.page].push(op);
  });

  for (const [pageNum, pageOps] of Object.entries(opsByPage)) {
    const pageIndex = parseInt(pageNum) - 1;
    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    for (const op of pageOps) {
      const pdfX = op.x;
      const pdfY = height - op.y;

      switch (op.type) {
        case 'eraser':
          page.drawRectangle({
            x: pdfX,
            y: pdfY - op.height,
            width: op.width,
            height: op.height,
            color: rgb(1, 1, 1)
          });
          break;

        case 'text':
          const color = hexToRgb(op.color);
          const textFont = await getFont(pdfDoc, op.fontFamily || 'Helvetica', op.fontPath, op.text);
          page.drawText(op.text, {
            x: pdfX,
            y: pdfY,
            size: op.fontSize,
            font: textFont,
            color: rgb(color.r / 255, color.g / 255, color.b / 255)
          });
          break;

        case 'highlight':
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
          const underlineColor = hexToRgb(op.color);
          page.drawLine({
            start: { x: pdfX, y: pdfY },
            end: { x: pdfX + op.width, y: pdfY },
            color: rgb(underlineColor.r / 255, underlineColor.g / 255, underlineColor.b / 255),
            thickness: op.lineWidth || 2
          });
          break;

        case 'editText':
          const editUsesCanvasCoordinates = op.coordinateSpace === 'canvas';
          const editX = editUsesCanvasCoordinates ? pdfX : op.x;
          const editY = editUsesCanvasCoordinates ? pdfY : op.y;

          page.drawRectangle({
            x: editX - 2,
            y: editY - 2,
            width: op.width + 4,
            height: op.height + 4,
            color: rgb(1, 1, 1)
          });

          const editColor = hexToRgb(op.newColor || op.color);
          const editFontSize = op.newFontSize || op.fontSize || 12;
          const editFontFamily = op.newFontFamily || 'Helvetica';
          const editFont = await getFont(pdfDoc, editFontFamily, op.fontPath, op.newText);

          page.drawText(op.newText, {
            x: editX,
            y: editY,
            size: editFontSize,
            font: editFont,
            color: rgb(editColor.r / 255, editColor.g / 255, editColor.b / 255)
          });
          break;
      }
    }
  }

  return Buffer.from(await pdfDoc.save());
}

function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function parsePageRange(range, totalPages) {
  const trimmed = range.trim();

  if (trimmed.includes('-')) {
    const [start, end] = trimmed.split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
      throw new Error(`Invalid page range: ${range}`);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  } else {
    const pageNum = Number(trimmed);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      throw new Error(`Invalid page number: ${range}`);
    }
    return [pageNum - 1];
  }
}

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
    throw new Error(`Failed to read PDF file: ${error.message}`);
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

async function deletePages(filePath, pageNumbers) {
  validateString(filePath, 'filePath');
  validateArray(pageNumbers, 'pageNumbers');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const sortedPages = [...pageNumbers].sort((a, b) => b - a);

  sortedPages.forEach(pageNum => {
    pdfDoc.removePage(pageNum - 1);
  });

  return Buffer.from(await pdfDoc.save());
}

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
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  if (!ownerPassword) {
    throw new Error('ownerPassword is required for PDF protection');
  }

  const encryptedPdf = await pdfDoc.save({
    userPassword,
    ownerPassword,
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

async function getBookmarks(filePath) {
  validateString(filePath, 'filePath');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const catalog = pdfDoc.catalog;

  const outlinesRef = catalog.get(PDFName.of('Outlines'));
  if (!outlinesRef) {
    return [];
  }

  const outlines = pdfDoc.context.lookup(outlinesRef);
  if (!outlines || typeof outlines.get !== 'function') {
    return [];
  }

  const firstRef = outlines.get(PDFName.of('First'));
  if (!firstRef) {
    return [];
  }

  const bookmarks = [];
  const visitedRefs = new Set();
  const MAX_DEPTH = 20;
  const MAX_BOOKMARKS = 1000;

  function isPDFRef(obj) {
    if (!obj) return false;
    if (obj.constructor && obj.constructor.name === 'PDFRef') return true;
    if (typeof obj.objectNumber === 'number' && typeof obj.generationNumber === 'number') return true;
    return false;
  }

  function findPageIndex(pageRef, doc) {
    try {
      const pages = doc.getPages();
      const refStr = pageRef.toString();
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].ref.toString() === refStr) {
          return i;
        }
      }
      const lookedUp = doc.context.lookup(pageRef);
      if (lookedUp) {
        const lookedUpStr = lookedUp.toString();
        for (let i = 0; i < pages.length; i++) {
          if (pages[i].ref.toString() === lookedUpStr) {
            return i;
          }
        }
      }
    } catch (e) {
      // ignore
    }
    return -1;
  }

  function resolveDestPageRef(destObj, doc, cat) {
    if (!destObj) return null;

    // JS Array (already resolved)
    if (Array.isArray(destObj)) {
      return destObj[0] || null;
    }

    // PDFArray object from pdf-lib
    if (typeof destObj === 'object' && typeof destObj.get === 'function' && typeof destObj.size === 'function') {
      try {
        const firstElem = destObj.get(0);
        if (firstElem) return firstElem;
      } catch (e) {
        // ignore
      }
    }

    // PDFRef or indirect reference
    if (isPDFRef(destObj)) {
      return destObj;
    }

    // PDFHexString or PDFName (named destination)
    if (typeof destObj === 'object' && typeof destObj.decodeText === 'function') {
      const destName = destObj.decodeText();
      return resolveNamedDest(destName, doc, cat);
    }

    // PDFName
    if (typeof destObj === 'object' && typeof destObj.toString === 'function') {
      const str = destObj.toString();
      if (str.startsWith('/')) {
        return resolveNamedDest(str.substring(1), doc, cat);
      }
      return resolveNamedDest(str, doc, cat);
    }

    return null;
  }

  function resolveNamedDest(name, doc, cat) {
    if (!name) return null;

    // Try Names tree first
    const names = cat.get(PDFName.of('Names'));
    if (names && typeof names.get === 'function') {
      const destsTree = names.get(PDFName.of('Dests'));
      if (destsTree) {
        const result = resolveNamedDestFromTree(PDFName.of(name), destsTree, doc);
        if (result) return result;
      }
    }

    // Try Dests dict
    const dests = cat.get(PDFName.of('Dests'));
    if (dests && typeof dests.get === 'function') {
      try {
        const namedDest = dests.get(PDFName.of(name));
        if (namedDest) {
          if (Array.isArray(namedDest)) {
            return namedDest[0] || null;
          }
          if (typeof namedDest === 'object' && typeof namedDest.get === 'function' && typeof namedDest.size === 'function') {
            return namedDest.get(0) || null;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    return null;
  }

  function pdfObjToStr(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'object' && typeof obj.decodeText === 'function') return obj.decodeText();
    if (typeof obj === 'object' && typeof obj.toString === 'function') return obj.toString().replace(/^\//, '');
    return String(obj);
  }

  function resolveNamedDestFromTree(destName, tree, doc) {
    if (!tree || typeof tree.get !== 'function') return null;

    const nameStr = pdfObjToStr(destName);

    // Check if this is a name tree node with Kids (intermediate node)
    const kids = tree.get(PDFName.of('Kids'));
    if (kids && typeof kids === 'object' && typeof kids.get === 'function') {
      for (let i = 0; i < (kids.size ? kids.size() : 0); i++) {
        try {
          const kidRef = kids.get(i);
          const kid = doc.context.lookup(kidRef);
          const limits = kid.get(PDFName.of('Limits'));
          if (limits && typeof limits === 'object' && typeof limits.get === 'function') {
            const lowStr = pdfObjToStr(limits.get(0));
            const highStr = pdfObjToStr(limits.get(1));
            if (nameStr < lowStr || nameStr > highStr) continue;
          }
          const result = resolveNamedDestFromTree(destName, kid, doc);
          if (result) return result;
        } catch (e) {
          continue;
        }
      }
      return null;
    }

    // Leaf node - check Names array
    const namesArr = tree.get(PDFName.of('Names'));
    if (namesArr && typeof namesArr === 'object' && typeof namesArr.get === 'function') {
      const size = namesArr.size ? namesArr.size() : 0;
      for (let i = 0; i < size - 1; i += 2) {
        try {
          const key = namesArr.get(i);
          const val = namesArr.get(i + 1);
          if (pdfObjToStr(key) === nameStr) {
            if (Array.isArray(val)) {
              return val[0] || null;
            }
            if (typeof val === 'object' && typeof val.get === 'function' && typeof val.size === 'function') {
              return val.get(0) || null;
            }
            return val;
          }
        } catch (e) {
          continue;
        }
      }
    }

    return null;
  }

  function parseBookmark(bookmarkRef, level = 0) {
    if (bookmarks.length >= MAX_BOOKMARKS) {
      return null;
    }

    const refStr = bookmarkRef.toString();
    if (visitedRefs.has(refStr)) {
      return null;
    }
    visitedRefs.add(refStr);

    if (level > MAX_DEPTH) {
      return null;
    }

    const bookmark = pdfDoc.context.lookup(bookmarkRef);
    if (!bookmark || typeof bookmark.get !== 'function') return null;

    const title = bookmark.get(PDFName.of('Title'));
    let dest = bookmark.get(PDFName.of('Dest'));

    let pageNum = null;
    let pageIndex = null;
    let pageRef = null;

    // Handle GoTo action
    if (!dest) {
      const a = bookmark.get(PDFName.of('A'));
      if (a && typeof a.get === 'function') {
        const s = a.get(PDFName.of('S'));
        if (s && s.toString() === '/GoTo') {
          dest = a.get(PDFName.of('D'));
        }
      }
    }

    if (dest) {
      pageRef = resolveDestPageRef(dest, pdfDoc, catalog);
    }

    if (pageRef) {
      const found = findPageIndex(pageRef, pdfDoc);
      if (found >= 0) {
        pageIndex = found;
        pageNum = found + 1;
      }
    }

    let titleStr = 'Untitled';
    if (title) {
      if (typeof title.decodeText === 'function') {
        titleStr = title.decodeText();
      } else if (title.value) {
        titleStr = title.value;
      }
    }

    const result = {
      title: titleStr,
      page: pageNum,
      pageIndex: pageIndex,
      level,
      ref: bookmarkRef.toString()
    };

    const parsedBookmarks = [result];

    const firstChildRef = bookmark.get(PDFName.of('First'));
    if (firstChildRef) {
      let currentChildRef = firstChildRef;
      let childCount = 0;
      while (currentChildRef && childCount < 100) {
        const childRefStr = currentChildRef.toString();
        if (visitedRefs.has(childRefStr)) {
          break;
        }

        const childBookmark = parseBookmark(currentChildRef, level + 1);
        if (childBookmark) {
          parsedBookmarks.push(...childBookmark);
        }

        childCount++;

        try {
          const currentChild = pdfDoc.context.lookup(currentChildRef);
          currentChildRef = currentChild && typeof currentChild.get === 'function' ? currentChild.get(PDFName.of('Next')) : null;
        } catch (e) {
          break;
        }
      }
    }

    return parsedBookmarks;
  }

  let currentRef = firstRef;
  let topLevelCount = 0;
  while (currentRef && topLevelCount < 500) {
    const refStr = currentRef.toString();
    if (visitedRefs.has(refStr)) {
      break;
    }

    const bookmarkList = parseBookmark(currentRef, 0);
    if (bookmarkList) {
      bookmarks.push(...bookmarkList);
    }

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

async function addBookmarks(filePath, bookmarks) {
  validateString(filePath, 'filePath');
  validateArray(bookmarks, 'bookmarks');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const pages = pdfDoc.getPages();

  if (!bookmarks || bookmarks.length === 0) {
    return Buffer.from(await pdfDoc.save());
  }

  for (const bm of bookmarks) {
    if (!bm.title || typeof bm.title !== 'string') {
      throw new Error('Bookmark title must be a non-empty string');
    }
    if (typeof bm.page !== 'number' || bm.page < 1 || bm.page > pages.length) {
      throw new Error(`Invalid bookmark page: ${bm.page}. PDF has ${pages.length} pages.`);
    }
  }

  const outlinesDict = pdfDoc.context.obj({
    Type: 'Outlines',
    Count: bookmarks.length
  });

  const outlinesRef = pdfDoc.context.register(outlinesDict);
  const bookmarkRefs = bookmarks.map(() => pdfDoc.context.nextRef());

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const bookmarkRef = bookmarkRefs[i];

    const pageIndex = bm.page - 1;
    const targetPage = pages[pageIndex];

    if (!targetPage) {
      continue;
    }

    const dest = pdfDoc.context.obj([
      targetPage.ref,
      'XYZ',
      null,
      null,
      null
    ]);

    const bookmarkDict = pdfDoc.context.obj({
      Title: PDFHexString.fromText(bm.title),
      Dest: dest,
      Parent: outlinesRef
    });

    if (i > 0) {
      bookmarkDict.set(PDFName.of('Prev'), bookmarkRefs[i - 1]);
    }
    if (i < bookmarks.length - 1) {
      bookmarkDict.set(PDFName.of('Next'), bookmarkRefs[i + 1]);
    }

    pdfDoc.context.assign(bookmarkRef, bookmarkDict);
  }

  if (bookmarkRefs.length > 0) {
    outlinesDict.set(PDFName.of('First'), bookmarkRefs[0]);
    outlinesDict.set(PDFName.of('Last'), bookmarkRefs[bookmarkRefs.length - 1]);
  }

  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  return Buffer.from(await pdfDoc.save());
}

async function movePage(filePath, fromIndex, toIndex) {
  validateString(filePath, 'filePath');
  validateNumber(fromIndex, 'fromIndex', 0, 100000);
  validateNumber(toIndex, 'toIndex', 0, 100000);

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const totalPages = pdfDoc.getPageCount();
  
  if (fromIndex < 0 || fromIndex >= totalPages) {
    throw new Error(`Invalid fromIndex: ${fromIndex}. PDF has ${totalPages} pages.`);
  }
  if (toIndex < 0 || toIndex >= totalPages) {
    throw new Error(`Invalid toIndex: ${toIndex}. PDF has ${totalPages} pages.`);
  }

  if (fromIndex === toIndex) {
    return Buffer.from(await pdfDoc.save());
  }

  const pages = pdfDoc.getPages();
  const pageToMove = pages[fromIndex];
  
  pdfDoc.removePage(fromIndex);
  
  if (toIndex > fromIndex) {
    pdfDoc.insertPage(toIndex - 1, pageToMove);
  } else {
    pdfDoc.insertPage(toIndex, pageToMove);
  }

  return Buffer.from(await pdfDoc.save());
}

async function addPageNumbers(filePath, options = {}) {
  validateString(filePath, 'filePath');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const format = options.format || 'simple';
  const position = options.position || 'bottom-center';
  const fontSize = options.fontSize || 12;
  const startPage = options.startPage || 1;
  const skipFirst = options.skipFirst || false;
  const margin = options.margin || 30;

  for (let i = 0; i < totalPages; i++) {
    if (skipFirst && i === 0) continue;

    const page = pages[i];
    const { width, height } = page.getSize();
    const pageNum = i + startPage;
    
    let text;
    switch (format) {
      case 'page':
        text = `Page ${pageNum}`;
        break;
      case 'total':
        text = `Page ${pageNum} of ${totalPages}`;
        break;
      case 'simple':
        text = `${pageNum} / ${totalPages}`;
        break;
      case 'custom':
        text = (options.customFormat || '{page} / {total}')
          .replace('{page}', pageNum)
          .replace('{total}', totalPages);
        break;
      default:
        text = `${pageNum}`;
    }

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    let x, y;

    switch (position) {
      case 'bottom-left':
        x = margin;
        y = margin;
        break;
      case 'bottom-right':
        x = width - textWidth - margin;
        y = margin;
        break;
      case 'top-center':
        x = (width - textWidth) / 2;
        y = height - margin;
        break;
      case 'top-left':
        x = margin;
        y = height - margin;
        break;
      case 'top-right':
        x = width - textWidth - margin;
        y = height - margin;
        break;
      case 'bottom-center':
      default:
        x = (width - textWidth) / 2;
        y = margin;
    }

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0)
    });
  }

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
  addBookmarks,
  movePage,
  addPageNumbers,
  _resetMergePromise
};
