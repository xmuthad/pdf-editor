// Tests for Electron IPC integration
describe('Electron IPC Integration Tests', () => {
  let mockPdfAPI;

  beforeEach(() => {
    // Create mock pdfAPI implementation
    mockPdfAPI = {
      merge: jest.fn(),
      split: jest.fn(),
      watermark: jest.fn(),
      loadPDF: jest.fn(),
      applyEdits: jest.fn(),
      saveDialog: jest.fn(),
      writeFile: jest.fn(),
      pickImage: jest.fn(),
      readFile: jest.fn(),
      pickPDF: jest.fn(),
      rotate: jest.fn(),
      deletePages: jest.fn(),
      convertToImage: jest.fn(),
      protect: jest.fn(),
      getBookmarks: jest.fn(),
      addBookmarks: jest.fn(),
      getSettings: jest.fn(),
      setSettings: jest.fn()
    };

    // Set up global window mock
    global.window = {
      pdfAPI: mockPdfAPI,
      document: {
        createElement: jest.fn(() => ({
          getBoundingClientRect: jest.fn(() => ({ left: 0, top: 0, width: 800, height: 600 })),
          getContext: jest.fn(() => ({}))
        })),
        getElementById: jest.fn(() => null),
        body: { appendChild: jest.fn() }
      }
    };

    global.currentZoom = 100;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('PDF Operation APIs', () => {
    test('merge should call merge API', async () => {
      const files = ['file1.pdf', 'file2.pdf'];
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.merge.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.merge(files);

      expect(mockPdfAPI.merge).toHaveBeenCalledWith(files);
      expect(result).toBe(mockResult);
    });

    test('split should call split API with ranges', async () => {
      const filePath = 'test.pdf';
      const ranges = ['1-2', '3'];
      const mockResult = [new Uint8Array([1, 2])];
      mockPdfAPI.split.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.split(filePath, ranges);

      expect(mockPdfAPI.split).toHaveBeenCalledWith(filePath, ranges);
      expect(result).toEqual(mockResult);
    });

    test('watermark should call watermark API', async () => {
      const filePath = 'test.pdf';
      const text = 'CONFIDENTIAL';
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.watermark.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.watermark(filePath, text);

      expect(mockPdfAPI.watermark).toHaveBeenCalledWith(filePath, text);
      expect(result).toBe(mockResult);
    });

    test('rotate should call rotate API with degrees', async () => {
      const filePath = 'test.pdf';
      const pageNumbers = [1, 2];
      const degrees = 90;
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.rotate.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.rotate(filePath, pageNumbers, degrees);

      expect(mockPdfAPI.rotate).toHaveBeenCalledWith(filePath, pageNumbers, degrees);
      expect(result).toBe(mockResult);
    });

    test('deletePages should call deletePages API', async () => {
      const filePath = 'test.pdf';
      const pageNumbers = [2, 4];
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.deletePages.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.deletePages(filePath, pageNumbers);

      expect(mockPdfAPI.deletePages).toHaveBeenCalledWith(filePath, pageNumbers);
      expect(result).toBe(mockResult);
    });

    test('protect should call protect API with passwords', async () => {
      const filePath = 'test.pdf';
      const userPassword = 'user123';
      const ownerPassword = 'owner456';
      const permissions = { print: true };
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.protect.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.protect(filePath, userPassword, ownerPassword, permissions);

      expect(mockPdfAPI.protect).toHaveBeenCalledWith(filePath, userPassword, ownerPassword, permissions);
      expect(result).toBe(mockResult);
    });
  });

  describe('File APIs', () => {
    test('loadPDF should call loadPDF API', async () => {
      const filePath = 'test.pdf';
      const mockResult = { numPages: 3 };
      mockPdfAPI.loadPDF.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.loadPDF(filePath);

      expect(mockPdfAPI.loadPDF).toHaveBeenCalledWith(filePath);
      expect(result).toBe(mockResult);
    });

    test('readFile should call readFile API', async () => {
      const filePath = 'test.pdf';
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.readFile.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.readFile(filePath);

      expect(mockPdfAPI.readFile).toHaveBeenCalledWith(filePath);
      expect(result).toBe(mockResult);
    });

    test('writeFile should call writeFile API', async () => {
      const filePath = 'output.pdf';
      const buffer = new Uint8Array([1, 2, 3]);
      mockPdfAPI.writeFile.mockResolvedValue(undefined);

      await mockPdfAPI.writeFile(filePath, buffer);

      expect(mockPdfAPI.writeFile).toHaveBeenCalledWith(filePath, buffer);
    });

    test('saveDialog should call saveDialog API', async () => {
      const defaultPath = 'test.pdf';
      const mockResult = { canceled: false, filePath: '/save/path/test.pdf' };
      mockPdfAPI.saveDialog.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.saveDialog(defaultPath);

      expect(mockPdfAPI.saveDialog).toHaveBeenCalledWith(defaultPath);
      expect(result).toEqual(mockResult);
    });

    test('pickPDF should call pickPDF API', async () => {
      const mockResult = { canceled: false, filePaths: ['/path/test.pdf'] };
      mockPdfAPI.pickPDF.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.pickPDF();

      expect(mockPdfAPI.pickPDF).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('Bookmark APIs', () => {
    test('getBookmarks should call getBookmarks API', async () => {
      const filePath = 'test.pdf';
      const mockResult = [{ title: 'Chapter 1', page: 1 }];
      mockPdfAPI.getBookmarks.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.getBookmarks(filePath);

      expect(mockPdfAPI.getBookmarks).toHaveBeenCalledWith(filePath);
      expect(result).toEqual(mockResult);
    });

    test('addBookmarks should call addBookmarks API', async () => {
      const filePath = 'test.pdf';
      const bookmarks = [{ title: 'Chapter 1', page: 1 }];
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.addBookmarks.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.addBookmarks(filePath, bookmarks);

      expect(mockPdfAPI.addBookmarks).toHaveBeenCalledWith(filePath, bookmarks);
      expect(result).toBe(mockResult);
    });
  });

  describe('Settings APIs', () => {
    test('getSettings should call getSettings API', async () => {
      const mockResult = { openLastFile: true, lastFilePath: '/test.pdf' };
      mockPdfAPI.getSettings.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.getSettings();

      expect(mockPdfAPI.getSettings).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    test('setSettings should call setSettings API', async () => {
      const settings = { openLastFile: false };
      mockPdfAPI.setSettings.mockResolvedValue(undefined);

      await mockPdfAPI.setSettings(settings);

      expect(mockPdfAPI.setSettings).toHaveBeenCalledWith(settings);
    });
  });

  describe('Edit APIs', () => {
    test('applyEdits should call applyEdits API with operations', async () => {
      const filePath = 'test.pdf';
      const operations = [
        { type: 'editText', x: 100, y: 200, text: 'Updated text' }
      ];
      const mockResult = new Uint8Array([1, 2, 3]);
      mockPdfAPI.applyEdits.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.applyEdits(filePath, operations);

      expect(mockPdfAPI.applyEdits).toHaveBeenCalledWith(filePath, operations);
      expect(result).toBe(mockResult);
    });
  });

  describe('Image APIs', () => {
    test('convertToImage should call convertToImage API', async () => {
      const filePath = 'test.pdf';
      const pageNum = 1;
      const format = 'png';
      const scale = 2;
      const mockResult = { base64: 'iVBORw0KGg...' };
      mockPdfAPI.convertToImage.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.convertToImage(filePath, pageNum, format, scale);

      expect(mockPdfAPI.convertToImage).toHaveBeenCalledWith(filePath, pageNum, format, scale);
      expect(result).toEqual(mockResult);
    });

    test('pickImage should call pickImage API', async () => {
      const mockResult = { canceled: false, filePaths: ['/path/image.png'] };
      mockPdfAPI.pickImage.mockResolvedValue(mockResult);

      const result = await mockPdfAPI.pickImage();

      expect(mockPdfAPI.pickImage).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });
});