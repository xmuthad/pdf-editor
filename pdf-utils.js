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

  const info = {
    pageCount: pdfDoc.getPageCount(),
    filePath
  };

  try {
    const metadata = pdfDoc.getTitle();
    if (metadata) {
      info.title = pdfDoc.getTitle() || '';
      info.author = pdfDoc.getAuthor() || '';
      info.subject = pdfDoc.getSubject() || '';
      info.keywords = pdfDoc.getKeywords() || '';
      info.creator = pdfDoc.getCreator() || '';
      info.producer = pdfDoc.getProducer() || '';
      info.creationDate = pdfDoc.getCreationDate();
      info.modificationDate = pdfDoc.getModificationDate();
    }
  } catch (e) {
    // Metadata might not be available
  }

  return info;
}

async function setPDFMetadata(filePath, metadata) {
  validateString(filePath, 'filePath');
  validateObject(metadata, 'metadata');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  if (metadata.title !== undefined) pdfDoc.setTitle(metadata.title);
  if (metadata.author !== undefined) pdfDoc.setAuthor(metadata.author);
  if (metadata.subject !== undefined) pdfDoc.setSubject(metadata.subject);
  if (metadata.keywords !== undefined) pdfDoc.setKeywords(metadata.keywords.split(',').map(k => k.trim()).filter(k => k));
  if (metadata.creator !== undefined) pdfDoc.setCreator(metadata.creator);
  if (metadata.modificationDate !== undefined) {
    pdfDoc.setModificationDate(new Date());
  }

  return Buffer.from(await pdfDoc.save());
}

async function insertPages(targetPath, sourcePath, insertAfterPage, sourcePages) {
  validateString(targetPath, 'targetPath');
  validateString(sourcePath, 'sourcePath');
  validateNumber(insertAfterPage, 'insertAfterPage', 0, 100000);
  validateArray(sourcePages, 'sourcePages');

  let targetData, sourceData, targetDoc, sourceDoc;

  try {
    [targetData, sourceData] = await Promise.all([
      fs.readFile(targetPath),
      fs.readFile(sourcePath)
    ]);
    [targetDoc, sourceDoc] = await Promise.all([
      PDFDocument.load(targetData),
      PDFDocument.load(sourceData)
    ]);
  } catch (error) {
    throw new Error(`Failed to read PDF files: ${error.message}`);
  }

  const targetPageCount = targetDoc.getPageCount();
  const sourcePageCount = sourceDoc.getPageCount();

  if (insertAfterPage < 0 || insertAfterPage > targetPageCount) {
    throw new Error(`Invalid insertAfterPage: ${insertAfterPage}. Target PDF has ${targetPageCount} pages.`);
  }

  // Validate source pages
  for (const pageNum of sourcePages) {
    if (pageNum < 1 || pageNum > sourcePageCount) {
      throw new Error(`Invalid source page: ${pageNum}. Source PDF has ${sourcePageCount} pages.`);
    }
  }

  // Copy pages from source to target
  const copiedPages = await targetDoc.copyPages(sourceDoc, sourcePages.map(p => p - 1));

  // Insert pages at the specified position
  for (let i = 0; i < copiedPages.length; i++) {
    targetDoc.insertPage(insertAfterPage + i, copiedPages[i]);
  }

  return Buffer.from(await targetDoc.save());
}

async function insertBlankPage(filePath, insertAfterPage, width, height) {
  validateString(filePath, 'filePath');
  validateNumber(insertAfterPage, 'insertAfterPage', 0, 100000);

  let fileData, pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const pageCount = pdfDoc.getPageCount();

  if (insertAfterPage < 0 || insertAfterPage > pageCount) {
    throw new Error(`Invalid insertAfterPage: ${insertAfterPage}. PDF has ${pageCount} pages.`);
  }

  // Use provided dimensions or default to A4 (595.28 x 841.89 points)
  const pageWidth = width || 595.28;
  const pageHeight = height || 841.89;

  const blankPage = pdfDoc.insertPage(insertAfterPage, [pageWidth, pageHeight]);

  return Buffer.from(await pdfDoc.save());
}

