// PDF Editor Renderer Process

// Debug mode - set to true to enable detailed logging
window.DEBUG_MODE = false;

// =============================================================================
// Configuration - Cache sizes and performance settings
// =============================================================================
const CACHE_CONFIG = {
  // Maximum number of PDF documents to cache (default: 2)
  // Reduced from 5 to save memory
  MAX_PDF_DOC_CACHE_SIZE: 2,

  // Maximum number of PDF file data buffers to cache (default: 3)
  MAX_FILE_DATA_CACHE_SIZE: 3,

  // Maximum number of PDF pages to cache in memory (default: 5)
  // Reduced from 10 to save memory. For large PDFs, this prevents OOM.
  MAX_PAGE_CACHE_SIZE: 5,

  // Scale factor for thumbnail rendering (default: 0.15)
  // Lower = smaller thumbnails, faster rendering, less detail
  THUMBNAIL_SCALE: 0.15,

  // Maximum thumbnails to render in viewport (default: 20)
  MAX_VISIBLE_THUMBNAILS: 20,

  // For large PDFs (>80 pages), disable background page loading entirely
  // to prevent memory issues. Thumbnails load on-demand via IntersectionObserver.
  DISABLE_BACKGROUND_LOADING_PAGES: 80,

  // Pages to preload when background loading is enabled
  // Larger PDFs preload fewer pages to avoid OOM
  MAX_PRELOAD_PAGES_LARGE: 10,    // For PDFs > 100 pages
  MAX_PRELOAD_PAGES_MEDIUM: 15,   // For PDFs > 50 pages
  MAX_PRELOAD_PAGES_SMALL: 30,    // For PDFs <= 50 pages

  // Batch size for thumbnail rendering
  // Render more thumbnails per batch for small PDFs, fewer for large ones
  THUMBNAIL_BATCH_SIZE_SMALL: 3,  // For PDFs <= 50 pages
  THUMBNAIL_BATCH_SIZE_LARGE: 2,  // For PDFs > 50 pages

  // Initial page rendering limit for continuous scroll view
  MAX_INITIAL_PAGES_LARGE: 50,    // For PDFs > 100 pages
};

// Performance monitoring
const renderPerformance = {
  startTime: 0,
  lastRenderTime: 0,
  renderCount: 0
};

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// State
let selectedFiles = [];
let currentOperation = null;
let pdfEditor = null;
let currentPdfPath = null;
let currentPage = 1;
let totalPages = 0;
let selectedImageData = null;
let selectedImageName = '';
let currentZoom = 100;
let currentTool = 'select';
let pdfjsLib = null;

// Initialize PDF.js from preload
async function initPDFJS() {
  if (pdfjsLib) return pdfjsLib;

  try {
    const baseUrl = new URL('node_modules/pdfjs-dist/legacy/build/', window.location.href);
    const pdfjsUrl = new URL('pdf.mjs', baseUrl).toString();
    const workerSrc = new URL('pdf.worker.min.mjs', baseUrl).toString();

    // Store workerSrc globally for renderPDFPage to use
    window.pdfWorkerSrc = workerSrc;

    pdfjsLib = await import(pdfjsUrl);
    if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    }

    // Store instance for later access
    window.pdfjsLibInstance = pdfjsLib;

    console.log('PDF.js initialized');
  } catch (error) {
    console.error('Failed to initialize PDF.js:', error);
    throw error;
  }

  return pdfjsLib;
}

// Global function for preload to call
// PDF document cache to avoid reloading the same file
const pdfDocumentCache = new Map();

// Cache for raw PDF file data (Uint8Array) to avoid repeated file reads
const pdfFileDataCache = new Map();

// Page cache - stores loaded page objects separately
const pdfPageCache = new Map(); // key: `${filePath}_${pageNum}`

// Background page loading state
let backgroundPageLoader = null;

// Expose cache for pdf-editor.js to use for preloading
window.pdfDocumentCacheForEditor = pdfDocumentCache;
window.pdfPageCache = pdfPageCache; // Expose page cache
window.clearPDFPageCache = clearPDFPageCache; // Expose cleanup function
window.clearPDFDocumentCache = clearPDFPageCache; // Alias for compatibility

// Clear PDF document cache (called when opening new file)
function clearPDFPageCache(filePath) {
  if (filePath) {
    pdfDocumentCache.delete(filePath);
    pdfFileDataCache.delete(filePath);
    // Also clear all cached pages for this file
    for (const key of pdfPageCache.keys()) {
      if (key.startsWith(filePath + '_')) {
        pdfPageCache.delete(key);
      }
    }
  }
}

// Aggressive cache cleanup when memory is high
function cleanupCache() {
  // Clear oldest pages until we're under limit
  while (pdfPageCache.size > CACHE_CONFIG.MAX_PAGE_CACHE_SIZE / 2) {
    const firstKey = pdfPageCache.keys().next().value;
    if (firstKey) {
      pdfPageCache.delete(firstKey);
    } else {
      break;
    }
  }

  // Clear oldest PDF document
  while (pdfDocumentCache.size > CACHE_CONFIG.MAX_PDF_DOC_CACHE_SIZE / 2) {
    const firstKey = pdfDocumentCache.keys().next().value;
    if (firstKey) {
      pdfDocumentCache.delete(firstKey);
    } else {
      break;
    }
  }

  // Clear oldest file data
  while (pdfFileDataCache.size > CACHE_CONFIG.MAX_FILE_DATA_CACHE_SIZE / 2) {
    const firstKey = pdfFileDataCache.keys().next().value;
    if (firstKey) {
      pdfFileDataCache.delete(firstKey);
    } else {
      break;
    }
  }

  if (DEBUG_MODE) {
    console.log(`[MEMORY] Cache cleaned. Pages: ${pdfPageCache.size}, Docs: ${pdfDocumentCache.size}, FileData: ${pdfFileDataCache.size}`);
  }
}

/**
 * Get cached PDF file data or load and cache it
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<Uint8Array>} PDF file data
 */
async function getCachedFileData(filePath) {
  let fileData = pdfFileDataCache.get(filePath);
  if (!fileData) {
    fileData = await window.pdfAPI.readFile(filePath);
    if (pdfFileDataCache.size >= CACHE_CONFIG.MAX_FILE_DATA_CACHE_SIZE) {
      const firstKey = pdfFileDataCache.keys().next().value;
      pdfFileDataCache.delete(firstKey);
    }
    pdfFileDataCache.set(filePath, fileData);
  }
  return fileData;
}

