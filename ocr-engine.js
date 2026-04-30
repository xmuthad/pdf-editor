// OCR Module - Text recognition for scanned PDFs
const Tesseract = require('tesseract.js');

class OCREngine {
  constructor(options = {}) {
    this.worker = null;
    this.isInitialized = false;
    this.options = {
      lang: options.lang || 'eng+chi_sim',
      logger: options.logger || this.defaultLogger,
      ...options
    };
  }

  defaultLogger(m) {
    if (m.status === 'recognizing text') {
      console.log(`[OCR] Progress: ${(m.progress * 100).toFixed(1)}%`);
    }
  }

  async init() {
    if (this.isInitialized) return;

    try {
      console.log('[OCR] Initializing Tesseract worker...');

      this.worker = await Tesseract.createWorker(this.options.lang);
      
      await this.worker.loadLanguage(this.options.lang);
      await this.worker.initialize(this.options.lang);
      
      this.isInitialized = true;
      console.log('[OCR] Worker initialized successfully');
    } catch (error) {
      console.error('[OCR] Failed to initialize worker:', error);
      throw new Error(`OCR 初始化失败：${error.message}`);
    }
  }

  async recognize(imageSource, options = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      const {
        page = 1,
        rect = null,
        confidenceThreshold = 50
      } = options;

      console.log(`[OCR] Recognizing text on page ${page}...`);

      const { data } = await this.worker.recognize(imageSource);

      const result = {
        text: data.text,
        confidence: data.confidence,
        words: [],
        lines: [],
        paragraphs: []
      };

      if (data.words) {
        result.words = data.words
          .filter(word => word.confidence >= confidenceThreshold)
          .map(word => ({
            text: word.text,
            confidence: word.confidence,
            bbox: {
              x0: word.bbox.x0,
              y0: word.bbox.y0,
              x1: word.bbox.x1,
              y1: word.bbox.y1
            },
            page: page
          }));
      }

      if (data.lines) {
        result.lines = data.lines.map((line, index) => ({
          id: `line_${page}_${index}`,
          text: line.text,
          confidence: line.confidence,
          bbox: {
            x0: line.bbox.x0,
            y0: line.bbox.y0,
            x1: line.bbox.x1,
            y1: line.bbox.y1
          },
          page: page,
          words: line.words || []
        }));
      }

      if (data.paragraphs) {
        result.paragraphs = data.paragraphs.map((para, index) => ({
          id: `para_${page}_${index}`,
          text: para.text,
          confidence: para.confidence,
          bbox: {
            x0: para.bbox.x0,
            y0: para.bbox.y0,
            x1: para.bbox.x1,
            y1: para.bbox.y1
          },
          page: page,
          lines: para.lines || []
        }));
      }

      console.log(`[OCR] Recognition complete. Confidence: ${result.confidence.toFixed(1)}%`);
      return result;
    } catch (error) {
      console.error('[OCR] Recognition failed:', error);
      throw new Error(`OCR 识别失败：${error.message}`);
    }
  }

  async recognizeCanvas(canvas, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(async (blob) => {
          try {
            const result = await this.recognize(blob, options);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }

  async terminate() {
    if (this.worker) {
      try {
        await this.worker.terminate();
        this.worker = null;
        this.isInitialized = false;
        console.log('[OCR] Worker terminated');
      } catch (error) {
        console.error('[OCR] Failed to terminate worker:', error);
      }
    }
  }

  async setParameters(params) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      await this.worker.setParameters(params);
      console.log('[OCR] Parameters updated:', params);
    } catch (error) {
      console.error('[OCR] Failed to set parameters:', error);
    }
  }
}

module.exports = OCREngine;