async function cropPages(filePath, pageCrops) {
  validateString(filePath, 'filePath');
  validateArray(pageCrops, 'pageCrops');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const pages = pdfDoc.getPages();
  const pageCount = pages.length;

  for (const crop of pageCrops) {
    const pageIndex = crop.page - 1;
    
    if (pageIndex < 0 || pageIndex >= pageCount) {
      throw new Error(`Invalid page number: ${crop.page}`);
    }

    const page = pages[pageIndex];
    const { width, height } = page.getSize();

    const x = Math.max(0, Math.min(crop.x || 0, width));
    const y = Math.max(0, Math.min(crop.y || 0, height));
    const cropWidth = Math.max(1, Math.min(crop.width || width - x, width - x));
    const cropHeight = Math.max(1, Math.min(crop.height || height - y, height - y));

    page.setCropBox(x, y, cropWidth, cropHeight);
  }

  return Buffer.from(await pdfDoc.save());
}

async function getPageDimensions(filePath, pageNum) {
  validateString(filePath, 'filePath');
  validateNumber(pageNum, 'pageNum', 1, 100000);

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData);
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const pages = pdfDoc.getPages();
  
  if (pageNum < 1 || pageNum > pages.length) {
    throw new Error(`Invalid page number: ${pageNum}. PDF has ${pages.length} pages.`);
  }

  const page = pages[pageNum - 1];
  const { width, height } = page.getSize();

  return { width, height, pageNum };
}

async function compressPDF(filePath, options = {}) {
  validateString(filePath, 'filePath');

  let fileData;
  let pdfDoc;

  try {
    fileData = await fs.readFile(filePath);
    pdfDoc = await PDFDocument.load(fileData, { 
      ignoreEncryption: true,
      updateMetadata: false
    });
  } catch (error) {
    throw new Error(`Failed to read PDF file: ${error.message}`);
  }

  const originalSize = fileData.length;

  // Compress by re-saving with optimization options
  const compressedBytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: options.objectsPerTick || 50,
  });

  const compressedSize = compressedBytes.length;
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

  return {
    data: Buffer.from(compressedBytes),
    originalSize,
    compressedSize,
    compressionRatio
  };
}