window.renderPDFPage = async (filePath, pageNum, canvas, scale) => {
  const renderStartTime = performance.now();

  try {
    // Ensure PDF.js is loaded
    const lib = await initPDFJS();
    if (!lib) {
      throw new Error('PDF.js not loaded');
    }

    // Use cached file data or read new
    const fileData = await getCachedFileData(filePath);
    const typedArray = new Uint8Array(fileData);

    // Use cached PDF document or create new one
    let pdf = pdfDocumentCache.get(filePath);
    if (!pdf) {
      // Load with worker to avoid blocking main thread
      pdf = await lib.getDocument({
        data: typedArray,
        workerSrc: window.pdfWorkerSrc,
        // Disable features for faster loading and less memory
        disableFontFace: true,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true,
        disableCreateObjectURL: true,
        useSystemFonts: true,
        cMapUrl: null,
        cMapPacked: false
      }).promise;

      // Cache the document
      if (pdfDocumentCache.size >= CACHE_CONFIG.MAX_PDF_DOC_CACHE_SIZE) {
        const firstKey = pdfDocumentCache.keys().next().value;
        pdfDocumentCache.delete(firstKey);
      }
      pdfDocumentCache.set(filePath, pdf);
    }

    // Try to get page from cache first
    const cacheKey = `${filePath}_${pageNum}`;
    let page = pdfPageCache.get(cacheKey);

    if (!page) {
      // Cleanup cache before loading new page to avoid OOM
      if (pdfPageCache.size >= CACHE_CONFIG.MAX_PAGE_CACHE_SIZE) {
        cleanupCache();
      }

      page = await pdf.getPage(pageNum);

      // Cache the page with LRU eviction
      if (pdfPageCache.size >= CACHE_CONFIG.MAX_PAGE_CACHE_SIZE) {
        const firstKey = pdfPageCache.keys().next().value;
        pdfPageCache.delete(firstKey);
      }
      pdfPageCache.set(cacheKey, page);
    }

    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');

    // Use native canvas rendering (faster than SVG)
    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport,
      renderInteractiveForms: false,
      intent: 'display',
      // Use faster rendering mode
      transform: null
    });
    await renderTask.promise;

    // Performance logging
    const renderTime = performance.now() - renderStartTime;
    renderPerformance.lastRenderTime = renderTime;
    renderPerformance.renderCount++;

    if (DEBUG_MODE) {
      console.log(`[PERF] Rendered page ${pageNum} in ${renderTime.toFixed(2)}ms (${canvas.width}x${canvas.height})`);
    }

    return {
      width: viewport.width,
      height: viewport.height,
      pageNum
    };
  } catch (error) {
    console.error('renderPDFPage error:', error);
    throw error;
  }
};

// DOM Elements - will be initialized in initEventListeners
let welcomeOpenBtn;
let openFileBtn;
let uploadPlaceholder;
let thumbnailContainer;
let thumbnailList;
let welcomePanel;
let toolProperties;
let quickActions;
let pageNavSection;
let actionsSection;
let pageManagementSection;
let exportSection;
let securitySection;
let canvasWrapper;
let pagesContainer;  // Multi-page container for continuous scroll
let statusMessage;
let pageStatus;
let dimensionsStatus;
let zoomStatus;
let zoomLevel;

