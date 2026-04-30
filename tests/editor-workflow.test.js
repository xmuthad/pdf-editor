// Full PDF editor workflow integration tests
describe('PDF Editor Complete Workflow Tests', () => {
  let mockPdfAPI;
  let mockPdfjsLib;

  beforeEach(() => {
    // Mock missing global functions
    global.updateTextDebugPanel = jest.fn();

    // Create mock pdfjsLib
    mockPdfjsLib = {
      getDocument: jest.fn(),
      version: '3.0'
    };

    // Create mock pdfAPI
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
      pdfjsLibInstance: mockPdfjsLib,
      pdfWorkerSrc: 'pdf.worker.js',
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

  test('Complete editing workflow: Load → Edit → Save', async () => {
    // 1. Mock file picker
    const mockFilePath = '/test/document.pdf';
    mockPdfAPI.pickPDF.mockResolvedValue({
      canceled: false,
      filePaths: [mockFilePath]
    });

    // 2. Mock file reading
    const mockFileData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    mockPdfAPI.readFile.mockResolvedValue(mockFileData);

    // 3. Mock PDF document loading
    const mockPdfDoc = {
      numPages: 2,
      getPage: jest.fn().mockReturnValue({
        getViewport: jest.fn().mockReturnValue({ width: 600, height: 800 }),
        render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        getTextContent: jest.fn().mockResolvedValue({
          items: [
            { str: 'Test Text', transform: [1, 0, 0, 1, 100, 700], width: 100, height: 20 }
          ]
        })
      })
    };
    mockPdfjsLib.getDocument.mockReturnValue({ promise: Promise.resolve(mockPdfDoc) });

    // 4. Mock bookmark API
    const mockBookmarks = [{ title: 'Introduction', page: 1 }];
    mockPdfAPI.getBookmarks.mockResolvedValue(mockBookmarks);

    // 5. Mock apply edits
    const editedPdfData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 54]);
    mockPdfAPI.applyEdits.mockResolvedValue(editedPdfData);

    // 6. Mock save dialog
    mockPdfAPI.saveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/output/edited.pdf'
    });
    mockPdfAPI.writeFile.mockResolvedValue(undefined);

    // Initialize PDFEditor
    const PDFEditor = require('../pdf-editor');
    const editor = new PDFEditor();

    // Mock functions
    editor.checkIfScanned = jest.fn();
    editor.showTextEditBox = jest.fn();
    editor.hideTextEditBox = jest.fn();

    // Simulate loading PDF
    const canvas = {
      getBoundingClientRect: jest.fn(() => ({ left: 0, top: 0, width: 800, height: 600 }))
    };
    const result = await editor.init(canvas, mockFilePath);

    // Verify load was successful
    expect(result).toEqual({ totalPages: 2 });
    expect(mockPdfAPI.readFile).toHaveBeenCalledWith(mockFilePath);

    // Simulate selecting text
    editor.textItems = [
      {
        id: 'text_1_0',
        text: 'Test Text',
        x: 100,
        y: 700,
        width: 100,
        height: 20,
        page: 1,
        fontSize: 12,
        fontName: 'Helvetica',
        color: [0, 0, 0]
      }
    ];

    // Simulate selecting text
    editor.selectTextItem(editor.textItems[0]);
    expect(editor.selectedTextItem).toBe(editor.textItems[0]);

    // Simulate editing text
    editor.textEditBox = { value: 'Edited Text' };
    editor.handleTextEditComplete = jest.fn(() => {
      editor.addOperation({
        type: 'editText',
        coordinateSpace: 'pdf',
        x: 100,
        y: 700,
        width: 100,
        height: 20,
        page: 1,
        fontSize: 12,
        fontName: 'Helvetica',
        color: [0, 0, 0],
        oldText: 'Test Text',
        newText: 'Edited Text'
      });
    });
    editor.hideTextEditBox = jest.fn();
    editor.handleTextEditComplete();

    // Verify operation was added
    expect(editor.operations.length).toBe(1);
    expect(editor.operations[0].type).toBe('editText');
    expect(editor.operations[0].newText).toBe('Edited Text');

    // Simulate saving
    const operations = editor.getOperations();
    expect(operations.length).toBe(1);

    // Simulate applying edits and saving
    await mockPdfAPI.applyEdits(mockFilePath, operations);
    await mockPdfAPI.saveDialog('document_edited.pdf');
    await mockPdfAPI.writeFile('/output/edited.pdf', editedPdfData);

    // Verify full workflow
    expect(mockPdfAPI.applyEdits).toHaveBeenCalledWith(mockFilePath, operations);
    expect(mockPdfAPI.saveDialog).toHaveBeenCalledWith('document_edited.pdf');
    expect(mockPdfAPI.writeFile).toHaveBeenCalledWith('/output/edited.pdf', editedPdfData);
  });

  test('Undo/Redo workflow in editor', () => {
    // Initialize PDFEditor
    const PDFEditor = require('../pdf-editor');
    const editor = new PDFEditor();

    // Add operations
    editor.addOperation({ type: 'editText', text: 'First edit' });
    editor.addOperation({ type: 'editText', text: 'Second edit' });

    expect(editor.operations.length).toBe(2);
    expect(editor.undoStack.length).toBe(2);

    // Undo operations
    editor.undo();
    expect(editor.operations.length).toBe(1);
    expect(editor.undoStack.length).toBe(1);

    editor.undo();
    expect(editor.operations.length).toBe(0);
    expect(editor.undoStack.length).toBe(0);

    // Redo operations
    editor.redo();
    expect(editor.operations.length).toBe(1);
    expect(editor.undoStack.length).toBe(1);

    editor.redo();
    expect(editor.operations.length).toBe(2);
    expect(editor.undoStack.length).toBe(2);
  });

  test('Batch operations workflow', () => {
    // Initialize PDFEditor
    const PDFEditor = require('../pdf-editor');
    const editor = new PDFEditor();

    // Start batch operations
    editor.beginBatch();
    expect(editor.isBatching).toBe(true);
    expect(editor.batchOperations.length).toBe(0);

    // Add batch operations
    editor.addBatchOperation({ type: 'editText', text: 'Batch edit 1' });
    editor.addBatchOperation({ type: 'editText', text: 'Batch edit 2' });
    editor.addBatchOperation({ type: 'editText', text: 'Batch edit 3' });

    expect(editor.batchOperations.length).toBe(3);

    // End batch operations
    editor.endBatch();
    expect(editor.isBatching).toBe(false);
    expect(editor.operations.length).toBe(3);
    expect(editor.batchOperations).toBeNull();
  });

  test('Settings workflow', async () => {
    // Mock settings API
    const initialSettings = {
      openLastFile: false,
      lastFilePath: ''
    };
    const updatedSettings = {
      openLastFile: true,
      lastFilePath: '/test/document.pdf'
    };

    mockPdfAPI.getSettings.mockResolvedValue(initialSettings);
    mockPdfAPI.setSettings.mockResolvedValue(undefined);

    // Get initial settings
    const settings = await mockPdfAPI.getSettings();
    expect(settings).toEqual(initialSettings);

    // Update settings
    await mockPdfAPI.setSettings(updatedSettings);
    expect(mockPdfAPI.setSettings).toHaveBeenCalledWith(updatedSettings);
  });

  test('Tool switching workflow', () => {
    // Initialize PDFEditor
    const PDFEditor = require('../pdf-editor');
    const editor = new PDFEditor();

    // Mock hideTextEditBox
    editor.hideTextEditBox = jest.fn();

    // Switch through different tools
    editor.setTool('select');
    expect(editor.currentTool).toBe('select');

    editor.setTool('text');
    expect(editor.currentTool).toBe('text');

    editor.setTool('eraser');
    expect(editor.currentTool).toBe('eraser');

    editor.setTool('highlight');
    expect(editor.currentTool).toBe('highlight');

    editor.setTool('underline');
    expect(editor.currentTool).toBe('underline');
  });

  test('Bookmark workflow', async () => {
    const filePath = '/test/document.pdf';
    const bookmarks = [
      { title: 'Introduction', page: 1 },
      { title: 'Chapter 1', page: 3 }
    ];

    // Mock API responses
    mockPdfAPI.getBookmarks.mockResolvedValue(bookmarks);
    const newBookmarks = [...bookmarks, { title: 'Conclusion', page: 5 }];
    const mockEditedPdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    mockPdfAPI.addBookmarks.mockResolvedValue(mockEditedPdf);

    // Get existing bookmarks
    const existingBookmarks = await mockPdfAPI.getBookmarks(filePath);
    expect(existingBookmarks).toEqual(bookmarks);

    // Add new bookmark
    const result = await mockPdfAPI.addBookmarks(filePath, newBookmarks);
    expect(result).toEqual(mockEditedPdf);
    expect(mockPdfAPI.addBookmarks).toHaveBeenCalledWith(filePath, newBookmarks);
  });

  test('PDF manipulation workflow (merge, split, watermark)', async () => {
    const files = ['file1.pdf', 'file2.pdf'];
    const mergedData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    mockPdfAPI.merge.mockResolvedValue(mergedData);

    // Merge PDF
    const merged = await mockPdfAPI.merge(files);
    expect(merged).toEqual(mergedData);
    expect(mockPdfAPI.merge).toHaveBeenCalledWith(files);

    // Split PDF
    const splitRanges = ['1-2', '3'];
    const splitResults = [
      new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
      new Uint8Array([37, 80, 68, 70, 45, 49, 46, 53])
    ];
    mockPdfAPI.split.mockResolvedValue(splitResults);

    const split = await mockPdfAPI.split('merged.pdf', splitRanges);
    expect(split).toEqual(splitResults);
    expect(mockPdfAPI.split).toHaveBeenCalledWith('merged.pdf', splitRanges);

    // Add watermark
    const watermarkText = 'CONFIDENTIAL';
    const watermarkedData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    mockPdfAPI.watermark.mockResolvedValue(watermarkedData);

    const watermarked = await mockPdfAPI.watermark('document.pdf', watermarkText);
    expect(watermarked).toEqual(watermarkedData);
    expect(mockPdfAPI.watermark).toHaveBeenCalledWith('document.pdf', watermarkText);
  });

  test('Page manipulation workflow (rotate, delete)', async () => {
    // Rotate page
    const rotatePageNumbers = [1, 2];
    const degrees = 90;
    const rotatedData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    mockPdfAPI.rotate.mockResolvedValue(rotatedData);

    const rotated = await mockPdfAPI.rotate('document.pdf', rotatePageNumbers, degrees);
    expect(rotated).toEqual(rotatedData);
    expect(mockPdfAPI.rotate).toHaveBeenCalledWith('document.pdf', rotatePageNumbers, degrees);

    // Delete page
    const deletePageNumbers = [3, 4];
    const deletedData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    mockPdfAPI.deletePages.mockResolvedValue(deletedData);

    const deleted = await mockPdfAPI.deletePages('document.pdf', deletePageNumbers);
    expect(deleted).toEqual(deletedData);
    expect(mockPdfAPI.deletePages).toHaveBeenCalledWith('document.pdf', deletePageNumbers);
  });
});