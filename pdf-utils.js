const { PDFDocument } = require('pdf-lib');
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
    const [start, end] = range.split('-').map(Number);
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(pdfDoc, Array.from({length: end - start + 1}, (_, i) => start - 1 + i));
    pages.forEach(page => newDoc.addPage(page));
    result.push(await newDoc.save());
  }
  
  return result.map(b => Buffer.from(b));
}

async function addWatermark(filePath, text) {
  const fileData = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(fileData);
  
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont('Helvetica');
  
  pages.forEach(page => {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width/2 - 50,
      y: height/2,
      size: 24,
      font,
      color: [0.5, 0.5, 0.5, 0.5],
      rotate: -45
    });
  });
  
  return Buffer.from(await pdfDoc.save());
}

module.exports = { mergePDFs, splitPDF, addWatermark };