// Initialize event listeners
function initEventListeners() {
  // Initialize DOM elements
  welcomeOpenBtn = document.getElementById('welcomeOpenBtn');
  openFileBtn = document.getElementById('openFileBtn');
  uploadPlaceholder = document.getElementById('uploadPlaceholder');
  thumbnailContainer = document.getElementById('thumbnailContainer');
  thumbnailList = document.getElementById('thumbnailList');
  welcomePanel = document.getElementById('welcomePanel');
  toolProperties = document.getElementById('toolProperties');
  quickActions = document.getElementById('quickActions');
  pageNavSection = document.getElementById('pageNavSection');
  actionsSection = document.getElementById('actionsSection');
  pageManagementSection = document.getElementById('pageManagementSection');
  exportSection = document.getElementById('exportSection');
  securitySection = document.getElementById('securitySection');
  canvasWrapper = document.getElementById('canvasWrapper');
  pagesContainer = document.getElementById('pagesContainer');
  statusMessage = document.getElementById('statusMessage');
  pageStatus = document.getElementById('pageStatus');
  dimensionsStatus = document.getElementById('dimensionsStatus');
  zoomStatus = document.getElementById('zoomStatus');
  zoomLevel = document.getElementById('zoomLevel');

  async function openPdfDialog() {
    const result = await window.pdfAPI.pickPDF();
    if (!result.canceled && result.filePaths.length > 0) {
      const files = result.filePaths.map(path => ({
        path,
        name: path.split('/').pop() || path.split('\\').pop()
      }));
      await handleSelectedFiles(files);
    }
  }

  function handleMenuAction(action) {
    switch (action) {
      case 'file':
        openPdfDialog().catch(handleError);
        break;
      case 'edit':
        handleUndo();
        break;
      case 'view':
        const leftSidebar = document.getElementById('leftSidebar');
        const rightSidebar = document.getElementById('rightSidebar');
        if (leftSidebar) leftSidebar.classList.toggle('collapsed');
        if (rightSidebar) rightSidebar.classList.toggle('collapsed');
        updateStatus('已切换侧边栏');
        break;
      case 'tools':
        selectTool('select');
        break;
      case 'help':
        openHelpModal();
        break;
      default:
        break;
    }
  }

  // Help Modal
  function openHelpModal() {
    const modal = document.getElementById('helpModal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  function closeHelpModal() {
    const modal = document.getElementById('helpModal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  // Help modal event listeners
  const closeHelpModalBtn = document.getElementById('closeHelpModalBtn');
  if (closeHelpModalBtn) {
    closeHelpModalBtn.addEventListener('click', closeHelpModal);
  }

  const closeHelpModalX = document.getElementById('closeHelpModal');
  if (closeHelpModalX) {
    closeHelpModalX.addEventListener('click', closeHelpModal);
  }

  // Close modal when clicking on overlay
  const helpModalOverlay = document.getElementById('helpModal');
  if (helpModalOverlay) {
    helpModalOverlay.addEventListener('click', (e) => {
      if (e.target === helpModalOverlay) {
        closeHelpModal();
      }
    });
  }

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      handleMenuAction(item.dataset.action);
    });
  });

  // File operations - use native file dialog
  if (openFileBtn) {
    openFileBtn.addEventListener('click', async () => {
      try {
        await openPdfDialog();
      } catch (error) {
        console.error('Error picking PDF:', error);
        handleError(error);
      }
    });
  }
  if (welcomeOpenBtn) {
    welcomeOpenBtn.addEventListener('click', async () => {
      try {
        await openPdfDialog();
      } catch (error) {
        console.error('Error picking PDF:', error);
        handleError(error);
      }
    });
  }

  // Upload placeholder click - also use native dialog
  if (uploadPlaceholder) {
    uploadPlaceholder.addEventListener('click', async () => {
      try {
        await openPdfDialog();
      } catch (error) {
        console.error('Error picking PDF:', error);
      }
    });
    uploadPlaceholder.addEventListener('dragover', handleDragOver);
    uploadPlaceholder.addEventListener('dragleave', handleDragLeave);
    uploadPlaceholder.addEventListener('drop', handleFileDrop);
  }

  // Tool buttons
  const toolButtons = document.querySelectorAll('.tool-btn');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      selectTool(tool);
    });
  });

  // Sidebar toggles
  const leftSidebarToggle = document.getElementById('leftSidebarToggle');
  const rightSidebarToggle = document.getElementById('rightSidebarToggle');
  const leftSidebar = document.getElementById('leftSidebar');
  const rightSidebar = document.getElementById('rightSidebar');

  if (leftSidebarToggle && leftSidebar) {
    leftSidebarToggle.addEventListener('click', () => {
      leftSidebar.classList.toggle('collapsed');
      leftSidebarToggle.textContent = leftSidebar.classList.contains('collapsed') ? '◀' : '▶';
    });
  }

  if (rightSidebarToggle && rightSidebar) {
    rightSidebarToggle.addEventListener('click', () => {
      rightSidebar.classList.toggle('collapsed');
      rightSidebarToggle.textContent = rightSidebar.classList.contains('collapsed') ? '▶' : '◀';
    });
  }

  // Sidebar tabs (Pages/Bookmarks)
  const sidebarTabs = document.querySelectorAll('.sidebar-tab');
  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      sidebarTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tabName + 'Tab').classList.add('active');
    });
  });

  // Bookmarks state
  let currentBookmarks = [];

  // Bookmark functions
  async function loadBookmarks() {
    if (!currentPdfPath) return;

    try {
      const bookmarks = await window.pdfAPI.getBookmarks(currentPdfPath);
      currentBookmarks = bookmarks || [];
      renderBookmarks();
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
    }
  }

  function renderBookmarks() {
    const bookmarksList = document.getElementById('bookmarksList');
    if (!bookmarksList) return;

    if (currentBookmarks.length === 0) {
      bookmarksList.innerHTML = '<div class="bookmarks-empty">暂无书签<br>点击"添加书签"创建</div>';
      return;
    }

    bookmarksList.innerHTML = currentBookmarks.map((bm, index) => `
      <div class="bookmark-item" data-index="${index}">
        <span class="bookmark-title">${escapeHtml(bm.title)}</span>
        <span class="bookmark-page">第 ${bm.page} 页</span>
        <button class="bookmark-delete" data-index="${index}" title="删除书签">&times;</button>
      </div>
    `).join('');

    // Add click handlers
    bookmarksList.querySelectorAll('.bookmark-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-delete')) return;
        const index = parseInt(item.dataset.index);
        const bm = currentBookmarks[index];
        if (bm.page) {
          goToPage(bm.page);
        }
      });
    });

    bookmarksList.querySelectorAll('.bookmark-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        await deleteBookmark(index);
      });
    });
  }

  async function deleteBookmark(index) {
    if (!currentPdfPath) return;

    const bm = currentBookmarks[index];
    currentBookmarks.splice(index, 1);

    try {
      const buffer = await window.pdfAPI.addBookmarks(currentPdfPath, currentBookmarks);
      await window.pdfAPI.writeFile(currentPdfPath, Array.from(buffer));
      renderBookmarks();
    } catch (error) {
      console.error('Failed to delete bookmark:', error);
      currentBookmarks.splice(index, 0, bm); // restore on error
    }
  }

  // Bookmark modal
  const bookmarkModal = document.getElementById('bookmarkModal');
  const addBookmarkBtn = document.getElementById('addBookmarkBtn');
  const closeBookmarkModal = document.getElementById('closeBookmarkModal');
  const cancelBookmarkBtn = document.getElementById('cancelBookmarkBtn');
  const saveBookmarkBtn = document.getElementById('saveBookmarkBtn');
  const bookmarkTitleInput = document.getElementById('bookmarkTitle');
  const bookmarkPageInput = document.getElementById('bookmarkPage');

  let editingBookmarkIndex = -1;

  function openBookmarkModal(pageNum = null) {
    editingBookmarkIndex = -1;
    document.getElementById('bookmarkModalTitle').textContent = '添加书签';
    bookmarkTitleInput.value = '';
    bookmarkPageInput.value = pageNum || currentPage;
    bookmarkModal.classList.add('active');
    bookmarkTitleInput.focus();
  }

  function closeBookmarkModalFunc() {
    bookmarkModal.classList.remove('active');
  }

  async function saveBookmark() {
    const title = bookmarkTitleInput.value.trim();
    const page = parseInt(bookmarkPageInput.value);

    if (!title) {
      alert('请输入书签标题');
      return;
    }
    if (!page || page < 1 || page > totalPages) {
      alert('请输入有效的页码');
      return;
    }

    if (!currentPdfPath) return;

    const newBookmark = { title, page };
    currentBookmarks.push(newBookmark);

    try {
      const buffer = await window.pdfAPI.addBookmarks(currentPdfPath, currentBookmarks);
      await window.pdfAPI.writeFile(currentPdfPath, Array.from(buffer));
      closeBookmarkModalFunc();
      renderBookmarks();
    } catch (error) {
      console.error('Failed to save bookmark:', error);
      currentBookmarks.pop();
      alert('保存书签失败');
    }
  }

  if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', () => openBookmarkModal());
  if (closeBookmarkModal) closeBookmarkModal.addEventListener('click', closeBookmarkModalFunc);
  if (cancelBookmarkBtn) cancelBookmarkBtn.addEventListener('click', closeBookmarkModalFunc);
  if (saveBookmarkBtn) saveBookmarkBtn.addEventListener('click', saveBookmark);

  // Zoom controls
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

  if (zoomInBtn) zoomInBtn.addEventListener('click', () => setZoom(currentZoom + 10));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setZoom(currentZoom - 10));

  // Page navigation
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageInput = document.getElementById('pageInput');

  if (prevPageBtn) prevPageBtn.addEventListener('click', goToPrevPage);
  if (nextPageBtn) nextPageBtn.addEventListener('click', goToNextPage);
  if (pageInput) {
    pageInput.addEventListener('change', (e) => {
      const pageNum = parseInt(e.target.value);
      if (pageNum >= 1 && pageNum <= totalPages) {
        goToPage(pageNum);
      }
    });
  }

  // Action buttons
  const undoBtn = document.getElementById('undoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveEditBtn = document.getElementById('saveEditBtn');

  if (undoBtn) undoBtn.addEventListener('click', handleUndo);
  if (clearBtn) clearBtn.addEventListener('click', handleClearAll);
  if (saveEditBtn) saveEditBtn.addEventListener('click', handleSavePDF);

  // Toolbar buttons
  const undoToolbarBtn = document.getElementById('undoToolbarBtn');
  const redoToolbarBtn = document.getElementById('redoToolbarBtn');
  const saveBtn = document.getElementById('saveBtn');

  if (undoToolbarBtn) undoToolbarBtn.addEventListener('click', handleUndo);
  if (redoToolbarBtn) redoToolbarBtn.addEventListener('click', handleRedo);
  if (saveBtn) saveBtn.addEventListener('click', handleSavePDF);

  // Quick actions
  const quickMergeBtn = document.getElementById('quickMergeBtn');
  const quickSplitBtn = document.getElementById('quickSplitBtn');
  const quickWatermarkBtn = document.getElementById('quickWatermarkBtn');

  if (quickMergeBtn) quickMergeBtn.addEventListener('click', handleMerge);
  if (quickSplitBtn) quickSplitBtn.addEventListener('click', handleSplit);
  if (quickWatermarkBtn) quickWatermarkBtn.addEventListener('click', handleWatermark);

  // Select image button - use native file picker
  const selectImageBtn = document.getElementById('selectImageBtn');
  if (selectImageBtn) {
    selectImageBtn.addEventListener('click', async () => {
      const result = await window.pdfAPI.pickImage();
      if (!result.canceled && result.filePaths.length > 0) {
        const imageFile = {
          path: result.filePaths[0],
          name: result.filePaths[0].split('/').pop()
        };
        // Read image and convert to data URL via IPC
        const imageBuffer = await window.pdfAPI.readFile(imageFile.path);
        const ext = imageFile.path.split('.').pop().toLowerCase();
        const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
        // Convert array buffer to base64 using bufferHelper
        const base64Data = window.bufferHelper.toBase64(imageBuffer);
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        // Trigger image selection handler
        selectedImageName = imageFile.name;
        const nameEl = document.getElementById('selectedImageName');
        if (nameEl) nameEl.textContent = selectedImageName;
        selectedImageData = dataUrl;
        if (pdfEditor) {
          pdfEditor.setOptions({ currentImage: selectedImageData });
        }
        updateStatus(`图片已选择：${selectedImageName}`);
      }
    });
  }

  // Page management buttons
  const rotateLeftBtn = document.getElementById('rotateLeftBtn');
  const rotateRightBtn = document.getElementById('rotateRightBtn');
  const deletePageBtn = document.getElementById('deletePageBtn');

  if (rotateLeftBtn) rotateLeftBtn.addEventListener('click', () => handleRotatePage(-90));
  if (rotateRightBtn) rotateRightBtn.addEventListener('click', () => handleRotatePage(90));
  if (deletePageBtn) deletePageBtn.addEventListener('click', handleDeletePage);

  // Export buttons
  const exportCurrentPageBtn = document.getElementById('exportCurrentPageBtn');
  const exportAllPagesBtn = document.getElementById('exportAllPagesBtn');

  if (exportCurrentPageBtn) exportCurrentPageBtn.addEventListener('click', () => handleExportImage('current'));
  if (exportAllPagesBtn) exportAllPagesBtn.addEventListener('click', () => handleExportImage('all'));

  // Security button
  const protectPdfBtn = document.getElementById('protectPdfBtn');
  if (protectPdfBtn) protectPdfBtn.addEventListener('click', handleProtectPDF);

  // Tool options
  setupToolOptions();
}

