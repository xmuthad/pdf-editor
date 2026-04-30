// PDF Editor - Core editing functionality

class PDFEditor {
  constructor() {
    this.currentTool = null;
    this.currentPage = 1;
    this.scale = 1.0;
    this.pdfPath = null;
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.onChangeCallback = null;
    this.pageChangeHandler = null;
    this.canvas = null;
    this.ctx = null;
    this.pageWidth = 0;
    this.pageHeight = 0;
    this.backgroundCache = null;

    this.options = {
      fontFamily: 'Arial',
      fontSize: 16,
      textColor: '#000000',
      eraserSize: 20,
      highlightColor: '#ffff00',
      underlineColor: '#ff0000',
      currentImage: null
    };

    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;

    this.textItems = [];
    this.selectedTextItem = null;
    this.textEditBox = null;
    this.isEditingText = false;
    
    this.pdfDoc = null;
    this.textItemsCache = new Map();
    this.maxCacheSize = 50;
    
    this.ocrEngine = null;
    this.isScanned = false;
  }

  setOnChange(callback) {
    this.onChangeCallback = callback;
  }

  setPageChangeHandler(handler) {
    this.pageChangeHandler = handler;
  }

  setTool(tool) {
    this.currentTool = tool;
    if (tool !== 'text') {
      this.hideTextEditBox();
    }
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
  }

  async init(canvas, pdfPath) {
    this.pdfPath = pdfPath;
    this.canvas = canvas;
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];