async function imagesToPDF(imagePaths, options = {}) {
  validateArray(imagePaths, 'imagePaths');

  if (imagePaths.length === 0) {
    throw new Error('No images provided');
  }

  const pdfDoc = await PDFDocument.create();
  const pageSize = options.pageSize || 'a4';
  const orientation = options.orientation || 'portrait';

  // Page sizes in points (1 inch = 72 points)
  const pageSizes = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
    legal: { width: 612, height: 1008 },
    a3: { width: 841.89, height: 1190.55 }
  };

  let defaultWidth, defaultHeight;
  if (pageSize === 'fit') {
    // Will be determined by image size
    defaultWidth = 595.28;
    defaultHeight = 841.89;
  } else {
    const size = pageSizes[pageSize] || pageSizes.a4;
    defaultWidth = size.width;
    defaultHeight = size.height;
  }

  for (const imagePath of imagePaths) {
    try {
      const imageBytes = await fs.readFile(imagePath);
      let image;

      const ext = imagePath.toLowerCase().split('.').pop();
      
      if (ext === 'png') {
        image = await pdfDoc.embedPng(imageBytes);
      } else if (ext === 'jpg' || ext === 'jpeg') {
        image = await pdfDoc.embedJpg(imageBytes);
      } else {
        console.warn(`Unsupported image format: ${ext}, skipping ${imagePath}`);
        continue;
      }

      const { width: imgWidth, height: imgHeight } = image.scale(1);

      let pageWidth, pageHeight;
      let drawWidth, drawHeight;
      let x, y;

      if (pageSize === 'fit') {
        // Use image dimensions as page size
        pageWidth = imgWidth;
        pageHeight = imgHeight;
        drawWidth = imgWidth;
        drawHeight = imgHeight;
        x = 0;
        y = 0;
      } else {
        pageWidth = defaultWidth;
        pageHeight = defaultHeight;

        // Swap dimensions for landscape
        if (orientation === 'landscape') {
          [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }

        // Scale image to fit page with margins
        const margin = options.margin || 20;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;

        const scaleX = maxWidth / imgWidth;
        const scaleY = maxHeight / imgHeight;
        const scale = Math.min(scaleX, scaleY, 1);

        drawWidth = imgWidth * scale;
        drawHeight = imgHeight * scale;

        // Center image on page
        x = (pageWidth - drawWidth) / 2;
        y = (pageHeight - drawHeight) / 2;
      }

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, {
        x,
        y,
        width: drawWidth,
        height: drawHeight
      });
    } catch (error) {
      console.error(`Failed to add image ${imagePath}:`, error.message);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function resizePages(filePath, pageNumbers, newSize, options = {}) {
  validateString(filePath, 'filePath');
  validateArray(pageNumbers, 'pageNumbers');
  validateObject(newSize, 'newSize');

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

  // Page sizes in points
  const standardSizes = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
    legal: { width: 612, height: 1008 },
    a3: { width: 841.89, height: 1190.55 },
    a5: { width: 420.94, height: 595.28 }
  };

  let targetWidth, targetHeight;

  if (typeof newSize === 'string') {
    const size = standardSizes[newSize.toLowerCase()];
    if (!size) {
      throw new Error(`Unknown page size: ${newSize}`);
    }
    targetWidth = size.width;
    targetHeight = size.height;
  } else {
    targetWidth = newSize.width;
    targetHeight = newSize.height;
  }

  // Handle orientation
  if (options.orientation === 'landscape') {
    [targetWidth, targetHeight] = [targetHeight, targetWidth];
  }

  for (const pageNum of pageNumbers) {
    const pageIndex = pageNum - 1;
    
    if (pageIndex < 0 || pageIndex >= totalPages) {
      throw new Error(`Invalid page number: ${pageNum}`);
    }

    const page = pages[pageIndex];
    const { width: oldWidth, height: oldHeight } = page.getSize();

    // Calculate scale to fit content
    const scaleX = targetWidth / oldWidth;
    const scaleY = targetHeight / oldHeight;
    const scale = options.fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

    // Set new page size
    page.setSize(targetWidth, targetHeight);

    // Scale content if needed
    if (options.scaleContent !== false) {
      const contentScale = options.fit === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
      
      // Center content
      const offsetX = (targetWidth - oldWidth * contentScale) / 2;
      const offsetY = (targetHeight - oldHeight * contentScale) / 2;

      // Scale and translate page content
      page.scale(contentScale, contentScale);
      page.translateContent(offsetX, offsetY);
    }
  }

  return Buffer.from(await pdfDoc.save());
}

async function extractText(filePath, pageNum = null) {
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

  if (pageNum !== null) {
    validateNumber(pageNum, 'pageNum', 1, totalPages);
    const page = pages[pageNum - 1];
    const textContent = await page.getTextContent ? await page.getTextContent() : { items: [] };
    return {
      page: pageNum,
      text: textContent.items ? textContent.items.map(item => item.str).join(' ') : ''
    };
  }

  const allText = [];
  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    try {
      const textContent = await page.getTextContent ? await page.getTextContent() : { items: [] };
      allText.push({
        page: i + 1,
        text: textContent.items ? textContent.items.map(item => item.str).join(' ') : ''
      });
    } catch (e) {
      allText.push({ page: i + 1, text: '' });
    }
  }

  return allText;
}