// Setup tool option controls
function setupToolOptions() {
  // Eraser size
  const eraserSizeSlider = document.getElementById('eraserSize');
  const eraserSizeValue = document.getElementById('eraserSizeValue');
  if (eraserSizeSlider && eraserSizeValue) {
    eraserSizeSlider.addEventListener('input', (e) => {
      const size = e.target.value;
      eraserSizeValue.textContent = size;
      if (pdfEditor) {
        pdfEditor.setOptions({ eraserSize: parseInt(size) });
      }
    });
  }

  // Font size
  const fontSizeSlider = document.getElementById('fontSize');
  const fontSizeValue = document.getElementById('fontSizeValue');
  if (fontSizeSlider && fontSizeValue) {
    fontSizeSlider.addEventListener('input', (e) => {
      const size = e.target.value;
      fontSizeValue.textContent = size;
      if (pdfEditor) {
        pdfEditor.setOptions({ fontSize: parseInt(size) });
      }
    });
  }

  // Text color
  const textColorPicker = document.getElementById('textColor');
  const textColorValue = document.getElementById('textColorValue');
  if (textColorPicker && textColorValue) {
    textColorPicker.addEventListener('input', (e) => {
      const color = e.target.value;
      if (textColorValue) textColorValue.textContent = color;
      if (pdfEditor) {
        pdfEditor.setOptions({ textColor: color });
      }
    });
  }

  // Font family
  const fontFamilySelect = document.getElementById('fontFamily');
  if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', (e) => {
      const font = e.target.value;
      if (pdfEditor) {
        pdfEditor.setOptions({ fontFamily: font });
      }
    });
  }

  // Highlight color
  const highlightColorPicker = document.getElementById('highlightColor');
  const highlightColorValue = document.getElementById('highlightColorValue');
  if (highlightColorPicker && highlightColorValue) {
    highlightColorPicker.addEventListener('input', (e) => {
      const color = e.target.value;
      if (highlightColorValue) highlightColorValue.textContent = color;
      if (pdfEditor) {
        pdfEditor.setOptions({ highlightColor: color });
      }
    });
  }

  // Underline color
  const underlineColorPicker = document.getElementById('underlineColor');
  const underlineColorValue = document.getElementById('underlineColorValue');
  if (underlineColorPicker && underlineColorValue) {
    underlineColorPicker.addEventListener('input', (e) => {
      const color = e.target.value;
      if (underlineColorValue) underlineColorValue.textContent = color;
      if (pdfEditor) {
        pdfEditor.setOptions({ underlineColor: color });
      }
    });
  }
}

// Select active tool
function selectTool(tool) {
  currentTool = tool;

  // Update button states
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  // Show/hide tool options
  document.querySelectorAll('.property-group').forEach(group => {
    group.style.display = 'none';
  });

  const optionsMap = {
    'eraser': 'eraserOptions',
    'text': 'textOptions',
    'image': 'imageOptions',
    'highlight': 'highlightOptions',
    'underline': 'underlineOptions'
  };

  if (optionsMap[tool]) {
    document.getElementById(optionsMap[tool]).style.display = 'block';
  }

  // Set tool in editor
  if (pdfEditor) {
    const editorTool = tool === 'select' || tool === 'hand' ? null : tool;
    pdfEditor.setTool(editorTool);
  }

  updateStatus(`工具：${getToolName(tool)}`);
}

function getToolName(tool) {
  const names = {
    'select': '选择',
    'hand': '抓手',
    'text': '文本',
    'image': '图片',
    'eraser': '橡皮擦',
    'highlight': '高亮',
    'underline': '下划线'
  };
  return names[tool] || tool;
}

// Handle selected files from native dialog
async function handleSelectedFiles(files) {
  selectedFiles = files;
  if (selectedFiles.length > 0) {
    const newPdfPath = selectedFiles[0].path;

    // Clear cache for old PDF if switching to a new file
    if (currentPdfPath && currentPdfPath !== newPdfPath) {
      window.clearPDFDocumentCache(currentPdfPath);
    }

    currentPdfPath = newPdfPath;
    updateStatus(`已选择：${selectedFiles[0].name}`);

    // Clear thumbnail cache when opening a new PDF
    renderedThumbnails.clear();
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
      thumbnailObserver = null;
    }

    // Cancel any existing background page loading
    if (backgroundPageLoader) {
      backgroundPageLoader.cancel = true;
      backgroundPageLoader = null;
    }

    // Update UI
    if (uploadPlaceholder) uploadPlaceholder.style.display = 'none';
    if (thumbnailList) thumbnailList.style.display = 'flex';
    if (welcomePanel) welcomePanel.style.display = 'none';
    if (quickActions) quickActions.style.display = 'flex';

    // Initialize editor
    await initEditor();

    // Load bookmarks for the new PDF
    await loadBookmarks();

    updateStatus('文件已加载，选择工具开始编辑');
  }
}

// Handle drag and drop
async function handleFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const files = Array.from(e.dataTransfer.files).map(file => ({
    path: file.path,
    name: file.name
  }));
  await handleSelectedFiles(files);
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  if (uploadPlaceholder) {
    uploadPlaceholder.style.borderColor = 'var(--primary-color)';
    uploadPlaceholder.style.background = 'rgba(20, 115, 230, 0.1)';
  }
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  if (uploadPlaceholder) {
    uploadPlaceholder.style.borderColor = '';
    uploadPlaceholder.style.background = '';
  }
}

// Thumbnail rendering state for lazy loading
const renderedThumbnails = new Set();
let thumbnailObserver = null; // Store observer for cleanup

