// PDF Editor Renderer Process

// Debug mode - set to true to enable detailed logging
window.DEBUG_MODE = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

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

// Debug mode check - only log in development
const isDebugMode = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

function debugLog(...args) {
  if (isDebugMode) {
    console.log(...args);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// State
let selectedFiles = [];
let pdfEditor = null;
let currentPdfPath = null;
let currentPage = 1;
let selectedPages = new Set(); // Track selected pages for multi-select delete
let totalPages = 0;
let selectedImageData = null;
let selectedImageName = '';
let currentZoom = 100;
let currentTool = 'select';
let pdfjsLib = null;

// Search state
let searchState = {
  query: '',
  results: [],
  currentIndex: -1,
  isSearching: false
};

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tagName = target.tagName ? target.tagName.toLowerCase() : '';
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

// Settings state
let appSettings = {
  openLastFile: false,
  lastFilePath: ''
};

// Generic Modal Controller Factory
function createModalController(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.warn('Modal not found:', modalId);
    return null;
  }
  
  return {
    open: function() {
      modal.classList.add('active');
    },
    close: function() {
      modal.classList.remove('active');
    },
    isOpen: function() {
      return modal.classList.contains('active');
    },
    element: modal
  };
}

// Initialize all modals
const modals = {
  help: createModalController('helpModal'),
  settings: createModalController('settingsModal'),
  shortcuts: createModalController('shortcutsModal'),
  about: createModalController('aboutModal'),
  merge: createModalController('mergeModal'),
  split: createModalController('splitModal'),
  watermark: createModalController('watermarkModal'),
  bookmark: createModalController('bookmarkModal')
};

// Load settings from disk
async function loadAppSettings() {
  try {
    if (window.pdfAPI) {
      const settings = await window.pdfAPI.getSettings();
      if (settings) {
        appSettings.openLastFile = settings.openLastFile || false;
        appSettings.lastFilePath = settings.lastFilePath || '';
      }
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Save settings to disk
async function saveAppSettings() {
  try {
    if (window.pdfAPI) {
      await window.pdfAPI.setSettings(appSettings);
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// Update and save settings
async function updateSetting(key, value) {
  appSettings[key] = value;
  await saveAppSettings();
}

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

    debugLog('PDF.js initialized');
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
const backgroundCacheMap = new Map();

window.pdfDocumentCacheForEditor = pdfDocumentCache;
window.pdfPageCache = pdfPageCache;
function clearAllCaches(filePath) {
  clearPDFPageCache(filePath);
  backgroundCacheMap.clear();
}

window.clearPDFPageCache = clearPDFPageCache;
window.clearPDFDocumentCache = clearAllCaches;
window.getBackgroundCache = (canvasId) => backgroundCacheMap.get(canvasId);
window.setBackgroundCache = (canvasId, imageData) => {
  if (backgroundCacheMap.size > 50) {
    const firstKey = backgroundCacheMap.keys().next().value;
    backgroundCacheMap.delete(firstKey);
  }
  backgroundCacheMap.set(canvasId, imageData);
};

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
    debugLog(`[MEMORY] Cache cleaned. Pages: ${pdfPageCache.size}, Docs: ${pdfDocumentCache.size}, FileData: ${pdfFileDataCache.size}`);
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

async function getOrLoadPdfDocument(filePath) {
  let pdf = pdfDocumentCache.get(filePath);
  if (!pdf) {
    const fileData = await getCachedFileData(filePath);
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
    pdfDocumentCache.set(filePath, pdf);
  }
  return pdf;
}

window.renderPDFPage = async (filePath, pageNum, canvas, scale) => {
  const renderStartTime = performance.now();

  try {
    // Ensure PDF.js is loaded
    const lib = await initPDFJS();
    if (!lib) {
      throw new Error('PDF.js not loaded');
    }

    const fileData = await getCachedFileData(filePath);
    const typedArray = new Uint8Array(fileData);

    const pdf = await getOrLoadPdfDocument(filePath);

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

    // Use devicePixelRatio for crisp rendering on high-DPI screens
    const pixelRatio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * pixelRatio });

    // Set actual canvas size (in device pixels)
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Set CSS display size (in CSS pixels)
    canvas.style.width = `${viewport.width / pixelRatio}px`;
    canvas.style.height = `${viewport.height / pixelRatio}px`;

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
      debugLog(`[PERF] Rendered page ${pageNum} in ${renderTime.toFixed(2)}ms (${canvas.width}x${canvas.height})`);
    }

    return {
      width: viewport.width / pixelRatio,
      height: viewport.height / pixelRatio,
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
let thumbnailList;
let welcomePanel;
let toolProperties;
let quickActions;
let pageNavSection;
let actionsSection;
let pageManagementSection;
let exportSection;
let securitySection;
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
  thumbnailList = document.getElementById('thumbnailList');
  welcomePanel = document.getElementById('welcomePanel');
  toolProperties = document.getElementById('toolProperties');
  quickActions = document.getElementById('quickActions');
  pageNavSection = document.getElementById('pageNavSection');
  actionsSection = document.getElementById('actionsSection');
  pageManagementSection = document.getElementById('pageManagementSection');
  exportSection = document.getElementById('exportSection');
  securitySection = document.getElementById('securitySection');
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

  // 将菜单处理函数暴露到全局，以便测试可以调用
  // Menu action handlers - using object mapping for cleaner code
  const menuHandlers = {
    // File menu (container only)
    'file': () => {}, // do nothing, it's a container
    'new': handleNewFile,
    'open': () => openPdfDialog().catch(handleError),
    'save': handleSavePDF,
    'saveAs': handleSaveAs,
    'close': handleCloseFile,

    // Edit menu (container only)
    'edit': () => {}, // do nothing, it's a container
    'undo': handleUndo,
    'redo': handleRedo,

    // View menu (container only)
    'view': () => {}, // do nothing, it's a container
    'zoomIn': handleZoomIn,
    'zoomOut': handleZoomOut,
    'zoomReset': handleZoomReset,
    'toggleLeftSidebar': toggleLeftSidebar,
    'toggleRightSidebar': toggleRightSidebar,
    'fullscreen': toggleFullscreen,

    // Tools menu (container only)
    'tools': () => {}, // do nothing, it's a container
    'selectTool': () => selectTool('select'),
    'textTool': () => selectTool('text'),
    'highlightTool': () => selectTool('highlight'),
    'underlineTool': () => selectTool('underline'),
    'eraserTool': () => selectTool('eraser'),
    'openMergeModal': openMergeModal,
    'openSplitModal': openSplitModal,
    'openWatermarkModal': openWatermarkModal,

    // Settings menu (container only)
    'settings': () => {}, // do nothing, it's a container
    'openSettingsModal': openSettingsModal,
    'toggleAutoOpen': () => {
      appSettings.openLastFile = !appSettings.openLastFile;
      saveAppSettings();
      updateStatus(appSettings.openLastFile ? '已启用自动打开上次文件' : '已禁用自动打开上次文件');
    },

    // Help menu (container only)
    'help': () => {}, // do nothing, it's a container
    'openHelpModal': () => { if (modals.help) modals.help.open(); },
    'showShortcuts': showShortcutsModal,
    'about': showAboutModal
  };

  window.handleMenuAction = function(action) {
    debugLog('handleMenuAction 被调用，action:', action);
    const handler = menuHandlers[action];
    if (handler) {
      handler();
    } else {
      console.warn('Unknown menu action:', action);
    }
  };

  // Settings Modal
  function openSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    const openLastFileCheckbox = document.getElementById('openLastFileCheckbox');
    const lastFilePathHint = document.getElementById('lastFilePathHint');

    if (settingsModal) {
      if (openLastFileCheckbox) {
        openLastFileCheckbox.checked = appSettings.openLastFile;
      }
      if (lastFilePathHint && appSettings.lastFilePath) {
        lastFilePathHint.textContent = `上次文件：${appSettings.lastFilePath}`;
      } else if (lastFilePathHint) {
        lastFilePathHint.textContent = '';
      }
      settingsModal.classList.add('active');
    }
  }

  function closeSettingsModalFunc() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.classList.remove('active');
    }
  }

  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
  const closeSettingsModalX = document.getElementById('closeSettingsModal');
  const settingsModalOverlay = document.getElementById('settingsModal');
  const openLastFileCheckbox = document.getElementById('openLastFileCheckbox');

  if (closeSettingsModalBtn) {
    closeSettingsModalBtn.addEventListener('click', closeSettingsModalFunc);
  }
  if (closeSettingsModalX) {
    closeSettingsModalX.addEventListener('click', closeSettingsModalFunc);
  }
  if (settingsModalOverlay) {
    settingsModalOverlay.addEventListener('click', (e) => {
      if (e.target === settingsModalOverlay) {
        closeSettingsModalFunc();
      }
    });
  }
  if (openLastFileCheckbox) {
    openLastFileCheckbox.addEventListener('change', async (e) => {
      await updateSetting('openLastFile', e.target.checked);
    });
  }

  // Help Modal
  window.openHelpModal = function() {
    if (modals.help) modals.help.open();
  };

  window.closeHelpModal = function() {
    if (modals.help) modals.help.close();
  };

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

  // Shortcuts Modal functions
  function showShortcutsModal() {
    if (modals.shortcuts) modals.shortcuts.open();
  }

  function closeShortcutsModal() {
    if (modals.shortcuts) modals.shortcuts.close();
  }

  // Shortcuts modal event listeners
  const closeShortcutsModalBtn = document.getElementById('closeShortcutsModalBtn');
  if (closeShortcutsModalBtn) {
    closeShortcutsModalBtn.addEventListener('click', closeShortcutsModal);
  }

  const closeShortcutsModalX = document.getElementById('closeShortcutsModal');
  if (closeShortcutsModalX) {
    closeShortcutsModalX.addEventListener('click', closeShortcutsModal);
  }

  const shortcutsModalOverlay = document.getElementById('shortcutsModal');
  if (shortcutsModalOverlay) {
    shortcutsModalOverlay.addEventListener('click', (e) => {
      if (e.target === shortcutsModalOverlay) {
        closeShortcutsModal();
      }
    });
  }

  // About Modal functions
  function showAboutModal() {
    if (modals.about) modals.about.open();
  }

  function closeAboutModal() {
    if (modals.about) modals.about.close();
  }

  // About modal event listeners
  const closeAboutModalBtn = document.getElementById('closeAboutModalBtn');
  if (closeAboutModalBtn) {
    closeAboutModalBtn.addEventListener('click', closeAboutModal);
  }

  const closeAboutModalX = document.getElementById('closeAboutModal');
  if (closeAboutModalX) {
    closeAboutModalX.addEventListener('click', closeAboutModal);
  }

  const aboutModalOverlay = document.getElementById('aboutModal');
  if (aboutModalOverlay) {
    aboutModalOverlay.addEventListener('click', (e) => {
      if (e.target === aboutModalOverlay) {
        closeAboutModal();
      }
    });
  }

  // 绑定菜单事件 - 更直接的方式
  const menuItems = document.querySelectorAll('.menu-item');
  debugLog('找到菜单项数量:', menuItems.length);
  
  menuItems.forEach((item, index) => {
    const action = item.getAttribute('data-action');
    debugLog('绑定菜单 ' + index + ':', action, item);
    
    item.style.pointerEvents = 'auto';
    item.addEventListener('mousedown', (e) => {
      debugLog('菜单 mousedown: ' + action);
      e.preventDefault();
      e.stopPropagation();
    });
    
    item.addEventListener('click', (e) => {
      debugLog('菜单被点击: ' + action);
      e.preventDefault();
      e.stopPropagation();
      handleMenuAction(action);
    });
  });
  
  // Bind submenu items (undo, redo)
  const submenuItems = document.querySelectorAll('.submenu-item');
  submenuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = item.getAttribute('data-action');
      debugLog('子菜单被点击: ' + action);
      
      // Close all submenus after click
      document.querySelectorAll('.submenu').forEach(submenu => {
        submenu.style.display = 'none';
      });
      
      handleMenuAction(action);
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

  // Zoom controls
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

  if (zoomInBtn) zoomInBtn.addEventListener('click', () => setZoom(currentZoom + 10));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setZoom(currentZoom - 10));
  const zoomLevelDisplay = document.getElementById('zoomLevel');
  if (zoomLevelDisplay) {
    zoomLevelDisplay.addEventListener('click', () => setZoom(100));
    zoomLevelDisplay.style.cursor = 'pointer';
    zoomLevelDisplay.title = '点击恢复 100%';
  }

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
  const redoBtn = document.getElementById('redoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveEditBtn = document.getElementById('saveEditBtn');

  if (undoBtn) undoBtn.addEventListener('click', handleUndo);
  if (redoBtn) redoBtn.addEventListener('click', handleRedo);
  if (clearBtn) clearBtn.addEventListener('click', handleClearAll);
  if (saveEditBtn) saveEditBtn.addEventListener('click', handleSavePDF);

  // Toolbar buttons
  const undoToolbarBtn = document.getElementById('undoToolbarBtn');
  const redoToolbarBtn = document.getElementById('redoToolbarBtn');
  const saveBtn = document.getElementById('saveBtn');

  if (undoToolbarBtn) undoToolbarBtn.addEventListener('click', handleUndo);
  if (redoToolbarBtn) redoToolbarBtn.addEventListener('click', handleRedo);
  if (saveBtn) saveBtn.addEventListener('click', handleSavePDF);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target)) return;

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      handleRedo();
      e.preventDefault();
    }
    
    // Zoom
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      setZoom(currentZoom + 10);
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      setZoom(currentZoom - 10);
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      setZoom(100);
      e.preventDefault();
    }
    
    // Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      handleSavePDF();
      e.preventDefault();
    }
    
    // Tool shortcuts (single key without modifiers)
    const toolShortcuts = {
      'v': 'select',
      't': 'text',
      'h': 'highlight',
      'u': 'underline',
      'e': 'eraser'
    };
    
    const tool = toolShortcuts[e.key.toLowerCase()];
    if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) {
      selectTool(tool);
      e.preventDefault();
    }
    
    // Fullscreen
    if (e.key === 'F11') {
      toggleFullscreen();
      e.preventDefault();
    }
  });

  // Mouse wheel zoom
  window.addEventListener('wheel', (e) => {
    if (isEditableTarget(e.target)) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.deltaY < 0) {
        setZoom(currentZoom + 5);
      } else {
        setZoom(currentZoom - 5);
      }
      e.preventDefault();
    }
  }, { passive: false });

  // Quick actions
  const quickMergeBtn = document.getElementById('quickMergeBtn');
  const quickSplitBtn = document.getElementById('quickSplitBtn');
  const quickWatermarkBtn = document.getElementById('quickWatermarkBtn');
  const quickPageNumbersBtn = document.getElementById('quickPageNumbersBtn');

  if (quickMergeBtn) quickMergeBtn.addEventListener('click', handleMerge);
  if (quickSplitBtn) quickSplitBtn.addEventListener('click', handleSplit);
  if (quickWatermarkBtn) quickWatermarkBtn.addEventListener('click', handleWatermark);
  if (quickPageNumbersBtn) quickPageNumbersBtn.addEventListener('click', openPageNumbersModal);

  // Compress PDF
  const quickCompressBtn = document.getElementById('quickCompressBtn');
  if (quickCompressBtn) quickCompressBtn.addEventListener('click', handleCompressPDF);

  // PDF Properties
  const savePropertiesBtn = document.getElementById('savePropertiesBtn');
  if (savePropertiesBtn) savePropertiesBtn.addEventListener('click', handleSaveProperties);

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

  // Search functionality
  setupSearch();

  setupContextMenu();

  // Tool options
  setupToolOptions();
}

