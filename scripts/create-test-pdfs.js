const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

async function createTestPdfs() {
  const testsDir = path.join(__dirname, '..', 'tests', 'fixtures');
  await fs.mkdir(testsDir, { recursive: true });

  const pdf1Path = path.join(testsDir, 'test1.pdf');
  const pdf2Path = path.join(testsDir, 'test2.pdf');
  const pdf3Path = path.join(testsDir, 'test3.pdf');
  const multiPagePath = path.join(testsDir, 'multi-page.pdf');

  const pdfDoc1 = await PDFDocument.create();
  const page1 = pdfDoc1.addPage([600, 400]);
  const font1 = await pdfDoc1.embedFont(StandardFonts.Helvetica);
  page1.drawText('Test PDF 1 - Page 1', {
    x: 50,
    y: 350,
    size: 24,
    font: font1,
    color: rgb(0, 0, 0)
  });
  page1.drawText('Hello World!', {
    x: 50,
    y: 300,
    size: 16,
    font: font1,
    color: rgb(0.1, 0.1, 0.8)
  });
  const pdf1Bytes = await pdfDoc1.save();
  await fs.writeFile(pdf1Path, Buffer.from(pdf1Bytes));
  console.log(`Created: ${pdf1Path}`);

  const pdfDoc2 = await PDFDocument.create();
  const page2 = pdfDoc2.addPage([600, 400]);
  const font2 = await pdfDoc2.embedFont(StandardFonts.Helvetica);
  page2.drawText('Test PDF 2 - Page 1', {
    x: 50,
    y: 350,
    size: 24,
    font: font2,
    color: rgb(0, 0, 0)
  });
  page2.drawText('Second Document', {
    x: 50,
    y: 300,
    size: 16,
    font: font2,
    color: rgb(0.8, 0.1, 0.1)
  });
  const pdf2Bytes = await pdfDoc2.save();
  await fs.writeFile(pdf2Path, Buffer.from(pdf2Bytes));
  console.log(`Created: ${pdf2Path}`);

  const pdfDoc3 = await PDFDocument.create();
  const page3 = pdfDoc3.addPage([600, 400]);
  const font3 = await pdfDoc3.embedFont(StandardFonts.Helvetica);
  page3.drawText('Test PDF 3 - Page 1', {
    x: 50,
    y: 350,
    size: 24,
    font: font3,
    color: rgb(0, 0, 0)
  });
  page3.drawText('Third Document', {
    x: 50,
    y: 300,
    size: 16,
    font: font3,
    color: rgb(0.1, 0.7, 0.1)
  });
  const pdf3Bytes = await pdfDoc3.save();
  await fs.writeFile(pdf3Path, Buffer.from(pdf3Bytes));
  console.log(`Created: ${pdf3Path}`);

  const pdfDocMulti = await PDFDocument.create();
  for (let i = 1; i <= 3; i++) {
    const page = pdfDocMulti.addPage([600, 400]);
    const font = await pdfDocMulti.embedFont(StandardFonts.Helvetica);
    page.drawText(`Multi-Page PDF - Page ${i}`, {
      x: 50,
      y: 350,
      size: 24,
      font: font,
      color: rgb(0, 0, 0)
    });
    page.drawText(`This is page number ${i} of 3`, {
      x: 50,
      y: 300,
      size: 14,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });
    page.drawText('Line 1 of text', { x: 50, y: 250, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText('Line 2 of text', { x: 50, y: 230, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText('Line 3 of text', { x: 50, y: 210, size: 12, font, color: rgb(0, 0, 0) });
  }
  const multiBytes = await pdfDocMulti.save();
  await fs.writeFile(multiPagePath, Buffer.from(multiBytes));
  console.log(`Created: ${multiPagePath}`);

  console.log('\nTest PDF files created successfully!');
  console.log('You can use these files for E2E testing.');
}

createTestPdfs().catch(console.error);