// Generate page thumbnails with lazy loading
async function generateThumbnails() {
  if (!currentPdfPath || !pdfEditor) return;

  // For large PDFs, limit initial thumbnail generation
  // User can scroll to trigger more thumbnails via IntersectionObserver
  const initialThumbnailCount = totalPages > 100 ? 30 : totalPages > 50 ? 50 : totalPages;

  thumbnailList.innerHTML = '';

  // Create thumbnail placeholders first (no rendering)
  for (let i = 1; i <= totalPages; i++) {
    const thumbnailItem = document.createElement('div');
    thumbnailItem.className = 'thumbnail-item';
    thumbnailItem.dataset.page = i;

    const canvas = document.createElement('canvas');
    canvas.className = 'thumbnail-canvas';
    // Use smaller fixed size for placeholders
    canvas.width = 100;
    canvas.height = 140;
    // Draw placeholder background
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 100, 140);
    ctx.fillStyle = '#ccc';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`第 ${i} 页`, 50, 70);

    const pageNum = document.createElement('div');
    pageNum.className = 'thumbnail-number';
    pageNum.textContent = '';

    thumbnailItem.appendChild(canvas);
    thumbnailItem.appendChild(pageNum);
    thumbnailList.appendChild(thumbnailItem);

    // Add click handler
    thumbnailItem.addEventListener('click', () => {
      goToPage(i);
    });
  }

  // Start lazy rendering
  renderThumbnailsLazy();
}

// Render thumbnails lazily using Intersection Observer
function renderThumbnailsLazy() {
  if (!('IntersectionObserver' in window)) {
    // Fallback: render all at once for older browsers
    renderThumbnailBatch(1, Math.min(10, totalPages));
    return;
  }

  // Cleanup previous observer if exists
  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
  }

  const observerOptions = {
    root: thumbnailList,
    rootMargin: '50px', // Reduced from 100px
    threshold: 0.1 // Added threshold to ensure item is somewhat visible
  };

  thumbnailObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const page = parseInt(entry.target.dataset.page);
        if (!renderedThumbnails.has(page)) {
          // Use requestAnimationFrame for smoother rendering
          requestAnimationFrame(() => {
            renderThumbnail(page);
          });
          renderedThumbnails.add(page);
          thumbnailObserver.unobserve(entry.target);
        }
      }
    });
  }, observerOptions);

  // Observe all thumbnail items
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    thumbnailObserver.observe(item);
  });
}

// Render a single thumbnail
async function renderThumbnail(pageNum) {
  try {
    const thumbnailItem = document.querySelector(`.thumbnail-item[data-page="${pageNum}"]`);
    if (!thumbnailItem) return;

    const canvas = thumbnailItem.querySelector('.thumbnail-canvas');

    // Use cached PDF document
    let pdf = pdfDocumentCache.get(currentPdfPath);

    if (!pdf) {
      const fileData = await getCachedFileData(currentPdfPath);
      const lib = await initPDFJS();
      const typedArray = new Uint8Array(fileData);

      pdf = await lib.getDocument({
        data: typedArray,
        workerSrc: window.pdfWorkerSrc,
        disableFontFace: true,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true
      }).promise;

      if (pdfDocumentCache.size >= CACHE_CONFIG.MAX_PDF_DOC_CACHE_SIZE) {
        const firstKey = pdfDocumentCache.keys().next().value;
        pdfDocumentCache.delete(firstKey);
      }
      pdfDocumentCache.set(currentPdfPath, pdf);
    }

    const page = await pdf.getPage(pageNum);
    // Use very small scale for thumbnails (performance optimization)
    const viewport = page.getViewport({ scale: CACHE_CONFIG.THUMBNAIL_SCALE });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');

    // Use low priority rendering for thumbnails
    await page.render({
      canvasContext: ctx,
      viewport: viewport,
      intent: 'display'
    }).promise;

    if (DEBUG_MODE) {
      console.log(`[THUMBNAIL] Rendered page ${pageNum}`);
    }
  } catch (error) {
    if (DEBUG_MODE) {
      console.error(`Failed to render thumbnail for page ${pageNum}:`, error);
    }
  }
}