let contextMenuState = {
  menu: null,
  targetPage: -1,
  targetOutlineIndex: -1,
  selectedPages: new Set()
};

function setupContextMenu() {
  contextMenuState.menu = document.getElementById('thumbnailContextMenu');

  document.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  document.querySelectorAll('.context-menu').forEach(menu => {
    menu.addEventListener('click', handleContextMenuClick);
  });
}

function handleContextMenu(e) {
  const thumbnailItem = e.target.closest('.thumbnail-item');
  const outlineItem = e.target.closest('.outline-item');

  if (thumbnailItem && currentPdfPath) {
    e.preventDefault();
    const pageNum = parseInt(thumbnailItem.dataset.page);
    showThumbnailContextMenu(e.clientX, e.clientY, pageNum);
  } else if (outlineItem) {
    e.preventDefault();
    const index = parseInt(outlineItem.dataset.index);
    showOutlineContextMenu(e.clientX, e.clientY, index);
  }
}

function showThumbnailContextMenu(x, y, pageNum) {
  const menu = document.getElementById('thumbnailContextMenu');
  if (!menu) return;

  contextMenuState.targetPage = pageNum;

  const hasMultipleSelected = contextMenuState.selectedPages.size > 1;
  const deleteItem = menu.querySelector('[data-action="delete"]');
  if (deleteItem) {
    deleteItem.textContent = hasMultipleSelected ? `删除选中的 ${contextMenuState.selectedPages.size} 页` : '删除此页';
  }

  showMenuAtPosition(menu, x, y);
}

function showOutlineContextMenu(x, y, index) {
  const menu = document.getElementById('outlineContextMenu');
  if (!menu) return;

  contextMenuState.targetOutlineIndex = index;

  const outlineItem = currentOutline[index];
  const gotoItem = menu.querySelector('[data-action="goto"]');
  if (gotoItem) {
    if (outlineItem && outlineItem.page) {
      gotoItem.classList.remove('context-menu-item-disabled');
    } else {
      gotoItem.classList.add('context-menu-item-disabled');
    }
  }

  showMenuAtPosition(menu, x, y);
}

function showMenuAtPosition(menu, x, y) {
  hideContextMenu();

  menu.classList.add('visible');

  const menuRect = menu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let posX = x;
  let posY = y;

  if (x + menuRect.width > windowWidth) {
    posX = windowWidth - menuRect.width - 10;
  }
  if (y + menuRect.height > windowHeight) {
    posY = windowHeight - menuRect.height - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

function hideContextMenu() {
  document.querySelectorAll('.context-menu').forEach(menu => {
    menu.classList.remove('visible');
  });
}

async function handleContextMenuClick(e) {
  const menuItem = e.target.closest('.context-menu-item');
  if (!menuItem) return;

  const action = menuItem.dataset.action;
  const menuId = e.currentTarget.id;

  hideContextMenu();

  if (menuId === 'thumbnailContextMenu' || menuId === 'contextMenu') {
    await handleThumbnailContextAction(action);
  } else if (menuId === 'outlineContextMenu') {
    handleOutlineContextAction(action);
  }
}

async function handleThumbnailContextAction(action) {
  const pageNum = contextMenuState.targetPage;
  const selectedPages = Array.from(contextMenuState.selectedPages);

  switch (action) {
    case 'goto':
      if (pageNum >= 0) goToPage(pageNum);
      break;

    case 'selectRange':
      if (pageNum >= 0) {
        selectPageRange(pageNum);
      }
      break;

    case 'insertBlankBefore':
      await handleInsertBlankPage(pageNum - 1);
      break;

    case 'insertBlankAfter':
      await handleInsertBlankPage(pageNum);
      break;

    case 'insertFromPdf':
      await handleInsertFromPdf(pageNum);
      break;

    case 'crop':
      await openCropModal(pageNum);
      break;

    case 'rotateLeft':
      await handleRotatePage(-90, [pageNum]);
      break;

    case 'rotateRight':
      await handleRotatePage(90, [pageNum]);
      break;

    case 'rotateSelectedLeft':
      const pagesToRotateLeft = selectedPages.length > 0 ? selectedPages : [pageNum];
      await handleRotatePage(-90, pagesToRotateLeft);
      break;

    case 'rotateSelectedRight':
      const pagesToRotateRight = selectedPages.length > 0 ? selectedPages : [pageNum];
      await handleRotatePage(90, pagesToRotateRight);
      break;

    case 'extract':
      await handleExtractPage(pageNum);
      break;

    case 'extractSelected':
      const pagesToExtract = selectedPages.length > 0 ? selectedPages : [pageNum];
      await handleExtractSelectedPages(pagesToExtract);
      break;

    case 'duplicate':
      await handleDuplicatePage(pageNum);
      break;

    case 'print':
      await handlePrintPage(pageNum);
      break;

    case 'printSelected':
      const pagesToPrint = selectedPages.length > 0 ? selectedPages : [pageNum];
      await handlePrintSelectedPages(pagesToPrint);
      break;

    case 'delete':
      const pagesToDelete = selectedPages.length > 1 ? selectedPages : [pageNum];
      await handleDeletePages(pagesToDelete);
      break;
  }
}

function handleOutlineContextAction(action) {
  const index = contextMenuState.targetOutlineIndex;
  const outlineItem = currentOutline[index];

  switch (action) {
    case 'goto':
      if (outlineItem && outlineItem.page) {
        goToPage(outlineItem.page);
      }
      break;

    case 'copyTitle':
      if (outlineItem && outlineItem.title) {
        navigator.clipboard.writeText(outlineItem.title).then(() => {
          updateStatus('标题已复制到剪贴板');
        }).catch(err => {
          console.error('Failed to copy title:', err);
        });
      }
      break;
  }
}

function selectPageRange(startPage) {
  const endPage = prompt(`选择页面范围\n起始页：${startPage + 1}\n请输入结束页码（1-${totalPages}）：`, totalPages);
  if (endPage === null) return;

  const end = parseInt(endPage);
  if (isNaN(end) || end < 1 || end > totalPages) {
    updateStatus('无效的页码');
    return;
  }

  contextMenuState.selectedPages.clear();
  for (let i = startPage; i < end; i++) {
    contextMenuState.selectedPages.add(i);
  }

  updateThumbnailSelection();
  updateStatus(`已选择 ${contextMenuState.selectedPages.size} 页`);
}

function updateThumbnailSelection() {
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    const page = parseInt(item.dataset.page);
    if (contextMenuState.selectedPages.has(page)) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Drag and drop state for thumbnail reordering
let dragState = {
  draggedItem: null,
  draggedPage: -1,
  placeholder: null
};

function handleThumbnailDragStart(e) {
  const thumbnailItem = e.target.closest('.thumbnail-item');
  if (!thumbnailItem) return;

  dragState.draggedItem = thumbnailItem;
  dragState.draggedPage = parseInt(thumbnailItem.dataset.page);

  thumbnailItem.classList.add('dragging');

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragState.draggedPage.toString());

  // Create placeholder element
  dragState.placeholder = document.createElement('div');
  dragState.placeholder.className = 'thumbnail-placeholder';
}

function handleThumbnailDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const thumbnailItem = e.target.closest('.thumbnail-item');
  if (!thumbnailItem || thumbnailItem === dragState.draggedItem) return;

  const rect = thumbnailItem.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  if (e.clientY < midY) {
    thumbnailItem.classList.add('drop-above');
    thumbnailItem.classList.remove('drop-below');
  } else {
    thumbnailItem.classList.add('drop-below');
    thumbnailItem.classList.remove('drop-above');
  }
}

function handleThumbnailDragLeave(e) {
  const thumbnailItem = e.target.closest('.thumbnail-item');
  if (thumbnailItem) {
    thumbnailItem.classList.remove('drop-above', 'drop-below');
  }
}

async function handleThumbnailDrop(e) {
  e.preventDefault();

  const targetItem = e.target.closest('.thumbnail-item');
  if (!targetItem || targetItem === dragState.draggedItem) return;

  const targetPage = parseInt(targetItem.dataset.page);
  const fromPage = dragState.draggedPage;

  if (fromPage === targetPage) return;

  // Determine drop position
  const rect = targetItem.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const dropAbove = e.clientY < midY;

  // Calculate new position (0-indexed)
  let toIndex = targetPage - 1;
  if (!dropAbove) {
    toIndex = targetPage;
  }

  // Adjust for the removed page
  const fromIndex = fromPage - 1;
  if (toIndex > fromIndex) {
    toIndex--;
  }

  // Clear visual indicators
  targetItem.classList.remove('drop-above', 'drop-below');

  // Perform the page move
  await handleMovePage(fromIndex, toIndex);
}

function handleThumbnailDragEnd(e) {
  // Clean up
  if (dragState.draggedItem) {
    dragState.draggedItem.classList.remove('dragging');
  }

  document.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.remove('drop-above', 'drop-below');
  });

  dragState.draggedItem = null;
  dragState.draggedPage = -1;
  dragState.placeholder = null;
}

