jest.mock('tesseract.js');

describe('OCREngine', () => {
  let OCREngine;
  let mockWorker;

  beforeAll(() => {
    OCREngine = require('../ocr-engine').default || require('../ocr-engine');
  });

  beforeEach(() => {
    mockWorker = {
      loadLanguage: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn().mockResolvedValue(undefined),
      recognize: jest.fn().mockResolvedValue({
        data: {
          text: 'Sample recognized text',
          confidence: 85,
          words: [
            { text: 'Sample', confidence: 90, bbox: { x0: 10, y0: 10, x1: 50, y1: 20 } },
            { text: 'recognized', confidence: 80, bbox: { x0: 55, y0: 10, x1: 100, y1: 20 } },
            { text: 'text', confidence: 85, bbox: { x0: 105, y0: 10, x1: 130, y1: 20 } }
          ],
          lines: [
            { text: 'Sample recognized text', confidence: 85, bbox: { x0: 10, y0: 10, x1: 130, y1: 20 }, words: [] }
          ],
          paragraphs: [
            { text: 'Sample recognized text', confidence: 85, bbox: { x0: 10, y0: 10, x1: 130, y1: 20 }, lines: [] }
          ]
        }
      }),
      setParameters: jest.fn().mockResolvedValue(undefined),
      terminate: jest.fn().mockResolvedValue(undefined)
    };

    require('tesseract.js').createWorker.mockResolvedValue(mockWorker);
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should create OCREngine with default options', () => {
      const ocr = new OCREngine();
      expect(ocr).toBeDefined();
      expect(ocr.isInitialized).toBe(false);
      expect(ocr.options.lang).toBe('eng+chi_sim');
    });

    test('should create OCREngine with custom options', () => {
      const customOcr = new OCREngine({
        lang: 'eng',
        logger: null
      });
      expect(customOcr.options.lang).toBe('eng');
      expect(customOcr.options.logger).toBe(null);
    });
  });

  describe('defaultLogger', () => {
    test('should log progress messages', () => {
      const ocr = new OCREngine();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      ocr.defaultLogger({ status: 'recognizing text', progress: 0.5 });

      expect(consoleSpy).toHaveBeenCalledWith('[OCR] Progress: 50.0%');

      consoleSpy.mockRestore();
    });

    test('should not log non-progress messages', () => {
      const ocr = new OCREngine();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      ocr.defaultLogger({ status: 'initializing', progress: 0 });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('init', () => {
    test('should initialize worker', async () => {
      const ocr = new OCREngine();
      await ocr.init();
      expect(ocr.isInitialized).toBe(true);
      expect(ocr.worker).toBeDefined();
    });

    test('should not reinitialize if already initialized', async () => {
      const ocr = new OCREngine();
      await ocr.init();
      const worker = ocr.worker;
      await ocr.init();
      expect(ocr.worker).toBe(worker);
    });

    test('should handle initialization failure', async () => {
      require('tesseract.js').createWorker.mockRejectedValueOnce(new Error('Failed to load language'));
      const badOcr = new OCREngine({ lang: 'invalid_lang_123' });
      await expect(badOcr.init()).rejects.toThrow('OCR 初始化失败');
    });
  });

  describe('terminate', () => {
    test('should terminate worker', async () => {
      const ocr = new OCREngine();
      await ocr.init();
      expect(ocr.isInitialized).toBe(true);

      await ocr.terminate();
      expect(ocr.isInitialized).toBe(false);
      expect(ocr.worker).toBe(null);
    });

    test('should handle terminate when not initialized', async () => {
      const ocr = new OCREngine();
      await expect(ocr.terminate()).resolves.toBeUndefined();
    });
  });

  describe('recognize', () => {
    test('should recognize text from image', async () => {
      const ocr = new OCREngine();
      await ocr.init();

      const result = await ocr.recognize('test-image-data', { page: 1 });

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('words');
      expect(result).toHaveProperty('lines');
      expect(result).toHaveProperty('paragraphs');
    });

    test('should filter words by confidence threshold', async () => {
      const ocr = new OCREngine();
      await ocr.init();

      const result = await ocr.recognize('test-image-data', {
        page: 1,
        confidenceThreshold: 95
      });

      expect(result.words.length).toBe(0);
    });

    test('should call recognize on worker', async () => {
      const ocr = new OCREngine();
      await ocr.init();

      await ocr.recognize('test-image-data', { page: 1 });

      expect(mockWorker.recognize).toHaveBeenCalledWith('test-image-data');
    });
  });

  describe('recognizeCanvas', () => {
    test('should convert canvas to blob and recognize', async () => {
      const ocr = new OCREngine();
      await ocr.init();

      const mockCanvas = {
        toBlob: jest.fn((callback) => {
          callback(new Blob(['test'], { type: 'image/png' }));
        })
      };

      const result = await ocr.recognizeCanvas(mockCanvas, { page: 1 });

      expect(mockCanvas.toBlob).toHaveBeenCalled();
      expect(result).toHaveProperty('text');
    });

    test('should handle canvas blob error', async () => {
      const ocr = new OCREngine();
      await ocr.init();

      mockWorker.recognize.mockRejectedValueOnce(new Error('Invalid image data'));

      const mockCanvas = {
        toBlob: jest.fn((callback) => {
          callback(null);
        })
      };

      await expect(ocr.recognizeCanvas(mockCanvas, { page: 1 })).rejects.toThrow('Invalid image data');
    });
  });

  describe('setParameters', () => {
    test('should set parameters', async () => {
      const ocr = new OCREngine();
      await ocr.init();

      const params = {
        tessedit_char_whitelist: '0123456789'
      };

      await ocr.setParameters(params);
      expect(mockWorker.setParameters).toHaveBeenCalledWith(params);
    });

    test('should auto-initialize if not initialized', async () => {
      const ocr = new OCREngine();

      const params = { tessedit_char_whitelist: '0123456789' };
      await ocr.setParameters(params);

      expect(mockWorker.loadLanguage).toHaveBeenCalled();
      expect(mockWorker.initialize).toHaveBeenCalled();
    });
  });
});