// Render a batch of thumbnails (fallback for older browsers)
async function renderThumbnailBatch(startPage, endPage) {
  const fileData = await getCachedFileData(currentPdfPath);
  const lib = await initPDFJS();
  const typedArray = new Uint8Array(fileData);

  // Use cached PDF document
  let pdf = pdfDocumentCache.get(currentPdfPath);
  if (!pdf) {
    pdf = await lib.getDocument({
      data: typedArray,
      workerSrc: window.pdfWorkerSrc,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true
    }).promise;
    if (pdfDocumentCache.size >= CACHE_CONFIG.MAX_PDF_DOC_CACHE_SIZE) {
      const firstKey = pdfDocumentCache.keys().next().value;
      pdfDocumentCache.delete(firstKey);
    }
    pdfDocumentCache.set(currentPdfPath, pdf);
  }

  // Render thumbnails with delay to avoid blocking UI
  for (let i = startPage; i <= endPage; i++) {
    if (renderedThumbnails.has(i)) continue;

    try {
      const thumbnailItem = document.querySelector(`.thumbnail-item[data-page="${i}"]`);
      if (!thumbnailItem) continue;

      const canvas = thumbnailItem.querySelector('.thumbnail-canvas');

      // Use cached page if available
      const cacheKey = `${currentPdfPath}_${i}`;
      let page = pdfPageCache.get(cacheKey);
      if (!page) {
        // Cleanup cache before loading new page
        if (pdfPageCache.size >= CACHE_CONFIG.MAX_PAGE_CACHE_SIZE) {
          cleanupCache();
        }
        page = await pdf.getPage(i);
      }

      const viewport = page.getViewport({ scale: CACHE_CONFIG.THUMBNAIL_SCALE });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      renderedThumbnails.add(i);
    } catch (error) {
      console.error(`Failed to render thumbnail for page ${i}:`, error);
    }

    // Yield to UI thread more frequently for large PDFs
    // Render 2-3 thumbnails per batch before yielding to avoid blocking UI
    const batchSize = totalPages > 50
      ? CACHE_CONFIG.THUMBNAIL_BATCH_SIZE_LARGE
      : CACHE_CONFIG.THUMBNAIL_BATCH_SIZE_SMALL;
    if (i % batchSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

// Render all pages for continuous scroll view
async function renderAllPages() {
  if (!pagesContainer) return;

  pagesContainer.innerHTML = '';

  // Limit initial rendering for large PDFs to avoid memory issues
  const maxInitialPages = totalPages > 100
    ? CACHE_CONFIG.MAX_INITIAL_PAGES_LARGE
    : totalPages;

  for (let pageNum = 1; pageNum <= maxInitialPages; pageNum++) {
    try {
      await renderPageCanvas(pageNum);
    } catch (error) {
      console.error(`Failed to render page ${pageNum}:`, error);
    }

    // Yield to main thread periodically for better responsiveness
    if (pageNum % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  // Setup canvas event delegation for multi-page editing
  setupMultiPageEditing();
}

// Render a single page canvas
async function renderPageCanvas(pageNum) {
  const pageWrapper = document.createElement('div');
  pageWrapper.className = 'page-canvas-wrapper';
  pageWrapper.dataset.page = pageNum;

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'page-canvas-container';

  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';
  canvas.id = `pdfCanvas_${pageNum}`;

  const editOverlay = document.createElement('div');
  editOverlay.className = 'page-edit-overlay';
  editOverlay.id = `editOverlay_${pageNum}`;

  const pageNumber = document.createElement('div');
  pageNumber.className = 'page-number-indicator';
  pageNumber.textContent = `第 ${pageNum} 页`;

  canvasContainer.appendChild(canvas);
  canvasContainer.appendChild(editOverlay);
  pageWrapper.appendChild(canvasContainer);
  pageWrapper.appendChild(pageNumber);
  pagesContainer.appendChild(pageWrapper);

  // Render PDF page to canvas
  const pageInfo = await window.renderPDFPage(
    currentPdfPath,
    pageNum,
    canvas,
    pdfEditor ? pdfEditor.scale : 1.0
  );

  // Set container size
  canvasContainer.style.width = `${pageInfo.width}px`;
  canvasContainer.style.height = `${pageInfo.height}px`;

  // Cache background for this page (for smooth editing)
  const ctx = canvas.getContext('2d', { alpha: false });
  const backgroundCache = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Store background cache on the canvas element itself
  canvas.dataset.backgroundCache = JSON.stringify({
    width: canvas.width,
    height: canvas.height,
    data: Array.from(backgroundCache.data)
  });

  // Update dimensions for first page
  if (pageNum === 1 && pdfEditor) {
    pdfEditor.pageWidth = pageInfo.width;
    pdfEditor.pageHeight = pageInfo.height;
    updateDimensions(pageInfo.width, pageInfo.height);
  }
}

// Setup multi-page editing support
function setupMultiPageEditing() {
  if (!pdfEditor) return;

  // Find all page canvases and setup event listeners
  document.querySelectorAll('.page-canvas').forEach((canvas) => {
    const pageNum = parseInt(canvas.id.split('_')[1]);

    // Setup event listeners for each page canvas
    canvas.style.imageRendering = 'optimizeSpeed';
    canvas.addEventListener('mousedown', (e) => handlePageMouseDown(e, pageNum));
    canvas.addEventListener('mousemove', (e) => handlePageMouseMove(e, pageNum));
    canvas.addEventListener('mouseup', (e) => handlePageMouseUp(e, pageNum));
    canvas.addEventListener('mouseleave', (e) => handlePageMouseLeave(e, pageNum));
  });
}

// Page-specific mouse event handlers
function handlePageMouseDown(e, pageNum) {
  if (!pdfEditor) return;

  // Set current page for operation tracking
  pdfEditor.currentPage = pageNum;
  pdfEditor.canvas = e.target;
  pdfEditor.ctx = e.target.getContext('2d', { alpha: false });

  // Get page dimensions from canvas container
  const container = e.target.parentElement;
  pdfEditor.pageWidth = parseFloat(container.style.width) || e.target.width;
  pdfEditor.pageHeight = parseFloat(container.style.height) || e.target.height;

  // Load background cache from canvas dataset if available
  if (e.target.dataset.backgroundCache) {
    try {
      const cached = JSON.parse(e.target.dataset.backgroundCache);
      pdfEditor.backgroundCache = new ImageData(
        new Uint8ClampedArray(cached.data),
        cached.width,
        cached.height
      );
    } catch (err) {
      console.error('Failed to load background cache:', err);
    }
  }

  pdfEditor.handleMouseDown(e);
}

function handlePageMouseMove(e, pageNum) {
  if (!pdfEditor) return;
  pdfEditor.currentPage = pageNum;
  pdfEditor.canvas = e.target;
  pdfEditor.ctx = e.target.getContext('2d', { alpha: false });
  pdfEditor.handleMouseMove(e);
}

function handlePageMouseUp(e, pageNum) {
  if (!pdfEditor) return;
  pdfEditor.currentPage = pageNum;
  pdfEditor.canvas = e.target;
  pdfEditor.ctx = e.target.getContext('2d', { alpha: false });
  pdfEditor.handleMouseUp(e);
}

function handlePageMouseLeave(e, pageNum) {
  if (!pdfEditor) return;
  pdfEditor.currentPage = pageNum;
  pdfEditor.canvas = e.target;
  pdfEditor.ctx = e.target.getContext('2d', { alpha: false });
  pdfEditor.handleMouseLeave(e);
}

// Initialize PDF editor
async function initEditor() {
  try {
    updateStatus('正在加载编辑器...');

    pdfEditor = new PDFEditor();
    const info = await pdfEditor.init(pdfCanvas, currentPdfPath);
    totalPages = info.totalPages;
    currentPage = 1;

    // Set up page change handler for UI navigation (buttons, thumbnails)
    pdfEditor.setPageChangeHandler((pageNum) => {
      scrollToPage(pageNum);
    });

    updatePageInfo();

    // Render all pages for continuous scroll view
    await renderAllPages();

    // Show editor UI
    if (toolProperties) toolProperties.style.display = 'block';
    if (pageNavSection) pageNavSection.style.display = 'block';
    if (actionsSection) actionsSection.style.display = 'block';
    if (pageManagementSection) pageManagementSection.style.display = 'block';
    if (exportSection) exportSection.style.display = 'block';
    if (securitySection) securitySection.style.display = 'block';

    // Select default tool
    selectTool('select');

    // Generate thumbnails after editor is initialized (use requestIdleCallback for better performance)
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => generateThumbnails(), { timeout: 1000 });
    } else {
      setTimeout(generateThumbnails, 100);
    }

    updateStatus('编辑器已就绪');

    // Start background page loading - load remaining pages one by one
    startBackgroundPageLoading();
  } catch (error) {
    console.error('Init editor error:', error);
    handleError(error);
    updateStatus('编辑器加载失败：' + error.message);
  }
}

// Background page loading - loads pages sequentially in idle time
function startBackgroundPageLoading() {
  if (backgroundPageLoader) {
    // Cancel any existing loading
    backgroundPageLoader.cancel = true;
  }

  const loadedPages = new Set();
  // Mark page 1 as loaded (already rendered)
  loadedPages.add(1);

  // For large PDFs, limit how many pages we preload to avoid OOM
  const MAX_PRELOAD_PAGES = totalPages > 100
    ? CACHE_CONFIG.MAX_PRELOAD_PAGES_LARGE
    : totalPages > 50
      ? CACHE_CONFIG.MAX_PRELOAD_PAGES_MEDIUM
      : CACHE_CONFIG.MAX_PRELOAD_PAGES_SMALL;

  // For very large PDFs, disable background loading entirely
  // Thumbnails will be loaded on-demand via IntersectionObserver
  if (totalPages > CACHE_CONFIG.DISABLE_BACKGROUND_LOADING_PAGES) {
    if (DEBUG_MODE) console.log('[BACKGROUND] Disabled for large PDF');
    return;
  }

  backgroundPageLoader = {
    cancel: false,
    loadNextPage: async () => {
      // Memory check - if cache is full, stop loading more pages
      if (pdfPageCache.size >= CACHE_CONFIG.MAX_PAGE_CACHE_SIZE) {
        if (DEBUG_MODE) console.log('[BACKGROUND] Stopped - cache full');
        return;
      }

      // Find next page to load (prioritize pages near current page)
      const pagesToLoad = [];
      for (let offset = 1; offset < totalPages; offset++) {
        // Load pages in a spiral pattern: current+1, current-1, current+2, current-2, ...
        const nextPages = [currentPage + offset, currentPage - offset];
        for (const p of nextPages) {
          if (p >= 1 && p <= totalPages && !loadedPages.has(p)) {
            pagesToLoad.push(p);
            if (pagesToLoad.length >= 2) break;
          }
        }
        if (pagesToLoad.length >= 2) break;
      }

      if (pagesToLoad.length === 0 || backgroundPageLoader.cancel) {
        if (DEBUG_MODE) console.log('[BACKGROUND] Loading complete');
        return;
      }

      // Limit total preloaded pages for large PDFs
      if (loadedPages.size >= MAX_PRELOAD_PAGES) {
        if (DEBUG_MODE) console.log(`[BACKGROUND] Reached preload limit: ${MAX_PRELOAD_PAGES}`);
        return;
      }

      // Load pages with delay to avoid blocking UI
      for (const pageNum of pagesToLoad) {
        if (backgroundPageLoader.cancel) return;

        // Check memory before loading each page
        if (pdfPageCache.size >= CACHE_CONFIG.MAX_PAGE_CACHE_SIZE) {
          cleanupCache();
        }

        try {
          const cacheKey = `${currentPdfPath}_${pageNum}`;
          if (!pdfPageCache.has(cacheKey)) {
            const lib = await initPDFJS();
            const pdf = pdfDocumentCache.get(currentPdfPath);
            if (pdf) {
              await pdf.getPage(pageNum);
              loadedPages.add(pageNum);
              if (DEBUG_MODE) console.log(`[BACKGROUND] Loaded page ${pageNum}`);
            }
          } else {
            loadedPages.add(pageNum);
          }
        } catch (error) {
          if (DEBUG_MODE) console.log(`[BACKGROUND] Failed to load page ${pageNum}:`, error.message);
        }

        // Wait between pages to keep UI responsive
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Continue loading next batch
      backgroundPageLoader.loadNextPage();
    }
  };

  // Start loading
  backgroundPageLoader.loadNextPage();
}

// Go to specific page (scroll to page in continuous view)
async function scrollToPage(pageNum) {
  if (!pagesContainer) return;

  currentPage = pageNum;
  updatePageInfo();

  // Scroll to the page
  const pageElement = pagesContainer.querySelector(`[data-page="${pageNum}"]`);
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Update thumbnail active state
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.page) === currentPage);
  });

  // Restart background loading with new priority when page changes
  if (backgroundPageLoader) {
    backgroundPageLoader.loadNextPage();
  }
}