async function handleMovePage(fromIndex, toIndex) {
  if (!currentPdfPath) return;

  if (fromIndex === toIndex) return;

  try {
    updateStatus(`正在移动页面 ${fromIndex + 1} 到 ${toIndex + 1}...`);

    const result = await window.pdfAPI.movePage(currentPdfPath, fromIndex, toIndex);

    // Save the modified PDF back to the file
    await window.pdfAPI.writeFile(currentPdfPath, Array.from(result));

    // Reload the PDF
    await reloadCurrentPDF();

    // Go to the moved page
    goToPage(toIndex + 1);

    updateStatus(`页面已移动到第 ${toIndex + 1} 页`);
  } catch (error) {
    console.error('Failed to move page:', error);
    handleError(error);
    updateStatus('移动页面失败');
  }
}

async function handleExtractPage(pageNum) {
  if (!currentPdfPath || pageNum < 0) return;

  try {
    updateStatus(`正在提取第 ${pageNum + 1} 页...`);

    const result = await window.pdfAPI.split(currentPdfPath, [String(pageNum + 1)]);

    if (result && result.length > 0) {
      const saveResult = await window.pdfAPI.saveDialog(`page_${pageNum + 1}.pdf`);
      if (!saveResult.canceled && saveResult.filePath) {
        await window.pdfAPI.writeFile(saveResult.filePath, Array.from(result[0]));
        updateStatus(`第 ${pageNum + 1} 页已提取并保存`);
      }
    }
  } catch (error) {
    console.error('Failed to extract page:', error);
    handleError(error);
  }
}

async function handleExtractSelectedPages(pageNumbers) {
  if (!currentPdfPath || pageNumbers.length === 0) return;

  try {
    const sortedPages = [...pageNumbers].sort((a, b) => a - b);
    const pageList = sortedPages.map(p => p + 1);
    
    updateStatus(`正在导出 ${pageList.length} 页...`);

    // Create range string for split API
    const rangeStr = pageList.join(',');
    const result = await window.pdfAPI.split(currentPdfPath, [rangeStr]);

    if (result && result.length > 0) {
      const defaultName = `extracted_${pageList.length}_pages.pdf`;
      const saveResult = await window.pdfAPI.saveDialog(defaultName);
      if (!saveResult.canceled && saveResult.filePath) {
        await window.pdfAPI.writeFile(saveResult.filePath, Array.from(result[0]));
        updateStatus(`已导出 ${pageList.length} 页到 ${saveResult.filePath}`);
      }
    }
  } catch (error) {
    console.error('Failed to extract selected pages:', error);
    handleError(error);
  }
}

async function handleDuplicatePage(pageNum) {
  if (!currentPdfPath || pageNum < 0) return;

  try {
    updateStatus(`正在复制第 ${pageNum + 1} 页...`);

    // Use split to extract the page
    const result = await window.pdfAPI.split(currentPdfPath, [String(pageNum + 1)]);

    if (result && result.length > 0) {
      const saveResult = await window.pdfAPI.saveDialog(`page_${pageNum + 1}_copy.pdf`);
      if (!saveResult.canceled && saveResult.filePath) {
        await window.pdfAPI.writeFile(saveResult.filePath, Array.from(result[0]));
        updateStatus(`第 ${pageNum + 1} 页已复制为新文件`);
      }
    }
  } catch (error) {
    console.error('Failed to duplicate page:', error);
    handleError(error);
  }
}

async function handlePrintPage(pageNum) {
  if (!currentPdfPath || pageNum < 0) return;

  try {
    updateStatus(`正在准备打印第 ${pageNum + 1} 页...`);

    // Create a temporary PDF with just this page
    const result = await window.pdfAPI.split(currentPdfPath, [String(pageNum + 1)]);

    if (result && result.length > 0) {
      // Create a blob URL for the PDF
      const blob = new Blob([result[0]], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // Open in new window for printing
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
        updateStatus(`正在打印第 ${pageNum + 1} 页...`);
      } else {
        updateStatus('请允许弹出窗口以打印页面');
      }

      // Clean up the blob URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    console.error('Failed to print page:', error);
    handleError(error);
  }
}

async function handlePrintSelectedPages(pageNumbers) {
  if (!currentPdfPath || pageNumbers.length === 0) return;

  try {
    const sortedPages = [...pageNumbers].sort((a, b) => a - b);
    const pageList = sortedPages.map(p => p + 1);
    
    updateStatus(`正在准备打印 ${pageList.length} 页...`);

    // Create range string for split API
    const rangeStr = pageList.join(',');
    const result = await window.pdfAPI.split(currentPdfPath, [rangeStr]);

    if (result && result.length > 0) {
      // Create a blob URL for the PDF
      const blob = new Blob([result[0]], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // Open in new window for printing
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
        updateStatus(`正在打印 ${pageList.length} 页...`);
      } else {
        updateStatus('请允许弹出窗口以打印页面');
      }

      // Clean up the blob URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    console.error('Failed to print selected pages:', error);
    handleError(error);
  }
}

async function handleDeletePages(pageNumbers) {
  if (!currentPdfPath || pageNumbers.length === 0) return;

  const sortedPages = [...pageNumbers].sort((a, b) => b - a);
  const pageList = sortedPages.map(p => p + 1).join(', ');

  const confirmed = confirm(`确定要删除以下页面吗？\n第 ${pageList} 页\n\n此操作不可撤销。`);
  if (!confirmed) return;

  try {
    updateStatus(`正在删除页面...`);

    const result = await window.pdfAPI.deletePages(currentPdfPath, sortedPages.map(p => p + 1));

    contextMenuState.selectedPages.clear();

    await reloadCurrentPDF();

    updateStatus(`已删除 ${sortedPages.length} 页`);
  } catch (error) {
    console.error('Failed to delete pages:', error);
    handleError(error);
  }
}

async function reloadCurrentPDF() {
  if (!currentPdfPath) return;

  const path = currentPdfPath;
  currentPdfPath = null;

  await handleSelectedFiles([{ path, name: path.split('/').pop() }]);
}

// Search functionality
function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchPrevBtn = document.getElementById('searchPrevBtn');
  const searchNextBtn = document.getElementById('searchNextBtn');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleSearchInput, 300));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          goToPreviousSearchResult();
        } else {
          goToNextSearchResult();
        }
      } else if (e.key === 'Escape') {
        clearSearch();
        searchInput.blur();
      }
    });
  }

  if (searchPrevBtn) {
    searchPrevBtn.addEventListener('click', goToPreviousSearchResult);
  }

  if (searchNextBtn) {
    searchNextBtn.addEventListener('click', goToNextSearchResult);
  }

  // Add Ctrl+F shortcut
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });
}

async function handleSearchInput(e) {
  const query = e.target.value.trim();
  
  if (query === '') {
    clearSearch();
    return;
  }

  if (query === searchState.query) {
    return;
  }

  searchState.query = query;
  searchState.results = [];
  searchState.currentIndex = -1;

  await performSearch(query);
}

async function performSearch(query) {
  if (!currentPdfPath || !query) return;

  searchState.isSearching = true;
  updateSearchResultCount('搜索中...');

  try {
    const pdf = await getOrLoadPdfDocument(currentPdfPath);
    const results = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      let text = '';
      const items = textContent.items;
      
      for (const item of items) {
        text += item.str + ' ';
      }

      // Find all occurrences in this page
      let index = 0;
      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();

      while ((index = lowerText.indexOf(lowerQuery, index)) !== -1) {
        results.push({
          pageNum,
          index,
          text: text.substring(index, index + query.length)
        });
        index += query.length;
      }
    }

    searchState.results = results;
    searchState.currentIndex = results.length > 0 ? 0 : -1;
    
    updateSearchResultCount(results.length > 0 ? `${results.length} 个结果` : '无结果');

    if (results.length > 0) {
      highlightSearchResult();
    }
  } catch (error) {
    console.error('Search failed:', error);
    updateSearchResultCount('搜索失败');
  } finally {
    searchState.isSearching = false;
  }
}

function goToNextSearchResult() {
  if (searchState.results.length === 0) return;

  searchState.currentIndex = (searchState.currentIndex + 1) % searchState.results.length;
  highlightSearchResult();
}

function goToPreviousSearchResult() {
  if (searchState.results.length === 0) return;

  searchState.currentIndex = searchState.currentIndex === 0 
    ? searchState.results.length - 1 
    : searchState.currentIndex - 1;
  highlightSearchResult();
}

function highlightSearchResult() {
  if (searchState.currentIndex < 0 || searchState.currentIndex >= searchState.results.length) return;

  const result = searchState.results[searchState.currentIndex];
  
  // Navigate to the page
  goToPage(result.pageNum);
  
  // Update the result count display
  updateSearchResultCount(`${searchState.currentIndex + 1}/${searchState.results.length}`);

  updateStatus(`找到第 ${searchState.currentIndex + 1} 个结果，在第 ${result.pageNum} 页`);
}

function clearSearch() {
  searchState.query = '';
  searchState.results = [];
  searchState.currentIndex = -1;
  updateSearchResultCount('');
  
  // Clear any visual highlights
  document.querySelectorAll('.search-highlight').forEach(el => el.remove());
}