async function extractImages(filePath, pageNum = null) {
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
  const images = [];

  for (let i = 0; i < totalPages; i++) {
    if (pageNum !== null && i !== pageNum - 1) continue;

    const page = pages[i];
    const resources = page.node.get('Resources');
    
    if (resources) {
      const xObject = resources.get('XObject');
      if (xObject) {
        const xObjectDict = xObject.dict;
        const keys = xObjectDict.keys();
        
        for (const key of keys) {
          try {
            const obj = xObjectDict.get(key);
            if (obj) {
              const subtype = obj.get('Subtype');
              if (subtype && subtype.toString() === '/Image') {
                images.push({
                  page: i + 1,
                  key: key.toString(),
                  width: obj.get('Width')?.toNumber() || 0,
                  height: obj.get('Height')?.toNumber() || 0
                });
              }
            }
          } catch (e) {
            // Skip invalid objects
          }
        }
      }
    }
  }

  return images;
}

async function addHeaderFooter(filePath, options = {}) {
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

  const headerText = options.headerText || '';
  const footerText = options.footerText || '';
  const fontSize = options.fontSize || 10;
  const margin = options.margin || 30;
  const skipFirst = options.skipFirst || false;

  for (let i = 0; i < totalPages; i++) {
    if (skipFirst && i === 0) continue;

    const page = pages[i];
    const { width, height } = page.getSize();

    // Add header
    if (headerText) {
      const text = headerText
        .replace('{page}', String(i + 1))
        .replace('{total}', String(totalPages));
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height - margin,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    }

    // Add footer
    if (footerText) {
      const text = footerText
        .replace('{page}', String(i + 1))
        .replace('{total}', String(totalPages));
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: margin,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    }
  }

  return Buffer.from(await pdfDoc.save());
}

async function addBackground(filePath, options = {}) {
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

  const bgColor = options.color || '#ffffff';
  const opacity = options.opacity !== undefined ? options.opacity : 0.5;
  const skipFirst = options.skipFirst || false;

  // Parse color
  let r = 1, g = 1, b = 1;
  if (bgColor.startsWith('#')) {
    const hex = bgColor.slice(1);
    r = parseInt(hex.slice(0, 2), 16) / 255;
    g = parseInt(hex.slice(2, 4), 16) / 255;
    b = parseInt(hex.slice(4, 6), 16) / 255;
  }

  for (let i = 0; i < totalPages; i++) {
    if (skipFirst && i === 0) continue;

    const page = pages[i];
    const { width, height } = page.getSize();

    // Draw background rectangle
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(r, g, b),
      opacity
    });
  }

  return Buffer.from(await pdfDoc.save());
}

async function getDocumentStats(filePath) {
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
  const stats = {
    pageCount: totalPages,
    fileSize: fileData.length,
    textChars: 0,
    imageCount: 0,
    pageSize: [],
    title: pdfDoc.getTitle() || '',
    author: pdfDoc.getAuthor() || '',
    creator: pdfDoc.getCreator() || '',
    producer: pdfDoc.getProducer() || '',
    creationDate: pdfDoc.getCreationDate(),
    modificationDate: pdfDoc.getModificationDate()
  };

  for (let i = 0; i < totalPages; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    stats.pageSize.push({ page: i + 1, width, height });

    // Count images
    const resources = page.node.get('Resources');
    if (resources) {
      const xObject = resources.get('XObject');
      if (xObject) {
        const xObjectDict = xObject.dict;
        const keys = xObjectDict.keys();
        for (const key of keys) {
          try {
            const obj = xObjectDict.get(key);
            if (obj) {
              const subtype = obj.get('Subtype');
              if (subtype && subtype.toString() === '/Image') {
                stats.imageCount++;
              }
            }
          } catch (e) {
            // Skip
          }
        }
      }
    }
  }

  stats.fileSizeMB = (stats.fileSize / 1024 / 1024).toFixed(2);

  return stats;
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
  setPDFMetadata,
  insertPages,
  insertBlankPage,
  cropPages,
  getPageDimensions,
  compressPDF,
  imagesToPDF,
  resizePages,
  extractText,
  extractImages,
  addHeaderFooter,
  addBackground,
  getDocumentStats,
  _resetMergePromise
};