// Alias for backward compatibility
async function goToPage(pageNum) {
  return scrollToPage(pageNum);
}

// Go to previous page
async function goToPrevPage() {
  if (currentPage > 1) {
    await goToPage(currentPage - 1);
  }
}

// Go to next page
async function goToNextPage() {
  if (currentPage < totalPages) {
    await goToPage(currentPage + 1);
  }
}

// Update page info
function updatePageInfo() {
  const pageInput = document.getElementById('pageInput');
  const totalPagesEl = document.getElementById('totalPages');

  if (pageInput) pageInput.value = currentPage;
  if (totalPagesEl) totalPagesEl.textContent = totalPages;
  if (pageStatus) pageStatus.textContent = `页面：${currentPage} / ${totalPages}`;
}

// Update dimensions display
function updateDimensions(width, height) {
  if (dimensionsStatus) {
    dimensionsStatus.textContent = `尺寸：${Math.round(width)} x ${Math.round(height)}`;
  }
}

// Set zoom level
function setZoom(level) {
  currentZoom = Math.max(25, Math.min(200, level));

  if (zoomLevel) zoomLevel.textContent = `${currentZoom}%`;
  if (zoomStatus) zoomStatus.textContent = `${currentZoom}%`;

  // Apply zoom to all page canvases
  document.querySelectorAll('.page-canvas-container').forEach((container) => {
    container.style.transform = `scale(${currentZoom / 100})`;
    container.style.transformOrigin = 'top center';
  });

  updateStatus(`缩放：${currentZoom}%`);

  // Re-render at higher resolution if zoom > 100%
  if (pdfEditor && currentZoom > 100) {
    // Debounce re-render to avoid rapid re-renders during zoom
    if (window.zoomRenderTimeout) {
      clearTimeout(window.zoomRenderTimeout);
    }
    window.zoomRenderTimeout = setTimeout(() => {
      const newScale = (currentZoom / 100) * pdfEditor.scale;
      if (newScale > pdfEditor.scale) {
        // Re-render all pages at higher resolution
        pdfEditor.scale = newScale;
        renderAllPages();
      }
    }, 500);
  }
}

// Handle undo
function handleUndo() {
  if (pdfEditor) {
    pdfEditor.undo();
    updateStatus('已撤销');
  }
}

// Handle redo
function handleRedo() {
  if (pdfEditor && pdfEditor.redo) {
    pdfEditor.redo();
    updateStatus('已重做');
  } else {
    updateStatus('没有可重做的操作');
  }
}

// Handle clear all
function handleClearAll() {
  if (pdfEditor && confirm('确定要清除所有编辑吗？')) {
    pdfEditor.clearAll();
    updateStatus('已清除所有编辑');
  }
}

// Handle save PDF
async function handleSavePDF() {
  try {
    if (!pdfEditor) return;

    const operations = pdfEditor.getOperations();
    if (operations.length === 0) {
      updateStatus('没有可保存的编辑');
      return;
    }

    updateStatus('正在应用编辑...');

    const modifiedBuffer = await pdfEditor.applyToPDF(currentPdfPath);

    if (window.pdfAPI) {
      const result = await window.pdfAPI.saveDialog('edited.pdf');
      if (!result.canceled && result.filePath) {
        await window.pdfAPI.writeFile(result.filePath, modifiedBuffer);
        updateStatus(`保存成功：${result.filePath}`);
      }
    } else {
      // Fallback: download directly
      const blob = new Blob([modifiedBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      updateStatus('保存成功');
    }
  } catch (error) {
    handleError(error);
  }
}

// Operation handlers
async function handleMerge() {
  try {
    // Open file picker to select multiple PDF files for merging
    updateStatus('请选择要合并的 PDF 文件（至少 2 个）');
    const result = await window.pdfAPI.pickPDF();

    if (result.canceled || !result.filePaths || result.filePaths.length < 2) {
      updateStatus('合并已取消：需要选择至少 2 个 PDF 文件');
      return;
    }

    currentOperation = 'merge';
    const filePaths = result.filePaths;

    updateStatus(`正在合并 ${filePaths.length} 个 PDF 文件...`);
    const mergedBuffer = await window.pdfAPI.merge(filePaths);

    // Extract filename from last selected file for naming
    const lastFileName = filePaths[filePaths.length - 1].split(/[\\/]/).pop().replace('.pdf', '');
    saveFile(mergedBuffer, `${lastFileName}_merged.pdf`);
    updateStatus(`合并完成，共 ${filePaths.length} 个文件`);
  } catch (error) {
    handleError(error);
  }
}

async function handleSplit() {
  try {
    // Use currently loaded PDF or prompt user to select one
    let pdfPath = currentPdfPath;

    if (!pdfPath) {
      updateStatus('请选择要拆分的 PDF 文件');
      const result = await window.pdfAPI.pickPDF();
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        updateStatus('拆分已取消');
        return;
      }
      pdfPath = result.filePaths[0];
    }

    // Get PDF info to show total pages
    const pdfInfo = await window.pdfAPI.loadPDF(pdfPath);
    const totalPages = pdfInfo.pageCount;

    currentOperation = 'split';
    const ranges = prompt(
      `输入拆分范围（如：1-3,4-5）\nPDF 共 ${totalPages} 页\n\n支持格式：\n- 单页：5\n- 范围：1-3\n- 多个范围：1-3,5,7-9`
    );
    if (!ranges) return;

    updateStatus('正在拆分 PDF...');
    const splitBuffers = await window.pdfAPI.split(pdfPath, ranges.split(','));
    splitBuffers.forEach((buffer, index) => {
      saveFile(buffer, `split_${index + 1}.pdf`);
    });
    updateStatus(`拆分完成，共 ${splitBuffers.length} 个文件`);
  } catch (error) {
    handleError(error);
  }
}

async function handleWatermark() {
  try {
    // Use currently loaded PDF or prompt user to select one
    let pdfPath = currentPdfPath;

    if (!pdfPath) {
      updateStatus('请选择要添加水印的 PDF 文件');
      const result = await window.pdfAPI.pickPDF();
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        updateStatus('操作已取消');
        return;
      }
      pdfPath = result.filePaths[0];
    }

    currentOperation = 'watermark';
    const watermarkText = prompt('输入水印文字');
    if (!watermarkText) return;

    updateStatus('正在添加水印...');
    const watermarkedBuffer = await window.pdfAPI.watermark(pdfPath, watermarkText);
    saveFile(watermarkedBuffer, 'watermarked.pdf');
    updateStatus('水印添加完成');
  } catch (error) {
    handleError(error);
  }
}