function updateSearchResultCount(text) {
  const countEl = document.getElementById('searchResultCount');
  if (countEl) {
    countEl.textContent = text;
  }
}

// Bookmarks state
let currentBookmarks = [];
let editingBookmarkIndex = -1;

// Outline (TOC) state
let currentOutline = [];
let hasOutline = false;

// Outline functions
async function loadOutline() {
  if (!currentPdfPath) return;

  try {
    const outline = await window.pdfAPI.getBookmarks(currentPdfPath);
    currentOutline = outline || [];
    hasOutline = currentOutline.length > 0;
    renderOutline();
  } catch (error) {
    console.error('Failed to load outline:', error);
    currentOutline = [];
    hasOutline = false;
    renderOutline();
  }
}

async function loadBookmarks() {
  if (!currentPdfPath) return;

  try {
    const pdfBookmarks = await window.pdfAPI.getBookmarks(currentPdfPath);
    if (pdfBookmarks && pdfBookmarks.length > 0) {
      currentBookmarks = pdfBookmarks;
    } else {
      currentBookmarks = [];
    }
    renderBookmarks();
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
    currentBookmarks = [];
    renderBookmarks();
  }
}

function renderOutline() {
  const outlineList = document.getElementById('outlineList');
  const outlineInfo = document.getElementById('outlineInfo');

  if (!outlineList) return;

  if (currentOutline.length === 0) {
    outlineList.innerHTML = '<div class="outline-empty">此 PDF 没有目录大纲<br>请使用书签功能手动添加</div>';
    if (outlineInfo) {
      outlineInfo.innerHTML = '';
    }
    return;
  }

  outlineList.innerHTML = currentOutline.map((item, index) => `
    <div class="outline-item ${item.level > 0 ? 'outline-item-child' : ''} ${item.page ? 'outline-item-linkable' : 'outline-item-nolink'}"
         data-index="${index}"
         style="padding-left: ${12 + (item.level || 0) * 16}px">
      <span class="outline-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
      <span class="outline-page">${item.page ? `第 ${item.page} 页` : '-'}</span>
    </div>
  `).join('');

  if (outlineInfo) {
    const withPage = currentOutline.filter(i => i.page).length;
    outlineInfo.innerHTML = `<div class="outline-count">共 ${currentOutline.length} 个条目${withPage < currentOutline.length ? `，${withPage} 个可跳转` : ''}</div>`;
  }

  outlineList.querySelectorAll('.outline-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const index = parseInt(item.dataset.index);
      const outlineItem = currentOutline[index];
      if (outlineItem && outlineItem.page) {
        outlineList.querySelectorAll('.outline-item').forEach(el => el.classList.remove('outline-item-active'));
        item.classList.add('outline-item-active');
        goToPage(outlineItem.page);
      }
    });
  });
}