    try {
      const pdfjsLib = window.pdfjsLibInstance;
      if (!pdfjsLib) {
        throw new Error('PDF.js not loaded');
      }

      const fileData = await window.pdfAPI.readFile(pdfPath);
      const typedArray = new Uint8Array(fileData);

      this.pdfDoc = await pdfjsLib.getDocument({
        data: typedArray,
        workerSrc: window.pdfWorkerSrc,
        disableFontFace: true,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true,
        disableCreateObjectURL: true,
        useSystemFonts: true,
        cMapUrl: null,
        cMapPacked: false
      }).promise;

      const info = {
        totalPages: this.pdfDoc.numPages
      };

      await this.checkIfScanned();

      return info;
    } catch (error) {
      console.error('Failed to initialize PDF editor:', error);
      throw error;
    }
  }

  async checkIfScanned() {
    try {
      const firstPageText = await this.extractTextContent(1);
      this.isScanned = firstPageText.status === 'empty' || firstPageText.items.length === 0;
      
      if (this.isScanned && window.OCREngine) {
        this.ocrEngine = new window.OCREngine({
          lang: 'eng+chi_sim',
          logger: (m) => {
            if (m.status === 'recognizing text') {
              console.log(`[OCR] 识别进度：${(m.progress * 100).toFixed(1)}%`);
            }
          }
        });
        console.log('[INFO] PDF appears to be scanned, OCR engine ready');
      }
    } catch (error) {
      console.warn('Failed to check if PDF is scanned:', error);
      this.isScanned = false;
    }
  }

  async performOCR(pageNum = 1) {
    if (!this.ocrEngine) {
      throw new Error('OCR engine not initialized');
    }

    try {
      const canvas = document.createElement('canvas');
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      const ocrResult = await this.ocrEngine.recognizeCanvas(canvas, { page: pageNum });
      
      const textItems = ocrResult.words.map((word, index) => ({
        id: `ocr_${pageNum}_${index}`,
        text: word.text,
        x: word.bbox.x0 / 2.0,
        y: (canvas.height - word.bbox.y1) / 2.0,
        width: (word.bbox.x1 - word.bbox.x0) / 2.0,
        height: (word.bbox.y1 - word.bbox.y0) / 2.0,
        fontSize: 12,
        fontName: 'Helvetica',
        fontFamily: 'Helvetica',
        color: [0, 0, 0],
        page: pageNum,
        rotation: 0,
        pageRotation: 0,
        hasEOL: false,
        dir: 'ltr',
        confidence: word.confidence,
        isOCR: true
      }));

      this.textItems = textItems;
      this.textStatus = 'editable';
      this.textStatusMessage = `OCR recognized ${textItems.length} words`;

      return {
        items: textItems,
        status: 'editable',
        message: `OCR recognized ${textItems.length} words`,
        totalItems: textItems.length,
        ocrResult: ocrResult
      };
    } catch (error) {
      console.error('[OCR] Failed to perform OCR:', error);
      throw error;
    }
  }

  async getPageRotation(pageNum) {
    if (!this.pdfDoc) return 0;
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const rotation = page.rotate;
      return rotation || 0;
    } catch (error) {
      console.error('Failed to get page rotation:', error);
      return 0;
    }
  }

  async extractTextContent(pageNum) {
    if (!this.pdfDoc) {
      return { items: [], status: 'error', message: 'PDF document not loaded' };
    }

    if (window.perfMonitor) {
      window.perfMonitor.startTimer(`extractText_page_${pageNum}`);
    }

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      if (!textContent.items || textContent.items.length === 0) {
        const result = { items: [], status: 'empty', message: 'No text content found on this page' };
        if (window.perfMonitor) {
          window.perfMonitor.endTimer(`extractText_page_${pageNum}`, { status: 'empty' });
        }
        return result;
      }

      const pageRotation = page.rotate || 0;
      const viewport = page.getViewport({ scale: 1.0 });

      const rawItems = textContent.items.map((item, index) => {
        try {
          const tx = item.transform;
          const width = item.width || 0;
          const height = item.height || 12;

          let x = tx[4];
          let y = tx[5];
          const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
          const textRotation = Math.atan2(tx[1], tx[0]) * (180 / Math.PI);

          if (pageRotation === 90) {
            const tempX = x;
            x = y;
            y = viewport.height - tempX;
          } else if (pageRotation === 180) {
            x = viewport.width - x;
            y = viewport.height - y;
          } else if (pageRotation === 270) {
            const tempX = x;
            x = viewport.width - y;
            y = tempX;
          }

          return {
            id: `text_${pageNum}_${index}`,
            text: item.str,
            x: x,
            y: y,
            width: width,
            height: height,
            fontSize: fontSize,
            fontName: item.fontName,
            fontFamily: this.detectFontFamily(item.fontName),
            color: item.color || [0, 0, 0],
            page: pageNum,
            rotation: textRotation,
            pageRotation: pageRotation,
            hasEOL: item.hasEOL || false,
            dir: item.dir || 'ltr'
          };
        } catch (itemError) {
          console.warn(`Failed to process text item ${index} on page ${pageNum}:`, itemError.message);
          return null;
        }
      }).filter(item => item !== null);

      const paragraphs = this.groupTextItemsIntoParagraphs(rawItems);

      const result = {
        items: paragraphs,
        status: 'editable',
        message: `Found ${paragraphs.length} text items`,
        totalItems: paragraphs.length
      };

      if (window.perfMonitor) {
        window.perfMonitor.endTimer(`extractText_page_${pageNum}`, { 
          itemCount: paragraphs.length,
          status: 'success'
        });
      }

      return result;
    } catch (error) {
      console.error('Failed to extract text content:', error);
      if (window.perfMonitor) {
        window.perfMonitor.endTimer(`extractText_page_${pageNum}`, { 
          status: 'error',
          error: error.message
        });
      }
      return { items: [], status: 'error', message: error.message };
    }
  }

  detectFontFamily(fontName) {
    if (!fontName) return this.options.fontFamily;

    const name = fontName.toLowerCase();

    if (name.includes('simsun') || name.includes('songti') || name.includes('song')) return 'SimSun';
    if (name.includes('simhei') || name.includes('heiti') || (name.includes('hei') && !name.includes('yahei'))) return 'SimHei';
    if (name.includes('microsoftyahei') || name.includes('msyahei') || (name.includes('yahei') && !name.includes('sim'))) return 'Microsoft YaHei';
    if (name.includes('kaiti') || name.includes('kai')) return 'KaiTi';
    if (name.includes('arial')) return 'Arial';
    if (name.includes('times')) return 'Times New Roman';
    if (name.includes('courier')) return 'Courier New';
    if (name.includes('georgia')) return 'Georgia';
    if (name.includes('verdana')) return 'Verdana';
    if (name.includes('impact')) return 'Impact';
    if (name.includes('comic')) return 'Comic Sans MS';
    if (name.includes('trebuchet')) return 'Trebuchet MS';
    if (name.includes('tahoma')) return 'Tahoma';

    return fontName || this.options.fontFamily;
  }

  groupTextItemsIntoParagraphs(items) {
    if (items.length === 0) return [];

    const sortedItems = [...items].sort((a, b) => {
      if (Math.abs(a.y - b.y) < 5) {
        return a.x - b.x;
      }
      return b.y - a.y;
    });

    const paragraphs = [];
    let currentParagraph = null;
    let currentLine = [];

    for (const item of sortedItems) {
      if (item.text.trim() === '' && !item.hasEOL) continue;

      if (!currentParagraph) {
        currentParagraph = {
          id: `para_${item.page}_${paragraphs.length}`,
          items: [item],
          lines: [],
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          page: item.page,
          fontSize: item.fontSize,
          fontFamily: item.fontFamily,
          color: item.color
        };
        currentLine = [item];
      } else {
        const yDiff = Math.abs(item.y - currentParagraph.y);
        const isSameLine = yDiff < 5 && item.x > currentParagraph.x;

        if (isSameLine) {
          currentLine.push(item);
          currentParagraph.items.push(item);
          currentParagraph.width = Math.max(
            currentParagraph.width,
            item.x + item.width - currentParagraph.x
          );
        } else {
          currentParagraph.lines.push([...currentLine]);
          currentLine = [item];

          const yDiffFromLast = Math.abs(item.y - currentParagraph.y);
          if (yDiffFromLast > currentParagraph.height * 1.5) {
            paragraphs.push(currentParagraph);
            currentParagraph = {
              id: `para_${item.page}_${paragraphs.length}`,
              items: [item],
              lines: [],
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
              page: item.page,
              fontSize: item.fontSize,
              fontFamily: item.fontFamily,
              color: item.color
            };
          } else {
            currentParagraph.y = Math.min(currentParagraph.y, item.y);
            currentParagraph.height += item.height;
          }
        }
      }
    }

    if (currentParagraph && currentParagraph.items.length > 0) {
      if (currentLine.length > 0) {
        currentParagraph.lines.push(currentLine);
      }
      paragraphs.push(currentParagraph);
    }

    const flatItems = [];
    for (const para of paragraphs) {
      for (const item of para.items) {
        flatItems.push({
          ...item,
          paragraphId: para.id,
          paragraphY: para.y,
          paragraphHeight: para.height
        });
      }
    }

    return flatItems;
  }

  async loadTextForPage(pageNum) {
    const cacheKey = `page_${pageNum}`;

    console.log('[DEBUG] loadTextForPage:', pageNum, 'cache has:', this.textItemsCache.has(cacheKey));
    
    if (this.textItemsCache.has(cacheKey)) {
      this.textItems = this.textItemsCache.get(cacheKey);
      console.log('[DEBUG] loadTextForPage: using cache, items:', this.textItems.length);
      return this.textItems;
    }
    
    if (this.currentPage !== pageNum || !this.textItems || this.textItems.length === 0) {
      this.currentPage = pageNum;
      console.log('[DEBUG] loadTextForPage: extracting text content for page', pageNum);
      const result = await this.extractTextContent(pageNum);
      this.textItems = result.items || [];
      this.textStatus = result.status || 'unknown';
      this.textStatusMessage = result.message || '';
      console.log('[DEBUG] loadTextForPage: extracted items:', this.textItems.length, 'status:', this.textStatus);
      
      if (this.textItemsCache.size >= this.maxCacheSize) {
        const firstKey = this.textItemsCache.keys().next().value;
        this.textItemsCache.delete(firstKey);
      }
      this.textItemsCache.set(cacheKey, [...this.textItems]);
    }
    return this.textItems;
  }

  clearCache() {
    this.textItemsCache.clear();
    this.backgroundCache = null;
    if (this.pdfDoc) {
      this.pdfDoc = null;
    }
  }

  cleanup() {
    this.clearCache();
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.textItems = [];
    this.selectedTextItem = null;
  }

  getTextStatus() {
    return {
      status: this.textStatus || 'unknown',
      message: this.textStatusMessage || '',
      itemCount: this.textItems ? this.textItems.length : 0
    };
  }

  getDisplayScale() {
    if (typeof currentZoom !== 'undefined' && Number.isFinite(currentZoom)) {
      return currentZoom / 100;
    }
    return this.scale || 1;
  }

  getPageHeightInPdfUnits() {
    const zoomFactor = this.getDisplayScale();
    if (zoomFactor > 0 && this.pageHeight > 0) {
      return this.pageHeight / zoomFactor;
    }
    return this.pageHeight || 0;
  }

  getTextItemsAtPosition(x, y, pageNum) {
    const zoomFactor = this.getDisplayScale();
    const pageHeight = this.getPageHeightInPdfUnits();
    const items = this.textItems || [];

    const candidateItems = items.filter(item => {
      if (item.page !== pageNum) return false;

      const itemLeft = item.x * zoomFactor;
      const itemRight = (item.x + item.width) * zoomFactor;
      const itemTop = (pageHeight - item.y - item.height) * zoomFactor;
      const itemBottom = (pageHeight - item.y) * zoomFactor;

      // Add tolerance for easier selection
      const tolerance = 5;
      const hit = x >= (itemLeft - tolerance) && x <= (itemRight + tolerance) &&
                  y >= (itemTop - tolerance) && y <= (itemBottom + tolerance);

      return hit;
    });

    // Update debug panel with item info
    if (candidateItems.length === 0) {
      // Find the item closest to the click position
      let closestItem = null;
      let closestDist = Infinity;
      for (const item of items) {
        if (item.page !== pageNum) continue;
        const itemLeft = item.x * zoomFactor;
        const itemRight = (item.x + item.width) * zoomFactor;
        const itemTop = (pageHeight - item.y - item.height) * zoomFactor;
        const itemBottom = (pageHeight - item.y) * zoomFactor;
        const centerX = (itemLeft + itemRight) / 2;
        const centerY = (itemTop + itemBottom) / 2;
        const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (dist < closestDist) {
          closestDist = dist;
          closestItem = item;
        }
      }
      if (closestItem) {
        const itemLeft = closestItem.x * zoomFactor;
        const itemRight = (closestItem.x + closestItem.width) * zoomFactor;
        const itemTop = (pageHeight - closestItem.y - closestItem.height) * zoomFactor;
        const itemBottom = (pageHeight - closestItem.y) * zoomFactor;
        updateTextDebugPanel(`无命中 | 点击(${x.toFixed(0)}, ${y.toFixed(0)}) | 最近的文本: "${closestItem.text.substring(0, 20)}" 在(${itemLeft.toFixed(0)}-${itemRight.toFixed(0)}, ${itemTop.toFixed(0)}-${itemBottom.toFixed(0)}) 距离${closestDist.toFixed(0)}px`);
      } else {
        updateTextDebugPanel(`无命中 | 点击(${x.toFixed(0)}, ${y.toFixed(0)}) | 页面无文本项`);
      }
    } else {
      updateTextDebugPanel(`命中 ${candidateItems.length} 个文本项! 选中: "${candidateItems[0].text.substring(0, 20)}"`);
    }

    return candidateItems;
  }

  selectTextItem(item) {
    this.selectedTextItem = item;
    updateTextDebugPanel(`selectTextItem: "${item.text.substring(0, 20)}" | calling showTextEditBox`);
    this.showTextEditBox(item);
  }

  showTextEditBox(item) {
    let editBox = document.getElementById('textEditBox');
    updateTextDebugPanel(`showTextEditBox: mouse(${this.lastMouseX}, ${this.lastMouseY})`);
    if (!editBox) {
      editBox = this.createTextEditBox();
    }

    if (this.canvas) {
      const canvasRect = this.canvas.getBoundingClientRect();
      const zoomFactor = this.getDisplayScale();
      const pageHeight = this.getPageHeightInPdfUnits();

      let paragraphItems = [item];
      let displayText = item.text;
      let boxX = item.x;
      let boxY = item.y;
      let boxWidth = item.width;
      let boxHeight = item.height;

      if (item.paragraphId) {
        paragraphItems = this.textItems.filter(
          t => t.paragraphId === item.paragraphId
        );

        if (paragraphItems.length > 1) {
          paragraphItems.sort((a, b) => {
            if (Math.abs(a.y - b.y) < 5) return a.x - b.x;
            return b.y - a.y;
          });

          displayText = paragraphItems.map(t => t.text).join('');

          const minX = Math.min(...paragraphItems.map(t => t.x));
          const maxX = Math.max(...paragraphItems.map(t => t.x + t.width));
          const minY = Math.min(...paragraphItems.map(t => t.y));
          const maxY = Math.max(...paragraphItems.map(t => t.y + t.height));

          boxX = minX;
          boxY = minY;
          boxWidth = maxX - minX;
          boxHeight = maxY - minY;
        }
      }

      // Use the stored mouse click position for reliable positioning
      // This is viewport-relative and doesn't depend on canvas scroll position
      let left, top;
      if (this.lastMouseX !== undefined && this.lastMouseY !== undefined) {
        left = this.lastMouseX;
        top = this.lastMouseY;
        // Offset slightly so the box doesn't cover the exact click point
        top = top - 10;
      } else {
        // Fallback: use canvas rect + item position
        left = canvasRect.left + (boxX * zoomFactor);
        top = canvasRect.top + ((pageHeight - boxY - boxHeight) * zoomFactor);
      }

      const width = Math.max((boxWidth + 20) * zoomFactor, 100);
      const height = Math.max((boxHeight + 20) * zoomFactor, 40);

      const itemFontFamily = item.fontFamily || this.options.fontFamily;
      const itemFontSize = Math.max(item.fontSize * zoomFactor * 0.9, 12);
      const itemColor = this.rgbToHex(item.color);

      editBox.style.left = `${left}px`;
      editBox.style.top = `${top}px`;
      editBox.style.width = `${width}px`;
      editBox.style.height = `${height}px`;
      editBox.style.fontSize = `${itemFontSize}px`;
      editBox.style.fontFamily = itemFontFamily;
      editBox.style.color = itemColor;

      editBox.value = displayText;
      editBox.dataset.page = item.page;
      editBox.dataset.x = String(boxX);
      editBox.dataset.y = String(boxY);
      editBox.dataset.width = String(boxWidth);
      editBox.dataset.height = String(boxHeight);
      editBox.dataset.fontFamily = itemFontFamily;
      editBox.dataset.fontSize = String(item.fontSize);
      editBox.dataset.color = itemColor;
      editBox.dataset.paragraphId = item.paragraphId || '';
      editBox.dataset.originalText = displayText;
      editBox.dataset.coordinateSpace = 'pdf';

      editBox.style.display = 'block';
      editBox.focus();
      editBox.select();

      this.isEditingText = true;
    }
  }

  createTextEditBox() {
    const editBox = document.createElement('textarea');
    editBox.id = 'textEditBox';
    editBox.className = 'text-edit-box';
    editBox.placeholder = '输入文本...';

    // Keep textarea interactions isolated from canvas-level handlers.
    editBox.addEventListener('mousedown', (e) => e.stopPropagation());
    editBox.addEventListener('mouseup', (e) => e.stopPropagation());
    editBox.addEventListener('click', (e) => e.stopPropagation());

    editBox.addEventListener('blur', () => this.handleTextEditComplete());
    editBox.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleTextEditComplete();
      } else if (e.key === 'Escape') {
        this.cancelTextEdit();
      }
    });

    document.body.appendChild(editBox);

    this.textEditBox = editBox;
    return editBox;
  }

  hideTextEditBox() {
    const editBox = document.getElementById('textEditBox');
    if (editBox) {
      editBox.style.display = 'none';
    }
    this.isEditingText = false;
    this.selectedTextItem = null;
  }

  cancelTextEdit() {
    this.hideTextEditBox();
  }

  updateSelectedTextStyle(style) {
    if (!this.selectedTextItem) return false;

    if (style.fontFamily !== undefined) {
      this.selectedTextItem.fontFamily = style.fontFamily;
      this.options.fontFamily = style.fontFamily;
    }
    if (style.fontSize !== undefined) {
      this.selectedTextItem.fontSize = style.fontSize;
      this.options.fontSize = style.fontSize;
    }
    if (style.textColor !== undefined) {
      this.selectedTextItem.color = this.hexToRgbArray(style.textColor);
      this.options.textColor = style.textColor;
    }

    const editBox = document.getElementById('textEditBox');
    if (editBox && editBox.style.display !== 'none') {
      if (style.fontFamily !== undefined) {
        editBox.style.fontFamily = this.selectedTextItem.fontFamily;
      }
      if (style.fontSize !== undefined) {
        const zoomFactor = this.getDisplayScale();
        editBox.style.fontSize = `${Math.max(this.selectedTextItem.fontSize * zoomFactor * 0.8, 10)}px`;
      }
      if (style.textColor !== undefined) {
        editBox.style.color = style.textColor;
      }
    }

    return true;
  }

  handleTextEditComplete() {
    if (!this.selectedTextItem) return;

    const editBox = document.getElementById('textEditBox');
    if (!editBox) return;

    const newText = editBox.value;
    const originalText = editBox.dataset.originalText || this.selectedTextItem.text;
    const paragraphId = editBox.dataset.paragraphId;

    const trimmedNewText = newText.trim();

    if (newText !== originalText && trimmedNewText !== '') {
      const op = {
        type: 'editText',
        page: this.currentPage,
        coordinateSpace: editBox.dataset.coordinateSpace || 'pdf',
        originalText: originalText,
        newText: trimmedNewText,
        x: parseFloat(editBox.dataset.x),
        y: parseFloat(editBox.dataset.y),
        width: parseFloat(editBox.dataset.width) || this.selectedTextItem.width,
        height: parseFloat(editBox.dataset.height) || this.selectedTextItem.height,
        fontSize: this.selectedTextItem.fontSize,
        fontName: this.selectedTextItem.fontName,
        color: this.selectedTextItem.color,
        fontFamily: this.selectedTextItem.fontFamily || this.options.fontFamily,
        newFontFamily: this.options.fontFamily,
        newFontSize: this.options.fontSize,
        newColor: this.options.textColor
      };

      if (paragraphId) {
        op.paragraphId = paragraphId;
        const paraItemsForOp = this.textItems.filter(t => t.paragraphId === paragraphId);
        op.paragraphItems = paraItemsForOp.map(t => ({
          text: t.text,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          fontSize: t.fontSize,
          fontName: t.fontName,
          color: t.color
        }));
      }

      this.addOperation(op);

      if (paragraphId) {
        const paraItemsToUpdate = this.textItems.filter(t => t.paragraphId === paragraphId);
        for (const t of paraItemsToUpdate) {
          t.fontFamily = this.options.fontFamily;
          t.fontSize = this.options.fontSize;
          t.color = this.hexToRgbArray(this.options.textColor);
        }
      }

      this.selectedTextItem.text = trimmedNewText;
      this.selectedTextItem.fontFamily = this.options.fontFamily;
      this.selectedTextItem.fontSize = this.options.fontSize;
      this.selectedTextItem.color = this.hexToRgbArray(this.options.textColor);
    }

    this.hideTextEditBox();
  }

  rgbToHex(color) {
    if (typeof color === 'string' && color.startsWith('#')) {
      return color;
    }
    if (Array.isArray(color)) {
      const r = Math.round(color[0] * 255);
      const g = Math.round(color[1] * 255);
      const b = Math.round(color[2] * 255);
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
    return '#000000';
  }

  hexToRgbArray(hex) {
    if (Array.isArray(hex)) {
      return hex;
    }
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
      ];
    }
    return [0, 0, 0];
  }

  addOperation(operation) {
    this.operations.push(operation);
    this.undoStack.push([operation]);
    this.redoStack = [];
    
    if (this.undoStack.length > 100) {
      this.undoStack.shift();
    }

    if (this.onChangeCallback) {
      this.onChangeCallback({
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0
      });
    }
  }

  beginBatch() {
    this.isBatching = true;
    this.batchOperations = [];
  }

  endBatch() {
    this.isBatching = false;
    if (this.batchOperations && this.batchOperations.length > 0) {
      this.operations.push(...this.batchOperations);
      this.undoStack.push([...this.batchOperations]);
      this.redoStack = [];
      
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
      
      if (this.onChangeCallback) {
        this.onChangeCallback({
          canUndo: this.undoStack.length > 0,
          canRedo: this.redoStack.length > 0
        });
      }
    }
    this.batchOperations = null;
  }

  addBatchOperation(operation) {
    if (this.isBatching && this.batchOperations) {
      this.batchOperations.push(operation);
    } else {
      this.addOperation(operation);
    }
  }

  undo() {
    if (this.undoStack.length === 0) return;

    const operations = this.undoStack.pop();
    this.redoStack.push(operations);

    for (const op of operations) {
      const index = this.operations.indexOf(op);
      if (index > -1) {
        this.operations.splice(index, 1);
      }

      if (op.type === 'editText') {
        const item = this.textItems.find(
          t => t.page === op.page && t.x === op.x && t.y === op.y && t.originalText === op.newText
        );
        if (item) {
          item.text = op.originalText;
        }
      }
    }

    if (this.onChangeCallback) {
      this.onChangeCallback({
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0
      });
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;

    const operations = this.redoStack.pop();
    this.undoStack.push(operations);

    for (const op of operations) {
      this.operations.push(op);

      if (op.type === 'editText') {
        const item = this.textItems.find(
          t => t.page === op.page && t.x === op.x && t.y === op.y && t.originalText === op.originalText
        );
        if (item) {
          item.text = op.newText;
        }
      }
    }

    if (this.onChangeCallback) {
      this.onChangeCallback({
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0
      });
    }
  }

  clearAll() {
    if (this.operations.length === 0) return;

    this.undoStack.push([...this.operations]);
    this.operations = [];
    this.redoStack = [];
    this.textItems = [];

    if (this.onChangeCallback) {
      this.onChangeCallback({
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0
      });
    }
  }

  getOperations() {
    return this.operations.filter(op => op.type === 'editText');
  }

  handleMouseDown(e) {
    const editBox = document.getElementById('textEditBox');
    updateTextDebugPanel(`mousedown | isDrawing=${this.isDrawing} | isEditing=${this.isEditingText} | selected=${this.selectedTextItem ? 'yes' : 'no'}`);

    if (this.isEditingText) {
      updateTextDebugPanel(`mousedown blocked - isEditingText=true`);
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;
    this.isDrawing = true;

    // Store mouse coordinates for edit box positioning
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    const zoomFactor = this.getDisplayScale();
    const pageHeight = this.getPageHeightInPdfUnits();

    // Show first few text items' coordinates for comparison
    let itemsDebug = '';
    if (this.textItems && this.textItems.length > 0) {
      const first3 = this.textItems.slice(0, 3);
      itemsDebug = first3.map(item => {
        const itemLeft = item.x * zoomFactor;
        const itemRight = (item.x + item.width) * zoomFactor;
        const itemTop = (pageHeight - item.y - item.height) * zoomFactor;
        const itemBottom = (pageHeight - item.y) * zoomFactor;
        return `"${item.text.substring(0, 15)}" PDF(${item.x.toFixed(0)},${item.y.toFixed(0)}) Canvas(左${itemLeft.toFixed(0)} 右${itemRight.toFixed(0)} 上${itemTop.toFixed(0)} 下${itemBottom.toFixed(0)})`;
      }).join(' | ');
    }

    updateTextDebugPanel(`点击(${this.startX.toFixed(0)}, ${this.startY.toFixed(0)}) isDrawing=${this.isDrawing} | 前3项: ${itemsDebug}`);

    if (this.currentTool === 'text' || this.currentTool === null) {
      const items = this.getTextItemsAtPosition(
        this.startX,
        this.startY,
        this.currentPage
      );

      if (items.length > 0) {
        this.selectTextItem(items[0]);
        return;
      } else {
        this.hideTextEditBox();
      }
    }
  }

  handleMouseMove(e) {
    if (!this.isDrawing) return;

    const rect = this.canvas.getBoundingClientRect();
    this.currentX = e.clientX - rect.left;
    this.currentY = e.clientY - rect.top;
  }

  handleMouseUp(e) {
    if (!this.isDrawing) return;

    const rect = this.canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    if (this.currentTool && this.currentTool !== 'select' && this.currentTool !== 'hand') {
      const width = Math.abs(endX - this.startX);
      const height = Math.abs(endY - this.startY);

      if (width > 5 || height > 5) {
        this.addOperation({
          type: this.currentTool,
          page: this.currentPage,
          x: Math.min(this.startX, endX),
          y: Math.min(this.startY, endY),
          width: width,
          height: height,
          color: this.getToolColor(),
          tool: this.currentTool
        });
      }
    }

    this.isDrawing = false;
  }

  handleMouseLeave(e) {
    this.handleMouseUp(e);
  }

  getToolColor() {
    switch (this.currentTool) {
      case 'highlight':
        return this.options.highlightColor;
      case 'underline':
        return this.options.underlineColor;
      case 'text':
        return this.options.textColor;
      default:
        return '#000000';
    }
  }

  async renderPage(pageNum) {
    this.currentPage = pageNum;
    await this.loadTextForPage(pageNum);
  }

  async applyToPDF(pdfPath) {
    const editOperations = this.getOperations();
    if (editOperations.length === 0) {
      const fileData = await window.pdfAPI.readFile(pdfPath);
      return new Uint8Array(fileData);
    }

    const result = await window.pdfAPI.applyEdits(pdfPath, editOperations);
    return result;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PDFEditor;
} else if (typeof window !== 'undefined') {
  window.PDFEditor = PDFEditor;
}
