// Test file for IPC integration and PDF loading

describe('PDF Editor Integration Tests', () => {
  let mockPdfAPI;
  let mockPdfjsLib;
  let editor;

  beforeEach(() => {
    // Setup global mocks
    global.document = {
      createElement: jest.fn(() => ({
        getBoundingClientRect: jest.fn(() => ({ left: 0, top: 0, width: 800, height: 600 })),
        getContext: jest.fn(() => ({}))
      })),
      getElementById: jest.fn(() => null),
      body: { appendChild: jest.fn() }
    };

    global.window = {
      pdfAPI: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        applyEdits: jest.fn(),
        saveDialog: jest.fn()
      },
      pdfjsLibInstance: {
        getDocument: jest.fn()
      },
      pdfWorkerSrc: 'pdf.worker.js',
      document: global.document
    };

    global.currentZoom = 100;

    mockPdfAPI = global.window.pdfAPI;
    mockPdfjsLib = global.window.pdfjsLibInstance;
    const PDFEditor = require('../pdf-editor');
    editor = new PDFEditor();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('init function', () => {
    it('should initialize PDF editor with valid path', async () => {
      const mockFileData = new Uint8Array([1, 2, 3, 4, 5]);
      const mockPdfDoc = {
        numPages: 3,
        getPage: jest.fn()
      };

      mockPdfAPI.readFile.mockResolvedValue(mockFileData);
      mockPdfjsLib.getDocument.mockReturnValue({
        promise: Promise.resolve(mockPdfDoc)
      });

      editor.checkIfScanned = jest.fn();

      const canvas = { getBoundingClientRect: jest.fn() };
      const result = await editor.init(canvas, '/test.pdf');

      expect(result).toEqual({ totalPages: 3 });
      expect(editor.pdfDoc).toEqual(mockPdfDoc);
      expect(editor.pdfPath).toBe('/test.pdf');
    });

    it('should throw error when PDF.js is not loaded', async () => {
      const canvas = { getBoundingClientRect: jest.fn() };
      const original = global.window.pdfjsLibInstance;
      global.window.pdfjsLibInstance = null;
      
      await expect(editor.init(canvas, '/test.pdf')).rejects.toThrow();
      
      global.window.pdfjsLibInstance = original;
    });

    it('should throw error when file read fails', async () => {
      mockPdfAPI.readFile.mockRejectedValue(new Error('File not found'));
      const canvas = { getBoundingClientRect: jest.fn() };

      await expect(editor.init(canvas, '/invalid.pdf')).rejects.toThrow();
    });
  });

  describe('checkIfScanned', () => {
    it('should detect non-scanned PDF with text', async () => {
      editor.textItems = [{ text: 'Test' }];
      editor.extractTextContent = jest.fn().mockResolvedValue({
        status: 'text',
        items: [{ text: 'Test' }]
      });
      
      await editor.checkIfScanned();
      expect(editor.isScanned).toBe(false);
    });

    it('should handle errors during scanned check', async () => {
      editor.extractTextContent = jest.fn().mockRejectedValue(new Error('OCR failed'));
      
      await editor.checkIfScanned();
      expect(editor.isScanned).toBe(false);
    });
  });

  describe('getTextStatus', () => {
    it('should return status from this.textStatus', () => {
      editor.textStatus = 'editable';
      editor.textItems = [];
      const status = editor.getTextStatus();
      expect(status.status).toBe('editable');
    });

    it('should return unknown status when no textStatus set', () => {
      editor.textStatus = null;
      const status = editor.getTextStatus();
      expect(status.status).toBe('unknown');
    });

    it('should return item count from textItems', () => {
      editor.textItems = [{ id: 'text_1' }, { id: 'text_2' }];
      const status = editor.getTextStatus();
      expect(status.itemCount).toBe(2);
    });
  });

  describe('getDisplayScale', () => {
    it('should return scale from currentZoom', () => {
      global.currentZoom = 200;
      expect(editor.getDisplayScale()).toBe(2.0);
    });

    it('should return this.scale as fallback', () => {
      global.currentZoom = undefined;
      editor.scale = 1.5;
      expect(editor.getDisplayScale()).toBe(1.5);
    });

    it('should return 1 as default', () => {
      global.currentZoom = undefined;
      editor.scale = undefined;
      expect(editor.getDisplayScale()).toBe(1);
    });
  });

  describe('getPageHeightInPdfUnits', () => {
    it('should calculate page height correctly', () => {
      global.currentZoom = 100;
      editor.pageHeight = 800;
      const height = editor.getPageHeightInPdfUnits();
      expect(height).toBe(800);
    });
  });

  describe('hideTextEditBox', () => {
    it('should reset text edit state', () => {
      editor.isEditingText = true;
      editor.selectedTextItem = { text: 'Test' };
      editor.textEditBox = null;

      editor.hideTextEditBox();
      expect(editor.isEditingText).toBe(false);
      expect(editor.selectedTextItem).toBeNull();
    });
  });

  describe('cancelTextEdit', () => {
    it('should cancel text edit', () => {
      editor.isEditingText = true;
      editor.hideTextEditBox = jest.fn();
      editor.cancelTextEdit();
      expect(editor.hideTextEditBox).toHaveBeenCalled();
    });
  });

  describe('setPageChangeHandler', () => {
    it('should set page change handler', () => {
      const handler = jest.fn();
      editor.setPageChangeHandler(handler);
      expect(editor.pageChangeHandler).toBe(handler);
    });
  });

  describe('setOptions', () => {
    it('should update options object', () => {
      editor.setOptions({
        fontFamily: 'Arial',
        fontSize: 18
      });
      
      expect(editor.options.fontFamily).toBe('Arial');
      expect(editor.options.fontSize).toBe(18);
    });
  });
});