// Bookmark functions

  function renderBookmarks() {
    const bookmarksList = document.getElementById('bookmarksList');
    if (!bookmarksList) return;

    if (currentBookmarks.length === 0) {
      bookmarksList.innerHTML = '<div class="bookmarks-empty">暂无书签<br>点击"添加书签"创建</div>';
      return;
    }

    bookmarksList.innerHTML = currentBookmarks.map((bm, index) => `
      <div class="bookmark-item" data-index="${index}" style="padding-left: ${12 + (bm.level || 0) * 16}px">
        <span class="bookmark-title">${escapeHtml(bm.title)}</span>
        <span class="bookmark-page">第 ${bm.page} 页</span>
        <div class="bookmark-item-actions">
          <button class="bookmark-edit" data-index="${index}" title="编辑书签">✎</button>
          <button class="bookmark-delete" data-index="${index}" title="删除书签">&times;</button>
        </div>
      </div>
    `).join('');

    // Add click handlers
    bookmarksList.querySelectorAll('.bookmark-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.bookmark-item-actions')) return;
        const index = parseInt(item.dataset.index);
        const bm = currentBookmarks[index];
        if (bm.page) {
          goToPage(bm.page);
        }
      });
    });

    bookmarksList.querySelectorAll('.bookmark-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index);
        openBookmarkModal(null, index);
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
      await window.pdfAPI.writeFile(currentPdfPath, buffer);
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

  function openBookmarkModal(pageNum = null, editIndex = -1) {
    editingBookmarkIndex = editIndex;
    if (editingBookmarkIndex >= 0) {
      const bm = currentBookmarks[editingBookmarkIndex];
      document.getElementById('bookmarkModalTitle').textContent = '编辑书签';
      bookmarkTitleInput.value = bm.title;
      bookmarkPageInput.value = bm.page;
    } else {
      document.getElementById('bookmarkModalTitle').textContent = '添加书签';
      bookmarkTitleInput.value = '';
      bookmarkPageInput.value = pageNum || currentPage;
    }
    bookmarkModal.classList.add('active');
    bookmarkTitleInput.focus();
  }

  function closeBookmarkModalFunc() {
    bookmarkModal.classList.remove('active');
    editingBookmarkIndex = -1;
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

    let oldBookmark = null;
    if (editingBookmarkIndex >= 0) {
      oldBookmark = { ...currentBookmarks[editingBookmarkIndex] };
      currentBookmarks[editingBookmarkIndex].title = title;
      currentBookmarks[editingBookmarkIndex].page = page;
    } else {
      const newBookmark = { title, page };
      currentBookmarks.push(newBookmark);
    }

    try {
      const buffer = await window.pdfAPI.addBookmarks(currentPdfPath, currentBookmarks);
      await window.pdfAPI.writeFile(currentPdfPath, buffer);
      closeBookmarkModalFunc();
      renderBookmarks();
    } catch (error) {
      console.error('Failed to save bookmark:', error);
      if (editingBookmarkIndex >= 0) {
        currentBookmarks[editingBookmarkIndex] = oldBookmark;
      } else {
        currentBookmarks.pop();
      }
      alert('保存书签失败');
    }
  }

  if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', () => openBookmarkModal());
  if (closeBookmarkModal) closeBookmarkModal.addEventListener('click', closeBookmarkModalFunc);
  if (cancelBookmarkBtn) cancelBookmarkBtn.addEventListener('click', closeBookmarkModalFunc);
  if (saveBookmarkBtn) saveBookmarkBtn.addEventListener('click', saveBookmark);

  // Split PDF modal event listeners
  const splitModal = document.getElementById('splitModal');
  const closeSplitModal = document.getElementById('closeSplitModal');
  const cancelSplitModal = document.getElementById('cancelSplitModal');
  const confirmSplitBtn = document.getElementById('confirmSplitBtn');
  const splitRangesInput = document.getElementById('splitRanges');

  function openSplitModal() {
    if (!currentPdfPath) {
      alert('请先打开 PDF 文件');
      return;
    }
    const splitModalPagesInfo = document.getElementById('splitModalPagesInfo');
    if (splitModalPagesInfo) splitModalPagesInfo.textContent = `PDF 共 ${totalPages} 页`;
    if (splitRangesInput) {
      splitRangesInput.value = '';
      splitModal.classList.add('active');
      setTimeout(() => splitRangesInput.focus(), 100);
    }
  }

  function closeSplitModalFunc() {
    if (splitModal) splitModal.classList.remove('active');
  }

  if (closeSplitModal) closeSplitModal.addEventListener('click', closeSplitModalFunc);
  if (cancelSplitModal) cancelSplitModal.addEventListener('click', closeSplitModalFunc);
  if (confirmSplitBtn) confirmSplitBtn.addEventListener('click', performSplit);

  const handleSplitKeydown = (e) => {
    if (e.key === 'Enter') {
      performSplit();
    } else if (e.key === 'Escape') {
      closeSplitModalFunc();
    }
  };

  if (splitRangesInput) splitRangesInput.addEventListener('keydown', handleSplitKeydown);

  // Watermark modal event listeners
  const watermarkModal = document.getElementById('watermarkModal');
  const closeWatermarkModal = document.getElementById('closeWatermarkModal');
  const cancelWatermarkModal = document.getElementById('cancelWatermarkModal');
  const confirmWatermarkBtn = document.getElementById('confirmWatermarkBtn');
  const watermarkText = document.getElementById('watermarkText');
  const watermarkOpacity = document.getElementById('watermarkOpacity');
  const watermarkOpacityValue = document.getElementById('watermarkOpacityValue');

  function openWatermarkModal() {
    if (watermarkText) watermarkText.value = '';
    if (watermarkModal) watermarkModal.classList.add('active');
    if (watermarkText) setTimeout(() => watermarkText.focus(), 100);
  }

  function closeWatermarkModalFunc() {
    if (watermarkModal) watermarkModal.classList.remove('active');
  }

  if (closeWatermarkModal) closeWatermarkModal.addEventListener('click', closeWatermarkModalFunc);
  if (cancelWatermarkModal) cancelWatermarkModal.addEventListener('click', closeWatermarkModalFunc);
  if (confirmWatermarkBtn) confirmWatermarkBtn.addEventListener('click', performWatermark);
  if (watermarkOpacity) {
    watermarkOpacity.addEventListener('input', () => {
      if (watermarkOpacityValue) watermarkOpacityValue.textContent = `${watermarkOpacity.value}%`;
    });
  }

  // Protect modal event listeners
  const protectModal = document.getElementById('protectModal');
  const closeProtectModal = document.getElementById('closeProtectModal');
  const cancelProtectModal = document.getElementById('cancelProtectModal');
  const confirmProtectBtn = document.getElementById('confirmProtectBtn');

  function openProtectModal() {
    if (protectModal) protectModal.classList.add('active');
  }

  function closeProtectModalFunc() {
    if (protectModal) protectModal.classList.remove('active');
  }

  if (closeProtectModal) closeProtectModal.addEventListener('click', closeProtectModalFunc);
  if (cancelProtectModal) cancelProtectModal.addEventListener('click', closeProtectModalFunc);
  if (confirmProtectBtn) confirmProtectBtn.addEventListener('click', performProtect);

  // Page Numbers modal event listeners
  const pageNumbersModal = document.getElementById('pageNumbersModal');
  const closePageNumbersModal = document.getElementById('closePageNumbersModal');
  const cancelPageNumbersModal = document.getElementById('cancelPageNumbersModal');
  const confirmPageNumbersBtn = document.getElementById('confirmPageNumbersBtn');
  const pageNumberFormat = document.getElementById('pageNumberFormat');
  const customFormatGroup = document.getElementById('customFormatGroup');
  const pageNumberFontSize = document.getElementById('pageNumberFontSize');
  const pageNumberFontSizeValue = document.getElementById('pageNumberFontSizeValue');

  if (pageNumberFormat) {
    pageNumberFormat.addEventListener('change', (e) => {
      if (customFormatGroup) {
        customFormatGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
    });
  }

  if (pageNumberFontSize && pageNumberFontSizeValue) {
    pageNumberFontSize.addEventListener('input', (e) => {
      pageNumberFontSizeValue.textContent = e.target.value;
    });
  }

  function openPageNumbersModal() {
    if (pageNumbersModal) pageNumbersModal.classList.add('active');
  }

  function closePageNumbersModalFunc() {
    if (pageNumbersModal) pageNumbersModal.classList.remove('active');
  }

  if (closePageNumbersModal) closePageNumbersModal.addEventListener('click', closePageNumbersModalFunc);
  if (cancelPageNumbersModal) cancelPageNumbersModal.addEventListener('click', closePageNumbersModalFunc);
  if (confirmPageNumbersBtn) confirmPageNumbersBtn.addEventListener('click', performAddPageNumbers);

  // Crop Page modal event listeners
  const cropPageModal = document.getElementById('cropPageModal');
  const closeCropModal = document.getElementById('closeCropModal');
  const cancelCropModal = document.getElementById('cancelCropModal');
  const confirmCropBtn = document.getElementById('confirmCropBtn');
  let cropTargetPage = 1;

  async function openCropModal(pageNum) {
    cropTargetPage = pageNum;
    const cropPageNumInput = document.getElementById('cropPageNum');
    if (cropPageNumInput) cropPageNumInput.value = pageNum;

    // Get page dimensions
    try {
      const dims = await window.pdfAPI.getPageDimensions(currentPdfPath, pageNum);
      const cropWidthInput = document.getElementById('cropWidth');
      const cropHeightInput = document.getElementById('cropHeight');
      const originalPageSize = document.getElementById('originalPageSize');

      if (cropWidthInput) cropWidthInput.value = Math.round(dims.width);
      if (cropHeightInput) cropHeightInput.value = Math.round(dims.height);
      if (originalPageSize) {
        originalPageSize.textContent = `${Math.round(dims.width)} × ${Math.round(dims.height)} 点`;
      }
    } catch (error) {
      console.error('Failed to get page dimensions:', error);
    }

    if (cropPageModal) cropPageModal.classList.add('active');
  }

  function closeCropModalFunc() {
    if (cropPageModal) cropPageModal.classList.remove('active');
  }

  if (closeCropModal) closeCropModal.addEventListener('click', closeCropModalFunc);
  if (cancelCropModal) cancelCropModal.addEventListener('click', closeCropModalFunc);
  if (confirmCropBtn) confirmCropBtn.addEventListener('click', performCrop);

   // Delete Page modal event listeners
   const deletePageModal = document.getElementById('deletePageModal');
   const closeDeletePageModal = document.getElementById('closeDeletePageModal');
   const cancelDeletePageModal = document.getElementById('cancelDeletePageModal');
   const confirmDeletePageBtn = document.getElementById('confirmDeletePageBtn');

   function openDeletePageModal(pages) {
     const warning = document.getElementById('deletePageWarning');
     if (warning) {
       const pageList = pages.length <= 10
         ? pages.join(', ')
         : `${pages.slice(0, 10).join(', ')}...`;
       warning.textContent = `确定要删除以下 ${pages.length} 页吗？\n${pageList}`;
     }
     if (deletePageModal) deletePageModal.classList.add('active');
   }

   function closeDeletePageModalFunc() {
     if (deletePageModal) deletePageModal.classList.remove('active');
   }

   if (closeDeletePageModal) closeDeletePageModal.addEventListener('click', closeDeletePageModalFunc);
   if (cancelDeletePageModal) cancelDeletePageModal.addEventListener('click', closeDeletePageModalFunc);
   if (confirmDeletePageBtn) confirmDeletePageBtn.addEventListener('click', performDeletePages);

   // Merge PDF modal event listeners
  const mergeModal = document.getElementById('mergeModal');
  const closeMergeModal = document.getElementById('closeMergeModal');
  const cancelMergeModal = document.getElementById('cancelMergeModal');
  const confirmMergeBtn = document.getElementById('confirmMergeBtn');
  const addMergeFilesBtn = document.getElementById('addMergeFilesBtn');
  const mergeFilesList = document.getElementById('mergeFilesList');

  let mergeFiles = [];

  function openMergeModal() {
    mergeFiles = [];
    renderMergeFiles();
    if (mergeModal) mergeModal.classList.add('active');
  }

  function closeMergeModalFunc() {
    if (mergeModal) mergeModal.classList.remove('active');
  }

  function renderMergeFiles() {
    if (!mergeFilesList) return;
    mergeFilesList.innerHTML = '';
    
    mergeFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'merge-file-item';
      item.draggable = true;
      item.dataset.index = index;
      
      const safeFile = escapeHtml(file);
      const safeName = escapeHtml(file.split(/[\\/]/).pop());
      item.innerHTML = `
        <span class="file-icon">📄</span>
        <span class="file-name" title="${safeFile}">${safeName}</span>
        <span class="remove-file" title="移除">&times;</span>
      `;
      
      item.querySelector('.remove-file').addEventListener('click', (e) => {
        e.stopPropagation();
        mergeFiles.splice(index, 1);
        renderMergeFiles();
      });
      
      // Drag and drop reordering
      item.addEventListener('dragstart', (e) => {
        item.classList.add('dragging');
        e.dataTransfer.setData('text/plain', index);
      });
      
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingItem = mergeFilesList.querySelector('.dragging');
        if (draggingItem && draggingItem !== item) {
          const bounding = item.getBoundingClientRect();
          const offset = e.clientY - bounding.top - bounding.height / 2;
          if (offset > 0) {
            item.after(draggingItem);
          } else {
            item.before(draggingItem);
          }
        }
      });
      
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const toIndex = Array.from(mergeFilesList.children).indexOf(item);
        
        if (fromIndex !== toIndex) {
          const [movedFile] = mergeFiles.splice(fromIndex, 1);
          mergeFiles.splice(toIndex, 0, movedFile);
          renderMergeFiles();
        }
      });
      
      mergeFilesList.appendChild(item);
    });
  }

  if (closeMergeModal) closeMergeModal.addEventListener('click', closeMergeModalFunc);
  if (cancelMergeModal) cancelMergeModal.addEventListener('click', closeMergeModalFunc);
  if (confirmMergeBtn) confirmMergeBtn.addEventListener('click', performMerge);
  if (addMergeFilesBtn) {
    addMergeFilesBtn.addEventListener('click', async () => {
      const result = await window.pdfAPI.pickPDF();
      if (!result.canceled && result.filePaths) {
        mergeFiles.push(...result.filePaths);
        renderMergeFiles();
      }
    });
  }

  const handleBookmarkKeydown = (e) => {
    if (e.key === 'Enter') {
      saveBookmark();
    } else if (e.key === 'Escape') {
      closeBookmarkModalFunc();
    }
  };

  if (bookmarkTitleInput) bookmarkTitleInput.addEventListener('keydown', handleBookmarkKeydown);
  if (bookmarkPageInput) bookmarkPageInput.addEventListener('keydown', handleBookmarkKeydown);

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
        if (pdfEditor.selectedTextItem) {
          pdfEditor.updateSelectedTextStyle({ fontSize: parseInt(size) });
        } else {
          pdfEditor.setOptions({ fontSize: parseInt(size) });
        }
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
        if (pdfEditor.selectedTextItem) {
          pdfEditor.updateSelectedTextStyle({ textColor: color });
        } else {
          pdfEditor.setOptions({ textColor: color });
        }
      }
    });
  }

  // Font family
  const fontFamilySelect = document.getElementById('fontFamily');
  if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', (e) => {
      const font = e.target.value;
      if (pdfEditor) {
        if (pdfEditor.selectedTextItem) {
          pdfEditor.updateSelectedTextStyle({ fontFamily: font });
        } else {
          pdfEditor.setOptions({ fontFamily: font });
        }
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
    updateStatus(`工具：${getToolName(tool)}`);

    // Show/hide debug panel for text tool
    const textDebugInfo = document.getElementById('textDebugInfo');
    const textDebugContent = document.getElementById('textDebugContent');
    if (tool === 'text' && textDebugInfo) {
      textDebugInfo.style.display = 'block';
      textDebugContent.innerHTML = `
        <div>工具: ${escapeHtml(tool)}</div>
        <div>pdfEditor.tool: ${escapeHtml(pdfEditor.currentTool)}</div>
        <div>pdfEditor.textItems: ${pdfEditor.textItems ? pdfEditor.textItems.length : 'null'}</div>
        <div>currentPage: ${pdfEditor.currentPage}</div>
      `;
    } else if (textDebugInfo) {
      textDebugInfo.style.display = 'none';
    }
  } else {
    updateStatus(`工具：${getToolName(tool)} (编辑器未初始化)`);
  }
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

    // Save last opened file path
    await updateSetting('lastFilePath', currentPdfPath);

    // Clear thumbnail cache when opening a new PDF
    renderedThumbnails.clear();
    clearPageSelection(); // Clear page selection when opening new PDF

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

    // Show and load PDF properties
    const pdfProperties = document.getElementById('pdfProperties');
    if (pdfProperties) pdfProperties.style.display = 'block';
    await loadPDFProperties();

    // Initialize editor
    await initEditor();

    // Load outline and bookmarks for the new PDF
    await loadOutline();
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
    thumbnailItem.draggable = true;

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

    // Add click handler with Ctrl/Cmd for multi-select
    thumbnailItem.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Multi-select mode: toggle selection
        togglePageSelection(i);
      } else {
        // Normal mode: go to page
        goToPage(i);
      }
    });

    // Add drag and drop handlers
    thumbnailItem.addEventListener('dragstart', handleThumbnailDragStart);
    thumbnailItem.addEventListener('dragover', handleThumbnailDragOver);
    thumbnailItem.addEventListener('dragleave', handleThumbnailDragLeave);
    thumbnailItem.addEventListener('drop', handleThumbnailDrop);
    thumbnailItem.addEventListener('dragend', handleThumbnailDragEnd);
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

    const pdf = await getOrLoadPdfDocument(currentPdfPath);

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
  const pdf = await getOrLoadPdfDocument(currentPdfPath);

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

  // Setup resizable sidebar dividers
  setupResizableDividers();
}

