global.window = { PDFEditor: null, document: { getElementById: () => null } };
global.currentZoom = 100;
global.document = { getElementById: () => null };
global.updateTextDebugPanel = jest.fn();

const PDFEditor = require('../pdf-editor');

describe('PDFEditor', () => {
  let editor;

  beforeEach(() => {
    editor = new PDFEditor();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(editor.currentTool).toBeNull();
      expect(editor.currentPage).toBe(1);
      expect(editor.scale).toBe(1.0);
      expect(editor.pdfPath).toBeNull();
      expect(editor.operations).toEqual([]);
      expect(editor.undoStack).toEqual([]);
      expect(editor.redoStack).toEqual([]);
    });

    it('should have default options', () => {
      expect(editor.options).toEqual({
        fontFamily: 'Arial',
        fontSize: 16,
        textColor: '#000000',
        eraserSize: 20,
        highlightColor: '#ffff00',
        underlineColor: '#ff0000',
        currentImage: null
      });
    });

    it('should initialize text editing state', () => {
      expect(editor.textItems).toEqual([]);
      expect(editor.selectedTextItem).toBeNull();
      expect(editor.textEditBox).toBeNull();
      expect(editor.isEditingText).toBe(false);
    });
  });

  describe('setOptions', () => {
    it('should update options', () => {
      editor.setOptions({ fontSize: 24, textColor: '#ff0000' });
      expect(editor.options.fontSize).toBe(24);
      expect(editor.options.textColor).toBe('#ff0000');
    });

    it('should preserve other options', () => {
      editor.setOptions({ fontSize: 24 });
      expect(editor.options.fontFamily).toBe('Arial');
      expect(editor.options.fontSize).toBe(24);
    });
  });

  describe('setTool', () => {
    it('should set current tool', () => {
      editor.setTool('text');
      expect(editor.currentTool).toBe('text');
    });

    it('should set isEditingText to false when switching away from text tool', () => {
      editor.currentTool = 'text';
      editor.isEditingText = true;
      editor.setTool('select');
      expect(editor.isEditingText).toBe(false);
    });
  });

  describe('rgbToHex', () => {
    it('should convert RGB array to hex', () => {
      const hex = editor.rgbToHex([1, 0, 0]);
      expect(hex).toBe('#ff0000');
    });

    it('should handle already hex strings', () => {
      const hex = editor.rgbToHex('#ff0000');
      expect(hex).toBe('#ff0000');
    });

    it('should convert white', () => {
      const hex = editor.rgbToHex([1, 1, 1]);
      expect(hex).toBe('#ffffff');
    });

    it('should convert black', () => {
      const hex = editor.rgbToHex([0, 0, 0]);
      expect(hex).toBe('#000000');
    });

    it('should handle gray', () => {
      const hex = editor.rgbToHex([0.5, 0.5, 0.5]);
      expect(hex).toBe('#808080');
    });
  });

  describe('hexToRgbArray', () => {
    it('should convert hex to RGB array', () => {
      const rgb = editor.hexToRgbArray('#ff0000');
      expect(rgb[0]).toBeCloseTo(1, 2);
      expect(rgb[1]).toBeCloseTo(0, 2);
      expect(rgb[2]).toBeCloseTo(0, 2);
    });

    it('should handle already arrays', () => {
      const input = [1, 0, 0];
      const result = editor.hexToRgbArray(input);
      expect(result).toBe(input);
    });

    it('should convert white', () => {
      const rgb = editor.hexToRgbArray('#ffffff');
      expect(rgb[0]).toBeCloseTo(1, 2);
      expect(rgb[1]).toBeCloseTo(1, 2);
      expect(rgb[2]).toBeCloseTo(1, 2);
    });

    it('should convert black', () => {
      const rgb = editor.hexToRgbArray('#000000');
      expect(rgb[0]).toBeCloseTo(0, 2);
      expect(rgb[1]).toBeCloseTo(0, 2);
      expect(rgb[2]).toBeCloseTo(0, 2);
    });

    it('should return black for invalid hex', () => {
      const rgb = editor.hexToRgbArray('invalid');
      expect(rgb).toEqual([0, 0, 0]);
    });
  });

  describe('detectFontFamily', () => {
    it('should detect SimSun', () => {
      expect(editor.detectFontFamily('SimSun')).toBe('SimSun');
    });

    it('should detect SimHei', () => {
      expect(editor.detectFontFamily('SimHei')).toBe('SimHei');
    });

    it('should detect Arial', () => {
      expect(editor.detectFontFamily('Arial')).toBe('Arial');
    });

    it('should detect Times New Roman', () => {
      expect(editor.detectFontFamily('Times New Roman')).toBe('Times New Roman');
    });

    it('should detect Courier', () => {
      expect(editor.detectFontFamily('Courier New')).toBe('Courier New');
    });

    it('should return default for unknown fonts', () => {
      expect(editor.detectFontFamily('UnknownFont')).toBe('UnknownFont');
    });

    it('should return default for null font', () => {
      expect(editor.detectFontFamily(null)).toBe('Arial');
    });

    it('should handle Microsoft YaHei', () => {
      expect(editor.detectFontFamily('Microsoft YaHei')).toBe('Microsoft YaHei');
    });
  });

  describe('addOperation', () => {
    it('should add operation to operations array', () => {
      const operation = { type: 'text', page: 1, x: 10, y: 20 };
      editor.addOperation(operation);
      expect(editor.operations).toContain(operation);
    });

    it('should add operation to undo stack', () => {
      const operation = { type: 'text', page: 1, x: 10, y: 20 };
      editor.addOperation(operation);
      expect(editor.undoStack.length).toBe(1);
      expect(editor.undoStack[0]).toContain(operation);
    });

    it('should clear redo stack', () => {
      editor.redoStack = [[{ type: 'text' }]];
      editor.addOperation({ type: 'text' });
      expect(editor.redoStack).toEqual([]);
    });

    it('should call onChangeCallback', () => {
      const callback = jest.fn();
      editor.setOnChange(callback);
      editor.addOperation({ type: 'text' });
      expect(callback).toHaveBeenCalledWith({
        canUndo: true,
        canRedo: false
      });
    });
  });

  describe('undo', () => {
    it('should not undo if undoStack is empty', () => {
      editor.undoStack = [];
      editor.undo();
      expect(editor.undoStack).toEqual([]);
    });

    it('should move operation from undoStack to redoStack', () => {
      const operation = { type: 'text', page: 1 };
      editor.undoStack.push([operation]);
      editor.undo();
      expect(editor.redoStack.length).toBe(1);
    });

    it('should remove operation from operations', () => {
      const operation = { type: 'text', page: 1 };
      editor.operations.push(operation);
      editor.undoStack.push([operation]);
      editor.undo();
      expect(editor.operations).not.toContain(operation);
    });
  });

  describe('redo', () => {
    it('should not redo if redoStack is empty', () => {
      editor.redoStack = [];
      editor.redo();
      expect(editor.redoStack).toEqual([]);
    });

    it('should move operation from redoStack to undoStack', () => {
      const operation = { type: 'text', page: 1 };
      editor.redoStack.push([operation]);
      editor.redo();
      expect(editor.undoStack.length).toBe(1);
    });

    it('should add operation back to operations', () => {
      const operation = { type: 'text', page: 1 };
      editor.redoStack.push([operation]);
      editor.redo();
      expect(editor.operations).toContain(operation);
    });
  });

  describe('clearAll', () => {
    it('should save current operations to undoStack', () => {
      editor.operations = [{ type: 'text' }];
      editor.clearAll();
      expect(editor.undoStack.length).toBe(1);
    });

    it('should clear operations array', () => {
      editor.operations = [{ type: 'text' }];
      editor.clearAll();
      expect(editor.operations).toEqual([]);
    });
  });

  describe('getTextItemsAtPosition', () => {
    beforeEach(() => {
      global.currentZoom = 100;
      editor.pageHeight = 800;
      editor.textItems = [
        { id: 'text_1_0', text: 'Hello', x: 50, y: 700, width: 100, height: 20, page: 1 },
        { id: 'text_1_1', text: 'World', x: 150, y: 700, width: 100, height: 20, page: 1 },
        { id: 'text_2_0', text: 'Page 2', x: 50, y: 700, width: 100, height: 20, page: 2 }
      ];
    });

    it('should return items at given position on page 1', () => {
      const items = editor.getTextItemsAtPosition(75, 80, 1);
      expect(items.length).toBeGreaterThan(0);
    });

    it('should hit text accurately when the page is zoomed', () => {
      global.currentZoom = 150;
      editor.scale = 1.5;
      editor.pageHeight = 1200;

      const items = editor.getTextItemsAtPosition(112.5, 120, 1);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].text).toBe('Hello');
    });

    it('should not return items from different page', () => {
      const items = editor.getTextItemsAtPosition(75, 80, 3);
      expect(items.length).toBe(0);
    });

    it('should return empty array when no items at position', () => {
      const items = editor.getTextItemsAtPosition(500, 500, 1);
      expect(items.length).toBe(0);
    });
  });

  describe('groupTextItemsIntoParagraphs', () => {
    it('should return empty array for empty input', () => {
      const result = editor.groupTextItemsIntoParagraphs([]);
      expect(result).toEqual([]);
    });

    it('should group items on same line', () => {
      const items = [
        { text: 'Hello', x: 50, y: 700, width: 100, height: 20, page: 1 },
        { text: 'World', x: 150, y: 700, width: 100, height: 20, page: 1 }
      ];
      const result = editor.groupTextItemsIntoParagraphs(items);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should separate items on different lines', () => {
      const items = [
        { text: 'Hello', x: 50, y: 700, width: 100, height: 20, page: 1 },
        { text: 'World', x: 50, y: 680, width: 100, height: 20, page: 1 }
      ];
      const result = editor.groupTextItemsIntoParagraphs(items);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('updateSelectedTextStyle', () => {
    it('should return false if no selected item', () => {
      editor.selectedTextItem = null;
      const result = editor.updateSelectedTextStyle({ fontSize: 24 });
      expect(result).toBe(false);
    });

    it('should return true when item is selected and style is applied', () => {
      editor.selectedTextItem = {
        text: 'Test',
        fontFamily: 'Arial',
        fontSize: 12,
        color: [0, 0, 0]
      };
      const result = editor.updateSelectedTextStyle({ fontSize: 24 });
      expect(result).toBe(true);
    });
  });

  describe('hideTextEditBox', () => {
    it('should set isEditingText to false', () => {
      editor.isEditingText = true;
      editor.hideTextEditBox();
      expect(editor.isEditingText).toBe(false);
    });

    it('should set selectedTextItem to null', () => {
      editor.selectedTextItem = { text: 'Test' };
      editor.hideTextEditBox();
      expect(editor.selectedTextItem).toBeNull();
    });
  });

  describe('cancelTextEdit', () => {
    it('should hide text edit box and clear selection', () => {
      editor.isEditingText = true;
      editor.selectedTextItem = { text: 'Test' };
      editor.cancelTextEdit();
      expect(editor.isEditingText).toBe(false);
    });
  });

  describe('setOnChange', () => {
    it('should set the callback', () => {
      const callback = jest.fn();
      editor.setOnChange(callback);
      expect(editor.onChangeCallback).toBe(callback);
    });
  });

  describe('setPageChangeHandler', () => {
    it('should set the page change handler', () => {
      const handler = jest.fn();
      editor.setPageChangeHandler(handler);
      expect(editor.pageChangeHandler).toBe(handler);
    });
  });

  describe('createTextEditBox', () => {
    it('should stop event propagation for textarea interaction events', () => {
      const listeners = {};
      const editBoxMock = {
        id: '',
        className: '',
        placeholder: '',
        addEventListener: (event, handler) => {
          listeners[event] = handler;
        }
      };

      const bodyAppendSpy = jest.fn();
      const originalDocument = global.document;
      global.document = {
        createElement: jest.fn(() => editBoxMock),
        body: { appendChild: bodyAppendSpy },
        getElementById: jest.fn(() => null)
      };

      editor.createTextEditBox();

      const mouseEvent = { stopPropagation: jest.fn() };
      listeners.mousedown(mouseEvent);
      expect(mouseEvent.stopPropagation).toHaveBeenCalledTimes(1);

      const keyEvent = { key: 'a', stopPropagation: jest.fn() };
      listeners.keydown(keyEvent);
      expect(keyEvent.stopPropagation).toHaveBeenCalledTimes(1);

      global.document = originalDocument;
    });
  });

  describe('handleTextEditComplete', () => {
    it('marks edited PDF text as PDF-coordinate operations', () => {
      const editBoxMock = {
        value: 'New text',
        dataset: {
          originalText: 'Old text',
          page: '1',
          x: '50',
          y: '700',
          width: '100',
          height: '20',
          fontFamily: 'Arial',
          fontSize: '12',
          color: '#000000',
          paragraphId: '',
          coordinateSpace: 'pdf'
        },
        style: {}
      };

      const originalDocument = global.document;
      global.document = {
        getElementById: jest.fn(() => editBoxMock)
      };

      editor.currentPage = 1;
      editor.selectedTextItem = {
        text: 'Old text',
        x: 50,
        y: 700,
        width: 100,
        height: 20,
        page: 1,
        fontSize: 12,
        fontName: 'Helvetica',
        fontFamily: 'Arial',
        color: [0, 0, 0]
      };

      editor.handleTextEditComplete();

      expect(editor.operations).toHaveLength(1);
      expect(editor.operations[0]).toMatchObject({
        type: 'editText',
        coordinateSpace: 'pdf',
        x: 50,
        y: 700,
        newText: 'New text'
      });

      global.document = originalDocument;
    });
  });

  describe('selectTextItem', () => {
    it('should select a text item', () => {
      const originalDocument = global.document;
      const editBoxMock = {
        id: 'textEditBox',
        className: '',
        placeholder: '',
        addEventListener: jest.fn(),
        style: {}
      };
      global.document = {
        createElement: jest.fn(() => editBoxMock),
        body: { appendChild: jest.fn() },
        getElementById: jest.fn(() => null)
      };

      const item = { id: 'text_1', text: 'Hello', x: 50, y: 700, width: 100, height: 20, page: 1, fontSize: 12, fontName: 'Helvetica', color: [0, 0, 0] };
      editor.selectTextItem(item);

      global.document = originalDocument;
    });
  });

  describe('addBatchOperation', () => {
    it('should add operation to batch when batching is active', () => {
      editor.isBatching = true;
      editor.batchOperations = [];
      const operation = { type: 'text', page: 1 };
      editor.addBatchOperation(operation);
      expect(editor.batchOperations.length).toBe(1);
    });

    it('should call addOperation when not batching', () => {
      editor.isBatching = false;
      const operation = { type: 'text', page: 1 };
      editor.addOperation(operation);
      expect(editor.operations.length).toBe(1);
    });
  });

  describe('beginBatch/endBatch', () => {
    it('should start batching', () => {
      editor.beginBatch();
      expect(editor.isBatching).toBe(true);
      expect(editor.batchOperations).toEqual([]);
    });

    it('should end batching and add operations', () => {
      editor.isBatching = true;
      editor.batchOperations = [{ type: 'text' }];
      editor.endBatch();
      expect(editor.isBatching).toBe(false);
      expect(editor.batchOperations).toBeNull();
    });

    it('should not add operations when batch is empty', () => {
      editor.isBatching = true;
      editor.batchOperations = [];
      editor.endBatch();
      expect(editor.operations.length).toBe(0);
    });
  });

  describe('getOperations', () => {
    it('should return all operations', () => {
      editor.operations = [
        { type: 'editText', page: 1 },
        { type: 'text', page: 2 },
        { type: 'image', page: 3 }
      ];
      editor.undoStack = [];
      editor.redoStack = [];
      const ops = editor.getOperations();
      expect(ops.length).toBe(3);
      expect(ops[0].type).toBe('editText');
      expect(ops[1].type).toBe('text');
      expect(ops[2].type).toBe('image');
    });

    it('should return empty array when no operations', () => {
      editor.operations = [];
      expect(editor.getOperations()).toEqual([]);
    });
  });
});