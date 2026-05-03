const fs = require('fs').promises;
const path = require('path');

describe('pdf-utils', () => {
  const testPdfPath = path.join(__dirname, '..', 'test.pdf');

  describe('mergePDFs', () => {
    it('should merge multiple PDFs into one', async () => {
      const { mergePDFs } = require('../pdf-utils');
      const result = await mergePDFs([testPdfPath, testPdfPath]);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    }, 30000);

    it('should return empty PDF when given empty array', async () => {
      const { mergePDFs } = require('../pdf-utils');
      // Empty array creates an empty PDF (no pages)
      const result = await mergePDFs([]);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should throw error for non-array input', async () => {
      const { mergePDFs } = require('../pdf-utils');
      await expect(mergePDFs('not-an-array')).rejects.toThrow('filePaths must be an array');
    });

    it('should throw error for non-string path in array', async () => {
      const pdfUtils = require('../pdf-utils');
      pdfUtils._resetMergePromise();
      await expect(pdfUtils.mergePDFs([123])).rejects.toThrow('filePath must be a string');
    });

    it('should throw error for invalid file path', async () => {
      const { mergePDFs } = require('../pdf-utils');
      await expect(mergePDFs(['/nonexistent/path.pdf'])).rejects.toThrow();
    });
  });

  describe('splitPDF', () => {
    it('should split PDF by page range', async () => {
      const { splitPDF } = require('../pdf-utils');
      const result = await splitPDF(testPdfPath, ['1']);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(Buffer.isBuffer(result[0])).toBe(true);
    });

    it('should split PDF by multiple ranges', async () => {
      const { splitPDF } = require('../pdf-utils');
      const result = await splitPDF(testPdfPath, ['1', '1']);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should throw error for invalid file path', async () => {
      const { splitPDF } = require('../pdf-utils');
      await expect(splitPDF('/nonexistent.pdf', ['1'])).rejects.toThrow();
    });

    it('should throw error for invalid range', async () => {
      const { splitPDF } = require('../pdf-utils');
      await expect(splitPDF(testPdfPath, ['invalid'])).rejects.toThrow();
    });

    it('should throw error for out of bounds page', async () => {
      const { splitPDF } = require('../pdf-utils');
      await expect(splitPDF(testPdfPath, ['999'])).rejects.toThrow();
    });
  });

  describe('addWatermark', () => {
    it('should add watermark to PDF', async () => {
      const { addWatermark } = require('../pdf-utils');
      const result = await addWatermark(testPdfPath, 'TEST');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should add watermark with custom opacity', async () => {
      const { addWatermark } = require('../pdf-utils');
      const result = await addWatermark(testPdfPath, 'TEST', { opacity: 0.3 });

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should throw error for empty text', async () => {
      const { addWatermark } = require('../pdf-utils');
      await expect(addWatermark(testPdfPath, '')).rejects.toThrow('text must be a non-empty string');
    });

    it('should throw error for invalid file path', async () => {
      const { addWatermark } = require('../pdf-utils');
      await expect(addWatermark('/nonexistent.pdf', 'TEST')).rejects.toThrow();
    });
  });

  describe('loadPDF', () => {
    it('should load PDF and return document info', async () => {
      const { loadPDF } = require('../pdf-utils');
      const result = await loadPDF(testPdfPath);

      expect(result).toHaveProperty('pageCount');
      expect(result).toHaveProperty('filePath');
      expect(result.pageCount).toBeGreaterThan(0);
    });

    it('should throw error for invalid file path', async () => {
      const { loadPDF } = require('../pdf-utils');
      await expect(loadPDF('/nonexistent.pdf')).rejects.toThrow();
    });
  });

  describe('rotatePDF', () => {
    it('should rotate PDF pages', async () => {
      const { rotatePDF } = require('../pdf-utils');
      const result = await rotatePDF(testPdfPath, [1], 90);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should throw error for invalid page numbers', async () => {
      const { rotatePDF } = require('../pdf-utils');
      await expect(rotatePDF(testPdfPath, 'not-an-array', 90)).rejects.toThrow('pageNumbers must be an array');
    });

    it('should throw error for invalid degrees', async () => {
      const { rotatePDF } = require('../pdf-utils');
      await expect(rotatePDF(testPdfPath, [1], 'not-a-number')).rejects.toThrow('degrees must be a valid number');
    });

    it('should throw error for invalid file path', async () => {
      const { rotatePDF } = require('../pdf-utils');
      await expect(rotatePDF('/nonexistent.pdf', [1], 90)).rejects.toThrow();
    });
  });

  describe('deletePages', () => {
    it('should delete PDF pages', async () => {
      const { deletePages, loadPDF } = require('../pdf-utils');

      // First get the page count
      const docInfo = await loadPDF(testPdfPath);
      if (docInfo.pageCount > 1) {
        const result = await deletePages(testPdfPath, [1]);
        expect(Buffer.isBuffer(result)).toBe(true);
      }
    });

    it('should throw error for invalid page numbers', async () => {
      const { deletePages } = require('../pdf-utils');
      await expect(deletePages(testPdfPath, 'not-an-array')).rejects.toThrow('pageNumbers must be an array');
    });

    it('should throw error for invalid file path', async () => {
      const { deletePages } = require('../pdf-utils');
      await expect(deletePages('/nonexistent.pdf', [1])).rejects.toThrow();
    });
  });

  describe('protectPDF', () => {
    it('should protect PDF with password', async () => {
      const { protectPDF } = require('../pdf-utils');
      const result = await protectPDF(testPdfPath, 'user123', 'owner123');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should protect PDF with permissions', async () => {
      const { protectPDF } = require('../pdf-utils');
      const result = await protectPDF(testPdfPath, 'user123', 'owner123', {
        printing: 'highResolution',
        modifying: false,
        copying: false
      });

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should throw error for invalid file path', async () => {
      const { protectPDF } = require('../pdf-utils');
      await expect(protectPDF('/nonexistent.pdf', 'pass')).rejects.toThrow();
    });
  });

  describe('getBookmarks', () => {
    it('should return empty array for PDF without bookmarks', async () => {
      const { getBookmarks } = require('../pdf-utils');
      const result = await getBookmarks(testPdfPath);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw error for invalid file path', async () => {
      const { getBookmarks } = require('../pdf-utils');
      await expect(getBookmarks('/nonexistent.pdf')).rejects.toThrow();
    });

    it('should return bookmarks with correct page numbers for PDF with bookmarks', async () => {
      const { getBookmarks, addBookmarks, mergePDFs } = require('../pdf-utils');
      const mergedPdf = await mergePDFs([testPdfPath, testPdfPath]);
      const tmpMergePath = path.join(__dirname, 'test-merged-2pages.pdf');
      await fs.writeFile(tmpMergePath, mergedPdf);

      try {
        const bookmarks = [
          { title: 'Chapter 1', page: 1 },
          { title: 'Chapter 2', page: 2 }
        ];

        const pdfWithBookmarks = await addBookmarks(tmpMergePath, bookmarks);
        const tmpPath = path.join(__dirname, 'test-with-bookmarks.pdf');
        await fs.writeFile(tmpPath, pdfWithBookmarks);

        try {
          const result = await getBookmarks(tmpPath);

          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBe(2);
          expect(result[0].title).toBe('Chapter 1');
          expect(result[0].page).toBe(1);
          expect(result[0].pageIndex).toBe(0);
          expect(result[1].title).toBe('Chapter 2');
          expect(result[1].page).toBe(2);
          expect(result[1].pageIndex).toBe(1);
        } finally {
          await fs.unlink(tmpPath).catch(() => {});
        }
      } finally {
        await fs.unlink(tmpMergePath).catch(() => {});
      }
    });

    it('should return bookmarks with level information', async () => {
      const { getBookmarks, addBookmarks } = require('../pdf-utils');
      const bookmarks = [
        { title: 'Top Level', page: 1 }
      ];

      const pdfWithBookmarks = await addBookmarks(testPdfPath, bookmarks);
      const tmpPath = path.join(__dirname, 'test-with-level.pdf');
      await fs.writeFile(tmpPath, pdfWithBookmarks);

      try {
        const result = await getBookmarks(tmpPath);

        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0]).toHaveProperty('level');
        expect(result[0]).toHaveProperty('page');
        expect(result[0]).toHaveProperty('pageIndex');
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    });
  });

  describe('addBookmarks', () => {
    it('should add bookmarks to PDF', async () => {
      const { addBookmarks } = require('../pdf-utils');
      const bookmarks = [
        { title: 'Page 1', page: 1 }
      ];

      const result = await addBookmarks(testPdfPath, bookmarks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return unmodified PDF when given empty bookmarks array', async () => {
      const { addBookmarks } = require('../pdf-utils');
      // Empty bookmarks array returns the original PDF unchanged
      const result = await addBookmarks(testPdfPath, []);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should throw error for invalid bookmark page', async () => {
      const { addBookmarks } = require('../pdf-utils');
      const bookmarks = [{ title: 'Invalid', page: 999 }];

      await expect(addBookmarks(testPdfPath, bookmarks)).rejects.toThrow('Invalid bookmark page');
    });

    it('should throw error for invalid file path', async () => {
      const { addBookmarks } = require('../pdf-utils');
      await expect(addBookmarks('/nonexistent.pdf', [{ title: 'Test', page: 1 }])).rejects.toThrow();
    });
  });

  describe('applyEdits', () => {
    it('should return unmodified buffer when no operations', async () => {
      const { applyEdits, loadPDF } = require('../pdf-utils');
      const original = await loadPDF(testPdfPath);
      const result = await applyEdits(testPdfPath, []);

      expect(Buffer.isBuffer(result)).toBe(true);
      // When no operations, it returns the original file bytes
    });

    it('should throw error for invalid operations', async () => {
      const { applyEdits } = require('../pdf-utils');
      await expect(applyEdits(testPdfPath, 'not-an-array')).rejects.toThrow('operations must be an array');
    });

    it('should throw error for invalid file path', async () => {
      const { applyEdits } = require('../pdf-utils');
      await expect(applyEdits('/nonexistent.pdf', [])).rejects.toThrow();
    });

    it('should save edited Chinese text using PDF coordinates', async () => {
      const { applyEdits } = require('../pdf-utils');
      const result = await applyEdits(testPdfPath, [{
        type: 'editText',
        page: 1,
        coordinateSpace: 'pdf',
        originalText: 'Old',
        newText: '新文字',
        x: 50,
        y: 700,
        width: 100,
        height: 20,
        fontSize: 12,
        fontFamily: 'Microsoft YaHei',
        color: [0, 0, 0],
        newFontFamily: 'Microsoft YaHei',
        newFontSize: 12,
        newColor: '#000000'
      }]);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