// Setup resizable sidebar dividers
function setupResizableDividers() {
  const leftResizer = document.getElementById('leftResizer');
  const rightResizer = document.getElementById('rightResizer');
  const leftSidebar = document.getElementById('leftSidebar');
  const rightSidebar = document.getElementById('rightSidebar');

  let isResizing = false;
  let currentResizer = null;

  const minWidth = 180;
  const maxWidth = 400;

  function startResize(e, resizer, sidebar, isLeft) {
    isResizing = true;
    currentResizer = resizer;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const startWidth = sidebar.offsetWidth;

    function onMouseMove(e) {
      if (!isResizing) return;

      const delta = e.clientX - startX;
      let newWidth = isLeft ? startWidth + delta : startWidth - delta;
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      sidebar.style.width = `${newWidth}px`;
    }

    function onMouseUp() {
      isResizing = false;
      currentResizer = null;
      if (resizer) resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  if (leftResizer && leftSidebar) {
    leftResizer.addEventListener('mousedown', (e) => {
      startResize(e, leftResizer, leftSidebar, true);
    });
  }

  if (rightResizer && rightSidebar) {
    rightResizer.addEventListener('mousedown', (e) => {
      startResize(e, rightResizer, rightSidebar, false);
    });
  }
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

  // Create text layer for text selection
  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';
  textLayer.id = `textLayer_${pageNum}`;

  const editOverlay = document.createElement('div');
  editOverlay.className = 'page-edit-overlay';
  editOverlay.id = `editOverlay_${pageNum}`;

  const pageNumber = document.createElement('div');
  pageNumber.className = 'page-number-indicator';
  pageNumber.textContent = `第 ${pageNum} 页`;

  canvasContainer.appendChild(canvas);
  canvasContainer.appendChild(textLayer);
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

  // Set container size based on CSS dimensions from pageInfo
  canvasContainer.style.width = `${pageInfo.width}px`;
  canvasContainer.style.height = `${pageInfo.height}px`;

  // Render text layer for text selection
  await renderTextLayer(pageNum, canvas, textLayer);

  const ctx = canvas.getContext('2d', { alpha: false });
  const backgroundCache = ctx.getImageData(0, 0, canvas.width, canvas.height);

  window.setBackgroundCache(canvas.id, backgroundCache);

  // Update dimensions for first page
  if (pageNum === 1 && pdfEditor) {
    pdfEditor.pageWidth = pageInfo.width;
    pdfEditor.pageHeight = pageInfo.height;
    updateDimensions(pageInfo.width, pageInfo.height);
  }
}

// Render text layer for text selection
async function renderTextLayer(pageNum, canvas, textLayer) {
  try {
    const pdf = await getOrLoadPdfDocument(currentPdfPath);

    const page = await pdf.getPage(pageNum);
    const scale = pdfEditor ? pdfEditor.scale : 1.0;
    const viewport = page.getViewport({ scale });
    const pageRotation = page.rotate || 0;

    // Get text content
    const textContent = await page.getTextContent();

    // Set text layer size to match viewport
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;

    // Clear existing content
    textLayer.innerHTML = '';

    // Create text spans for each text item
    textContent.items.forEach((item, index) => {
      const tx = item.transform;
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      const textRotation = Math.atan2(tx[1], tx[0]) * (180 / Math.PI);

      // Calculate position with page rotation support
      let x = tx[4];
      let y = tx[5];

      // Adjust coordinates based on page rotation
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

      const span = document.createElement('span');
      span.textContent = item.str;
      span.className = 'text-layer-span';

      // Position the text span
      const finalY = viewport.height - y;

      span.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${finalY - fontSize}px;
        font-size: ${fontSize}px;
        font-family: ${item.fontName || 'sans-serif'};
        transform: rotate(${textRotation}deg);
        transform-origin: left bottom;
        white-space: pre;
        cursor: text;
        user-select: text;
        -webkit-user-select: text;
        color: transparent;
        pointer-events: auto;
      `;

      textLayer.appendChild(span);
    });

  } catch (error) {
    console.error(`Failed to render text layer for page ${pageNum}:`, error);
  }
}

// Setup multi-page editing support
function setupMultiPageEditing() {
  if (!pdfEditor) return;

  // Find all page canvases and setup event listeners
  document.querySelectorAll('.page-canvas').forEach((canvas) => {
    const pageNum = parseInt(canvas.id.split('_')[1]);

    // Skip if already initialized
    if (canvas.dataset.eventsInitialized === 'true') {
      return;
    }
    canvas.dataset.eventsInitialized = 'true';

    // Setup event listeners for each page canvas
    canvas.style.imageRendering = 'optimizeSpeed';
    canvas.addEventListener('mousedown', (e) => handlePageMouseDown(e, pageNum));
    canvas.addEventListener('mousemove', (e) => handlePageMouseMove(e, pageNum));
    canvas.addEventListener('mouseup', (e) => handlePageMouseUp(e, pageNum));
    canvas.addEventListener('mouseleave', (e) => handlePageMouseLeave(e, pageNum));
  });

  // Setup text layer event handling using event delegation on pagesContainer
  const pagesContainer = document.getElementById('pagesContainer');
  if (pagesContainer && !pagesContainer.dataset.textEventsDelegated) {
    pagesContainer.dataset.textEventsDelegated = 'true';

    pagesContainer.addEventListener('mousedown', (e) => {
      const textLayer = e.target.closest('.text-layer');
      if (!textLayer) return;
      if (currentTool === 'text' || currentTool === 'select') {
        if (e.target.classList.contains('text-layer-span')) {
          e.stopPropagation();
        }
      }
    });

    pagesContainer.addEventListener('dblclick', (e) => {
      const textLayer = e.target.closest('.text-layer');
      if (!textLayer) return;
      if (currentTool === 'text' || currentTool === 'select') {
        e.stopPropagation();
      }
    });

    pagesContainer.addEventListener('copy', (e) => {
      const textLayer = e.target.closest('.text-layer');
      if (!textLayer) return;
      const selection = window.getSelection();
      if (selection && selection.toString()) {
        e.clipboardData.setData('text/plain', selection.toString());
        e.preventDefault();
        updateStatus('文本已复制到剪贴板');
      }
    });
  }
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
  // Use getBoundingClientRect to get actual rendered size (accounts for CSS transform/scale)
  const containerRect = container.getBoundingClientRect();
  pdfEditor.pageWidth = containerRect.width;
  pdfEditor.pageHeight = containerRect.height;
  pdfEditor.scale = currentZoom / 100;

  // Update debug panel
  updateTextDebugPanel(`点击事件 | page=${pageNum} | tool=${currentTool} | pdfTool=${pdfEditor.currentTool} | textItems=${pdfEditor.textItems ? pdfEditor.textItems.length : 0}`);

  // Load background cache from canvas dataset if available
  const cached = window.getBackgroundCache(e.target.id);
  if (cached) {
    pdfEditor.backgroundCache = cached;
  }

  // Load text content for this page if using text tool or select tool
  if (currentTool === 'text' || currentTool === 'select') {
    const cacheKey = `page_${pageNum}`;
    const isCached = pdfEditor.textItemsCache && pdfEditor.textItemsCache.has(cacheKey);

    updateTextDebugPanel(`text/select工具点击 | isCached=${isCached} | textItems=${pdfEditor.textItems ? pdfEditor.textItems.length : 0}`);

    if (isCached) {
      // Text already cached - handle click synchronously for instant response
      pdfEditor.textItems = pdfEditor.textItemsCache.get(cacheKey);
      const textStatus = pdfEditor.getTextStatus();
      if (textStatus.status === 'editable') {
        updatePdfStatus('editable', textStatus.itemCount + ' 个文本项');
      } else if (textStatus.status === 'empty') {
        updatePdfStatus('scanned', '此页面无文本内容');
      } else if (textStatus.status === 'error') {
        updatePdfStatus('error', textStatus.message);
      }
      pdfEditor.handleMouseDown(e);
    } else {
      // Text not cached - load asynchronously, then handle click
      updatePdfStatus('checking', '正在检查文档...');
      pdfEditor.loadTextForPage(pageNum).then(() => {
        const textStatus = pdfEditor.getTextStatus();
        updateTextDebugPanel(`文本加载完成 | items=${textStatus.itemCount} | status=${textStatus.status}`);
        if (textStatus.status === 'editable') {
          let itemCount = textStatus.itemCount;
          updatePdfStatus('editable', itemCount + ' 个文本项');
        } else if (textStatus.status === 'empty') {
          updatePdfStatus('scanned', '此页面无文本内容');
        } else if (textStatus.status === 'error') {
          updatePdfStatus('error', textStatus.message);
        }
        pdfEditor.handleMouseDown(e);
      });
    }
  } else {
    pdfEditor.handleMouseDown(e);
  }
}

function updateTextDebugPanel(message) {
  const textDebugContent = document.getElementById('textDebugContent');
  if (textDebugContent) {
    textDebugContent.innerHTML = `
      <div>工具: ${escapeHtml(currentTool)}</div>
      <div>pdfEditor.tool: ${pdfEditor ? escapeHtml(pdfEditor.currentTool) : 'N/A'}</div>
      <div>pdfEditor.textItems: ${pdfEditor && pdfEditor.textItems ? pdfEditor.textItems.length : 'null'}</div>
      <div>currentPage: ${pdfEditor ? pdfEditor.currentPage : 'N/A'}</div>
      <div style="margin-top: 5px; color: #856404;">${escapeHtml(message || '')}</div>
    `;
  }
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

    // Initialize PDF.js first (before pdfEditor.init which depends on it)
    await initPDFJS();

    pdfEditor = new PDFEditor();
    
    // Set up undo/redo status change handler
    pdfEditor.setOnChange((status) => {
      updateUndoRedoUI(status);
    });

    // Initialize editor (pdfCanvas is null in multi-page mode, each page has its own canvas)
    const info = await pdfEditor.init(null, currentPdfPath);
    totalPages = info.totalPages;
    currentPage = 1;

    // Set up page change handler for UI navigation (buttons, thumbnails)
    pdfEditor.setPageChangeHandler((pageNum) => {
      scrollToPage(pageNum);
    });

    updatePageInfo();

    // Render all pages for continuous scroll view
    await renderAllPages();

    // Pre-load text content for the first page so user can select text immediately
    if (pdfEditor) {
      try {
        pdfEditor.currentPage = 1;
        await pdfEditor.loadTextForPage(1);
        const textStatus = pdfEditor.getTextStatus();
        if (textStatus.status === 'editable') {
          let cnt = textStatus.itemCount; updatePdfStatus("editable", cnt + " 个文本项");
        } else if (textStatus.status === 'empty') {
          updatePdfStatus('scanned', '此页面无文本内容');
        }
        updateTextDebugPanel('第一页文本已预加载 | items=' + textStatus.itemCount);
      } catch (err) {
        console.warn('预加载文本失败:', err);
      }
    }

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
        if (DEBUG_MODE) console.log('[BACKGROUND] Reached preload limit: ' + MAX_PRELOAD_PAGES);
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
          const cacheKey = currentPdfPath + '_' + pageNum;
          if (!pdfPageCache.has(cacheKey)) {
            const lib = await initPDFJS();
            const pdf = pdfDocumentCache.get(currentPdfPath);
            if (pdf) {
              const page = await pdf.getPage(pageNum);
              if (pdfPageCache.size >= CACHE_CONFIG.MAX_PAGE_CACHE_SIZE) {
                cleanupCache();
              }
              pdfPageCache.set(cacheKey, page);
              loadedPages.add(pageNum);
              if (DEBUG_MODE) console.log('[BACKGROUND] Loaded page ' + pageNum);
            }
          } else {
            loadedPages.add(pageNum);
          }
        } catch (error) {
          if (DEBUG_MODE) console.log('[BACKGROUND] Failed to load page ' + pageNum + ':', error.message);
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
  const pageElement = pagesContainer.querySelector('[data-page="' + pageNum + '"]');
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Update thumbnail active state
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.page) === currentPage);
  });

  // Load text content for the new page if using text tool
  if (pdfEditor && currentTool === 'text') {
    const pageWrapper = pageElement;
    if (pageWrapper) {
      const canvas = pageWrapper.querySelector('.page-canvas');
      if (canvas) {
        const container = canvas.parentElement;
        // Use getBoundingClientRect to get actual rendered size (accounts for CSS transform/scale)
        const containerRect = container.getBoundingClientRect();
        pdfEditor.pageWidth = containerRect.width;
        pdfEditor.pageHeight = containerRect.height;
        pdfEditor.scale = currentZoom / 100;
      }
    }
    await pdfEditor.loadTextForPage(pageNum);
    const textStatus = pdfEditor.getTextStatus();
    if (textStatus.status === 'editable') {
      updatePdfStatus('editable', `${textStatus.itemCount} 个文本项`);
    } else if (textStatus.status === 'empty') {
      updatePdfStatus('scanned', '此页面无文本内容');
    } else if (textStatus.status === 'error') {
      updatePdfStatus('error', textStatus.message);
    }
  }

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

// Toggle page selection (for multi-select delete)
function togglePageSelection(pageNum) {
  if (selectedPages.has(pageNum)) {
    selectedPages.delete(pageNum);
  } else {
    selectedPages.add(pageNum);
  }
  updatePageSelectionUI();
  updateSelectionStatus();
}

// Update page thumbnail selection UI
function updatePageSelectionUI() {
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    const page = parseInt(item.dataset.page);
    item.classList.toggle('selected', selectedPages.has(page));
  });
}

// Update selection status display
function updateSelectionStatus() {
  if (pageStatus) {
    if (selectedPages.size > 0) {
      pageStatus.textContent = `已选择 ${selectedPages.size} 页 / 页面：${currentPage} / ${totalPages}`;
    } else {
      pageStatus.textContent = `页面：${currentPage} / ${totalPages}`;
    }
  }
}

// Clear all page selections
function clearPageSelection() {
  selectedPages.clear();
  updatePageSelectionUI();
  updateSelectionStatus();
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

  // Update pdfEditor scale
  if (pdfEditor) {
    pdfEditor.scale = currentZoom / 100;

    // Debounce text layer re-render to avoid rapid re-renders during zoom
    if (window.textLayerRenderTimeout) {
      clearTimeout(window.textLayerRenderTimeout);
    }
    window.textLayerRenderTimeout = setTimeout(() => {
      // Re-render text layers at new scale
      document.querySelectorAll('.page-canvas-wrapper').forEach((pageWrapper) => {
        const pageNum = parseInt(pageWrapper.dataset.page);
        const canvas = pageWrapper.querySelector('.page-canvas');
        const textLayer = pageWrapper.querySelector('.text-layer');
        if (canvas && textLayer) {
          renderTextLayer(pageNum, canvas, textLayer);
        }
      });
    }, 300);

    // Re-render at higher resolution if zoom > 100%
    if (currentZoom > 100) {
      if (window.zoomRenderTimeout) {
        clearTimeout(window.zoomRenderTimeout);
      }
      window.zoomRenderTimeout = setTimeout(() => {
        const newScale = currentZoom / 100;
        if (newScale > pdfEditor.scale) {
          pdfEditor.scale = newScale;
          renderAllPages();
        }
      }, 500);
    }
  }
}

// Update undo/redo UI states
function updateUndoRedoUI(status) {
  const undoBtns = [document.getElementById('undoBtn'), document.getElementById('undoToolbarBtn')];
  const redoBtns = [document.getElementById('redoBtn'), document.getElementById('redoToolbarBtn')];
  const undoMenuItem = document.querySelector('.submenu-item[data-action="undo"]');
  const redoMenuItem = document.querySelector('.submenu-item[data-action="redo"]');

  undoBtns.forEach(btn => {
    if (btn) {
      btn.disabled = !status.canUndo;
      btn.classList.toggle('disabled', !status.canUndo);
    }
  });

  redoBtns.forEach(btn => {
    if (btn) {
      btn.disabled = !status.canRedo;
      btn.classList.toggle('disabled', !status.canRedo);
    }
  });

  // Update menu submenu items
  if (undoMenuItem) {
    undoMenuItem.classList.toggle('disabled', !status.canUndo);
  }
  if (redoMenuItem) {
    redoMenuItem.classList.toggle('disabled', !status.canRedo);
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
        await window.pdfAPI.writeFile(result.filePath, Array.from(modifiedBuffer));
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
  openMergeModal();
}

// Handle new file - close current and prompt to open new
function clearAllPendingTimers() {
  if (window.textLayerRenderTimeout) {
    clearTimeout(window.textLayerRenderTimeout);
    window.textLayerRenderTimeout = null;
  }
  if (window.zoomRenderTimeout) {
    clearTimeout(window.zoomRenderTimeout);
    window.zoomRenderTimeout = null;
  }
}

function cleanupObservers() {
  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
    thumbnailObserver = null;
  }
}

async function handleNewFile() {
  if (pdfEditor && currentPdfPath) {
    const operations = pdfEditor.getOperations();
    if (operations.length > 0) {
      if (!confirm('当前有未保存的编辑，确定要关闭吗？')) {
        return;
      }
    }
  }

  clearAllPendingTimers();
  cleanupObservers();
  renderedThumbnails.clear();
  backgroundCacheMap.clear();

  if (pdfEditor) {
    pdfEditor.cleanup();
  }
  currentPdfPath = null;
  selectedFiles = [];
  totalPages = 0;
  currentPage = 1;

  const pagesContainer = document.getElementById('pagesContainer');
  if (pagesContainer) pagesContainer.innerHTML = '';
  const thumbnailList = document.getElementById('thumbnailList');
  if (thumbnailList) {
    thumbnailList.innerHTML = '';
    thumbnailList.style.display = 'none';
  }

  const welcomePanel = document.getElementById('welcomePanel');
  if (welcomePanel) welcomePanel.style.display = 'flex';

  updateStatus('准备就绪');
}

// Handle save as - save to new location
async function handleSaveAs() {
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
      const defaultName = currentPdfPath ? currentPdfPath.split(/[\\/]/).pop().replace('.pdf', '_edited.pdf') : 'edited.pdf';
      const result = await window.pdfAPI.saveDialog(defaultName);
      if (!result.canceled && result.filePath) {
        await window.pdfAPI.writeFile(result.filePath, Array.from(modifiedBuffer));
        updateStatus('另存成功：' + result.filePath);
      }
    } else {
      const blob = new Blob([modifiedBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      updateStatus('另存成功');
    }
  } catch (error) {
    handleError(error);
  }
}

// Handle close file
async function handleCloseFile() {
  await handleNewFile();
}

// View control functions
function handleZoomIn() {
  const zoomInBtn = document.getElementById('zoomInBtn');
  if (zoomInBtn) zoomInBtn.click();
}

function handleZoomOut() {
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  if (zoomOutBtn) zoomOutBtn.click();
}

function handleZoomReset() {
  setZoom(100);
  updateStatus('缩放已重置为 100%');
}

function toggleLeftSidebar() {
  const leftSidebar = document.getElementById('leftSidebar');
  if (leftSidebar) {
    leftSidebar.classList.toggle('collapsed');
    const isCollapsed = leftSidebar.classList.contains('collapsed');
    updateStatus(isCollapsed ? '左侧面板已隐藏' : '左侧面板已显示');
  }
}

function toggleRightSidebar() {
  const rightSidebar = document.getElementById('rightSidebar');
  if (rightSidebar) {
    rightSidebar.classList.toggle('collapsed');
    const isCollapsed = rightSidebar.classList.contains('collapsed');
    updateStatus(isCollapsed ? '右侧面板已隐藏' : '右侧面板已显示');
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      updateStatus('无法进入全屏模式');
    });
  } else {
    document.exitFullscreen();
  }
}

async function performMerge() {
  try {
    if (mergeFiles.length < 2) {
      alert('请至少选择 2 个 PDF 文件进行合并');
      return;
    }

    updateStatus(`正在合并 ${mergeFiles.length} 个 PDF 文件...`);
    const mergedBuffer = await window.pdfAPI.merge(mergeFiles);

    // Extract filename from last selected file for naming
    const lastFileName = mergeFiles[mergeFiles.length - 1].split(/[\\/]/).pop().replace('.pdf', '');
    saveFile(mergedBuffer, `${lastFileName}_merged.pdf`);
    updateStatus(`合并完成，共 ${mergeFiles.length} 个文件`);
    closeMergeModalFunc();
  } catch (error) {
    handleError(error);
  }
}

async function handleSplit() {
  openSplitModal();
}

async function performSplit() {
  try {
    const pdfPath = currentPdfPath;
    if (!pdfPath) return;

    const rangesInput = document.getElementById('splitRanges');
    const ranges = rangesInput.value.trim();
    
    if (!ranges) {
      alert('请输入拆分范围');
      return;
    }

    updateStatus('正在拆分 PDF...');
    const splitBuffers = await window.pdfAPI.split(pdfPath, ranges.split(','));
    
    if (splitBuffers && splitBuffers.length > 0) {
      splitBuffers.forEach((buffer, index) => {
        saveFile(buffer, `split_${index + 1}.pdf`);
      });
      updateStatus(`拆分完成，共 ${splitBuffers.length} 个文件`);
      closeSplitModalFunc();
    }
  } catch (error) {
    handleError(error);
  }
}

async function handleWatermark() {
  openWatermarkModal();
}

async function performWatermark() {
  try {
    const pdfPath = currentPdfPath;
    if (!pdfPath) {
      alert('请先打开 PDF 文件');
      return;
    }

    const textInput = document.getElementById('watermarkText');
    const text = textInput.value.trim();
    if (!text) {
      alert('请输入水印文字');
      return;
    }

    const opacity = parseInt(document.getElementById('watermarkOpacity').value) / 100;

    updateStatus('正在添加水印...');
    const watermarkedBuffer = await window.pdfAPI.watermark(pdfPath, text, { opacity });
    saveFile(watermarkedBuffer, 'watermarked.pdf');
    updateStatus('水印添加完成');
    closeWatermarkModalFunc();
  } catch (error) {
    handleError(error);
  }
}

// Rotate page handler
async function handleRotatePage(degrees, pageNumbers = null) {
  try {
    if (!currentPdfPath) {
      updateStatus('请先打开 PDF 文件');
      return;
    }

    // Determine which pages to rotate
    let pagesToRotate;
    if (pageNumbers) {
      pagesToRotate = pageNumbers;
    } else if (selectedPages.size > 0) {
      pagesToRotate = Array.from(selectedPages).sort((a, b) => a - b);
    } else {
      pagesToRotate = [currentPage];
    }

    const pageCount = pagesToRotate.length;
    updateStatus(`正在旋转 ${pageCount} 个页面...`);
    
    const rotatedBuffer = await window.pdfAPI.rotate(currentPdfPath, pagesToRotate, degrees);

    // Save back to original file
    await window.pdfAPI.writeFile(currentPdfPath, rotatedBuffer);
    updateStatus(`已旋转 ${pageCount} 个页面 ${degrees}°`);

    // Reload to show changes
    await reloadCurrentPDF();
  } catch (error) {
    handleError(error);
    updateStatus('旋转页面失败');
  }
}

// Delete page handler
async function handleDeletePage() {
  if (!currentPdfPath) {
    updateStatus('请先打开 PDF 文件');
    return;
  }

  // Determine which pages to delete
  let pagesToDelete;
  if (selectedPages.size > 0) {
    pagesToDelete = Array.from(selectedPages).sort((a, b) => a - b);
  } else {
    pagesToDelete = [currentPage];
  }

  openDeletePageModal(pagesToDelete);
}

async function performDeletePages() {
  try {
    let pagesToDelete;
    if (selectedPages.size > 0) {
      pagesToDelete = Array.from(selectedPages).sort((a, b) => a - b);
    } else {
      pagesToDelete = [currentPage];
    }

    updateStatus('正在删除页面...');
    const deletedBuffer = await window.pdfAPI.deletePages(currentPdfPath, pagesToDelete);

    const saveToOriginal = document.getElementById('saveToOriginal').checked;

    if (saveToOriginal) {
      await window.pdfAPI.writeFile(currentPdfPath, deletedBuffer);
      updateStatus(`已删除 ${pagesToDelete.length} 页并保存`);
      closeDeletePageModalFunc();
      clearPageSelection();
      await reloadCurrentPDF();
    } else {
      const result = await window.pdfAPI.saveDialog('modified.pdf');
      if (!result.canceled && result.filePath) {
        await window.pdfAPI.writeFile(result.filePath, Array.from(deletedBuffer));
        updateStatus(`已删除 ${pagesToDelete.length} 页并另存为`);
        closeDeletePageModalFunc();
        clearPageSelection();
        await reloadCurrentPDF();
      } else {
        updateStatus('已取消保存');
      }
    }
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
  openProtectModal();
}

async function performProtect() {
  try {
    if (!currentPdfPath) {
      alert('请先打开 PDF 文件');
      return;
    }

    const userPassword = document.getElementById('userPassword').value;
    if (!userPassword) {
      alert('请输入打开密码');
      return;
    }

    const ownerPassword = document.getElementById('ownerPassword').value || userPassword;
    const permissions = {
      printing: document.getElementById('allowPrinting').checked ? 'highResolution' : 'none',
      modifying: document.getElementById('allowModifying').checked,
      copying: document.getElementById('allowCopying').checked,
      annotating: document.getElementById('allowModifying').checked
    };

    updateStatus('正在加密 PDF...');
    const protectedBuffer = await window.pdfAPI.protect(currentPdfPath, userPassword, ownerPassword, permissions);

    // Save the protected file
    const result = await window.pdfAPI.saveDialog('protected.pdf');
    if (!result.canceled && result.filePath) {
      await window.pdfAPI.writeFile(result.filePath, Array.from(protectedBuffer));
      updateStatus(`PDF 已加密保护，已保存到：${result.filePath}`);
      closeProtectModalFunc();
    }
  } catch (error) {
    handleError(error);
  }
}

async function performAddPageNumbers() {
  try {
    if (!currentPdfPath) {
      alert('请先打开 PDF 文件');
      return;
    }

    const format = document.getElementById('pageNumberFormat').value;
    const position = document.getElementById('pageNumberPosition').value;
    const fontSize = parseInt(document.getElementById('pageNumberFontSize').value) || 12;
    const startPage = parseInt(document.getElementById('pageNumberStart').value) || 1;
    const skipFirst = document.getElementById('skipFirstPage').checked;
    const customFormat = document.getElementById('customPageFormat')?.value || '{page} / {total}';

    const options = {
      format,
      position,
      fontSize,
      startPage,
      skipFirst,
      customFormat
    };

    updateStatus('正在添加页码...');
    const result = await window.pdfAPI.addPageNumbers(currentPdfPath, options);

    // Save the file with page numbers
    const saveResult = await window.pdfAPI.saveDialog('numbered.pdf');
    if (!saveResult.canceled && saveResult.filePath) {
      await window.pdfAPI.writeFile(saveResult.filePath, Array.from(result));
      updateStatus(`页码已添加，已保存到：${saveResult.filePath}`);
      closePageNumbersModalFunc();
    }
  } catch (error) {
    handleError(error);
  }
}

async function loadPDFProperties() {
  if (!currentPdfPath) return;

  try {
    const pdfInfo = await window.pdfAPI.loadPDF(currentPdfPath);

    const titleInput = document.getElementById('pdfTitle');
    const authorInput = document.getElementById('pdfAuthor');
    const subjectInput = document.getElementById('pdfSubject');
    const keywordsInput = document.getElementById('pdfKeywords');
    const creatorInput = document.getElementById('pdfCreator');
    const producerInput = document.getElementById('pdfProducer');

    if (titleInput) titleInput.value = pdfInfo.title || '';
    if (authorInput) authorInput.value = pdfInfo.author || '';
    if (subjectInput) subjectInput.value = pdfInfo.subject || '';
    if (keywordsInput) keywordsInput.value = pdfInfo.keywords || '';
    if (creatorInput) creatorInput.value = pdfInfo.creator || '';
    if (producerInput) producerInput.value = pdfInfo.producer || '';
  } catch (error) {
    console.error('Failed to load PDF properties:', error);
  }
}

async function handleSaveProperties() {
  if (!currentPdfPath) {
    alert('请先打开 PDF 文件');
    return;
  }

  try {
    const metadata = {
      title: document.getElementById('pdfTitle')?.value || '',
      author: document.getElementById('pdfAuthor')?.value || '',
      subject: document.getElementById('pdfSubject')?.value || '',
      keywords: document.getElementById('pdfKeywords')?.value || '',
      creator: document.getElementById('pdfCreator')?.value || '',
      modificationDate: new Date()
    };

    updateStatus('正在保存属性...');
    const result = await window.pdfAPI.setMetadata(currentPdfPath, metadata);

    // Save back to the original file
    await window.pdfAPI.writeFile(currentPdfPath, Array.from(result));
    updateStatus('PDF 属性已保存');

    // Reload properties
    await loadPDFProperties();
  } catch (error) {
    console.error('Failed to save properties:', error);
    handleError(error);
    updateStatus('保存属性失败');
  }
}

async function handleInsertBlankPage(insertAfterPage) {
  if (!currentPdfPath) return;

  try {
    updateStatus('正在插入空白页...');
    const result = await window.pdfAPI.insertBlankPage(currentPdfPath, insertAfterPage);

    // Save back to the original file
    await window.pdfAPI.writeFile(currentPdfPath, Array.from(result));
    updateStatus('空白页已插入');

    // Reload the PDF
    await reloadCurrentPDF();

    // Go to the new page
    goToPage(insertAfterPage + 2);
  } catch (error) {
    console.error('Failed to insert blank page:', error);
    handleError(error);
    updateStatus('插入空白页失败');
  }
}

async function handleInsertFromPdf(insertAfterPage) {
  if (!currentPdfPath) return;

  try {
    // Open file picker to select source PDF
    const result = await window.pdfAPI.pickFile();
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return;
    }

    const sourcePath = result.filePaths[0];

    // Get source PDF info
    const sourceInfo = await window.pdfAPI.loadPDF(sourcePath);
    const sourcePageCount = sourceInfo.pageCount;

    if (sourcePageCount === 0) {
      alert('源 PDF 文件没有页面');
      return;
    }

    // For simplicity, insert all pages from source PDF
    // In a more advanced version, we could show a dialog to select specific pages
    const sourcePages = Array.from({ length: sourcePageCount }, (_, i) => i + 1);

    updateStatus(`正在从 ${sourcePath.split('/').pop()} 插入 ${sourcePageCount} 页...`);

    const pdfResult = await window.pdfAPI.insertPages(currentPdfPath, sourcePath, insertAfterPage, sourcePages);

    // Save back to the original file
    await window.pdfAPI.writeFile(currentPdfPath, Array.from(pdfResult));
    updateStatus(`已插入 ${sourcePageCount} 页`);

    // Reload the PDF
    await reloadCurrentPDF();

    // Go to the first inserted page
    goToPage(insertAfterPage + 2);
  } catch (error) {
    console.error('Failed to insert pages from PDF:', error);
    handleError(error);
    updateStatus('插入页面失败');
  }
}

async function performCrop() {
  if (!currentPdfPath) return;

  try {
    const pageNum = parseInt(document.getElementById('cropPageNum')?.value) || 1;
    const x = parseFloat(document.getElementById('cropX')?.value) || 0;
    const y = parseFloat(document.getElementById('cropY')?.value) || 0;
    const width = parseFloat(document.getElementById('cropWidth')?.value);
    const height = parseFloat(document.getElementById('cropHeight')?.value);

    if (!width || !height || width <= 0 || height <= 0) {
      alert('请输入有效的裁剪尺寸');
      return;
    }

    const pageCrops = [{ page: pageNum, x, y, width, height }];

    updateStatus(`正在裁剪第 ${pageNum} 页...`);
    const result = await window.pdfAPI.cropPages(currentPdfPath, pageCrops);

    // Save back to the original file
    await window.pdfAPI.writeFile(currentPdfPath, Array.from(result));
    updateStatus(`第 ${pageNum} 页已裁剪`);

    // Close modal
    const cropPageModal = document.getElementById('cropPageModal');
    if (cropPageModal) cropPageModal.classList.remove('active');

    // Reload the PDF
    await reloadCurrentPDF();
  } catch (error) {
    console.error('Failed to crop page:', error);
    handleError(error);
    updateStatus('裁剪页面失败');
  }
}

async function handleCompressPDF() {
  if (!currentPdfPath) {
    alert('请先打开 PDF 文件');
    return;
  }

  try {
    updateStatus('正在压缩 PDF...');

    const result = await window.pdfAPI.compressPDF(currentPdfPath);

    // Save the compressed file
    const saveResult = await window.pdfAPI.saveDialog('compressed.pdf');
    if (!saveResult.canceled && saveResult.filePath) {
      await window.pdfAPI.writeFile(saveResult.filePath, result.data);
      
      const originalMB = (result.originalSize / 1024 / 1024).toFixed(2);
      const compressedMB = (result.compressedSize / 1024 / 1024).toFixed(2);
      
      updateStatus(`压缩完成: ${originalMB}MB → ${compressedMB}MB (节省 ${result.compressionRatio}%)`);
    }
  } catch (error) {
    console.error('Failed to compress PDF:', error);
    handleError(error);
    updateStatus('压缩 PDF 失败');
  }
}

// Reload current PDF from disk after modifications
async function reloadCurrentPDF() {
  try {
    if (!currentPdfPath) return;

    // Clear any previous page selection
    clearPageSelection();

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

function updatePdfStatus(status, details) {
  const pdfStatus = document.getElementById('pdfStatus');
  if (!pdfStatus) return;

  pdfStatus.className = 'pdf-status-indicator ' + status;

  const statusTexts = {
    loading: '正在加载...',
    checking: '正在检查文档...',
    editable: '✅ 可编辑',
    scanned: '⚠️ 扫描件',
    protected: '🔒 受保护',
    error: '❌ 加载失败',
    empty: '⚠️ 无文本'
  };

  pdfStatus.textContent = statusTexts[status] || status;

  if (details) {
    pdfStatus.title = details;
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  setTimeout(() => {
    initEventListeners();
  }, 100);
  
  updateStatus('准备就绪');

  // Load settings and auto-open last file if enabled
  await loadAppSettings();

  // Auto-open last file if setting is enabled and file exists
  if (appSettings.openLastFile && appSettings.lastFilePath) {
    try {
      const fs = await window.pdfAPI.readFile(appSettings.lastFilePath);
      if (fs && fs.length > 0) {
        updateStatus('正在打开上次文件...');
        const fileName = appSettings.lastFilePath.split(/[\\/]/).pop();
        const files = [{
          path: appSettings.lastFilePath,
          name: fileName
        }];
        await handleSelectedFiles(files);
        return;
      }
    } catch (error) {
      if (DEBUG_MODE) console.log('Last file no longer exists:', appSettings.lastFilePath);
      await updateSetting('lastFilePath', '');
    }
  }
});