// Rotate page handler
async function handleRotatePage(degrees) {
  try {
    if (!currentPdfPath) {
      updateStatus('请先打开 PDF 文件');
      return;
    }

    updateStatus('正在旋转页面...');
    const rotatedBuffer = await window.pdfAPI.rotate(currentPdfPath, [currentPage], degrees);

    // Save back to original file
    await window.pdfAPI.writeFile(currentPdfPath, rotatedBuffer);
    updateStatus(`页面已旋转 ${degrees}°`);

    // Reload to show changes
    await reloadCurrentPDF();
  } catch (error) {
    handleError(error);
    updateStatus('旋转页面失败');
  }
}

// Delete page handler
async function handleDeletePage() {
  try {
    if (!currentPdfPath) {
      updateStatus('请先打开 PDF 文件');
      return;
    }

    if (!confirm(`确定要删除第 ${currentPage} 页吗？`)) {
      return;
    }

    updateStatus('正在删除页面...');
    const deletedBuffer = await window.pdfAPI.deletePages(currentPdfPath, [currentPage]);

    // Save the modified file back to original path
    await window.pdfAPI.writeFile(currentPdfPath, deletedBuffer);
    updateStatus(`页面已删除`);

    // Reload the PDF to show changes
    await reloadCurrentPDF();
  } catch (error) {
    handleError(error);
  }
}

// Export image handler
async function handleExportImage(mode) {
  try {
    if (!currentPdfPath) {
      updateStatus('请先打开 PDF 文件');
      return;
    }

    if (mode === 'current') {
      // Export current page
      const result = await window.pdfAPI.saveDialog('export.png');
      if (result.canceled || !result.filePath) return;

      updateStatus('正在导出图片...');

      // Create a canvas to render the PDF page
      const canvas = document.createElement('canvas');
      const lib = await initPDFJS();
      const fileData = await window.pdfAPI.readFile(currentPdfPath);
      const typedArray = new Uint8Array(fileData);
      const pdf = await lib.getDocument(typedArray).promise;
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: 2 });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      // Convert canvas to data URL and save
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];
      const buffer = window.bufferHelper.fromBase64(base64Data);
      await window.pdfAPI.writeFile(result.filePath, buffer);
      updateStatus(`图片已导出：${result.filePath}`);
    } else {
      // Export all pages - use queue to avoid blocking UI
      updateStatus('正在导出所有页面...');

      // Ask for output directory first
      const result = await window.pdfAPI.saveDialog('export_page_1.png');
      if (result.canceled || !result.filePath) return;

      // Get directory path from the selected file
      const outputPath = result.filePath;
      const lastSlash = Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\'));
      const dirPath = outputPath.substring(0, lastSlash);
      const baseName = outputPath.substring(lastSlash + 1).replace('_1.png', '');

      const lib = await initPDFJS();
      const fileData = await window.pdfAPI.readFile(currentPdfPath);
      const typedArray = new Uint8Array(fileData);
      const pdf = await lib.getDocument(typedArray).promise;
      const totalPages = pdf.numPages;

      // Export pages with yield to avoid blocking UI
      for (let i = 1; i <= totalPages; i++) {
        updateStatus(`正在导出第 ${i}/${totalPages} 页...`);

        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({
          canvasContext: ctx,
          viewport: viewport
        }).promise;

        // Convert canvas to data URL and save
        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.split(',')[1];
        const buffer = window.bufferHelper.fromBase64(base64Data);
        const filePath = `${dirPath}/${baseName}_${i}.png`;
        await window.pdfAPI.writeFile(filePath, buffer);

        // Explicitly release memory after each page
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;

        // Yield to UI thread every 5 pages to keep UI responsive
        if (i % 5 === 0 && i < totalPages) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Release PDF document to free memory
      pdf.destroy();
      if (DEBUG_MODE) console.log('[MEMORY] PDF document destroyed after export');

      updateStatus(`所有页面已导出到：${dirPath}`);
    }
  } catch (error) {
    handleError(error);
    updateStatus('导出图片失败');
  }
}

// Protect PDF handler
async function handleProtectPDF() {
  try {
    if (!currentPdfPath) {
      updateStatus('请先打开 PDF 文件');
      return;
    }

    const userPassword = prompt('请输入打开密码：');
    if (!userPassword) return;

    const ownerPassword = prompt('请输入所有者密码（可选，留空则使用打开密码）：') || null;

    updateStatus('正在加密 PDF...');
    const protectedBuffer = await window.pdfAPI.protect(currentPdfPath, userPassword, ownerPassword, {
      printing: 'highResolution',
      modifying: false,
      copying: false,
      annotating: false
    });

    // Save the protected file
    const result = await window.pdfAPI.saveDialog('protected.pdf');
    if (!result.canceled && result.filePath) {
      await window.pdfAPI.writeFile(result.filePath, protectedBuffer);
      updateStatus(`PDF 已加密保护，已保存到：${result.filePath}`);
    }
  } catch (error) {
    handleError(error);
  }
}

// Reload current PDF from disk after modifications
async function reloadCurrentPDF() {
  try {
    if (!currentPdfPath) return;

    // Reload the current PDF info
    const pdfInfo = await window.pdfAPI.loadPDF(currentPdfPath);
    totalPages = pdfInfo.pageCount;

    // Adjust current page if needed
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    // Re-render using editor
    if (pdfEditor) {
      await pdfEditor.renderPage(currentPage);
    }
    updatePageInfo();
    updateStatus('文件已重新加载');
  } catch (error) {
    handleError(error);
    updateStatus('重新加载失败');
  }
}

// Save file
function saveFile(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  updateStatus(`${filename} 保存成功`);
}

// Error handling
function handleError(error) {
  console.error(error);

  const errorMessage = error.message || error.toString();

  // Log error for debugging (can be extended with error reporting service)
  if (window.DEBUG_MODE) {
    console.log('[DEBUG] Error details:', {
      message: errorMessage,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  if (errorMessage.includes('EPERM') || errorMessage.includes('EBUSY') || errorMessage.includes('占用')) {
    alert('保存失败：文件可能被其他程序占用。\n\n请关闭该文件的其他打开窗口（如 PDF 阅读器）后重试。');
  }

  updateStatus(`错误：${errorMessage}`);
}

// Update status
function updateStatus(message) {
  if (statusMessage) {
    statusMessage.textContent = message;
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  updateStatus('准备就绪');
});
