// PDF Editor Renderer Process

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

    pdfjsLib = await import(pdfjsUrl);
    if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    }

    console.log('PDF.js initialized');
  } catch (error) {
    console.error('Failed to initialize PDF.js:', error);
    throw error;
  }

  return pdfjsLib;
}

// Global function for preload to call
window.renderPDFPage = async (filePath, pageNum, canvas, scale) => {
  try {
    // Ensure PDF.js is loaded
    const lib = await initPDFJS();
    if (!lib) {
      throw new Error('PDF.js not loaded');
    }

    const fileData = await window.pdfAPI.readFile(filePath);
    const typedArray = new Uint8Array(fileData);

    const pdf = await lib.getDocument(typedArray).promise;
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    const renderTask = page.render({
      canvasContext: ctx,
      viewport: viewport
    });
    await renderTask.promise;

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
let pdfCanvas;
let canvasWrapper;
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
  pdfCanvas = document.getElementById('pdfCanvas');
  canvasWrapper = document.getElementById('canvasWrapper');
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
    currentPdfPath = selectedFiles[0].path;
    updateStatus(`已选择：${selectedFiles[0].name}`);

    // Update UI
    if (uploadPlaceholder) uploadPlaceholder.style.display = 'none';
    if (thumbnailList) thumbnailList.style.display = 'flex';
    if (welcomePanel) welcomePanel.style.display = 'none';
    if (quickActions) quickActions.style.display = 'flex';

    // Initialize editor
    await initEditor();

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

// Generate page thumbnails
async function generateThumbnails() {
  if (!currentPdfPath || !pdfEditor) return;

  thumbnailList.innerHTML = '';

  const lib = await initPDFJS();
  const fileData = await window.pdfAPI.readFile(currentPdfPath);
  const typedArray = new Uint8Array(fileData);
  const pdf = await lib.getDocument(typedArray).promise;

  for (let i = 1; i <= totalPages; i++) {
    const thumbnailItem = document.createElement('div');
    thumbnailItem.className = 'thumbnail-item';
    thumbnailItem.dataset.page = i;

    const canvas = document.createElement('canvas');
    canvas.className = 'thumbnail-canvas';
    canvas.width = 150;
    canvas.height = 200;

    const pageNum = document.createElement('div');
    pageNum.className = 'thumbnail-number';
    pageNum.textContent = `第 ${i} 页`;

    thumbnailItem.appendChild(canvas);
    thumbnailItem.appendChild(pageNum);
    thumbnailList.appendChild(thumbnailItem);

    // Add click handler
    thumbnailItem.addEventListener('click', () => {
      goToPage(i);
    });

    // Render actual thumbnail
    try {
      const page = await pdf.getPage(i);
      const scale = 150 / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;
    } catch (error) {
      console.error(`Failed to render thumbnail for page ${i}:`, error);
      // Fallback to placeholder
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, 150, 200);
      ctx.fillStyle = '#ccc';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Page ${i}`, 75, 100);
    }
  }
}

// Update PDF preview
let previewBlobUrl = null; // Store blob URL for cleanup

function updatePreview() {
  const iframe = document.getElementById('pdfPreview');

  // Revoke previous blob URL to prevent memory leak
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }

  if (selectedFiles.length > 0) {
    const firstFile = selectedFiles[0];
    if (firstFile instanceof Blob) {
      previewBlobUrl = URL.createObjectURL(firstFile);
      iframe.src = previewBlobUrl;
      return;
    }
    if (firstFile && firstFile.path) {
      const normalizedPath = firstFile.path.replace(/\\/g, '/');
      iframe.src = encodeURI(`file://${normalizedPath}`);
    }
  }
}

// Initialize PDF editor
async function initEditor() {
  try {
    updateStatus('正在加载编辑器...');

    pdfEditor = new PDFEditor();
    const info = await pdfEditor.init(pdfCanvas, currentPdfPath);
    totalPages = info.totalPages;
    currentPage = 1;

    // Set up page change handler for wheel navigation
    pdfEditor.setPageChangeHandler((pageNum) => {
      goToPage(pageNum);
    });

    updatePageInfo();

    // Show editor UI
    if (toolProperties) toolProperties.style.display = 'block';
    if (pageNavSection) pageNavSection.style.display = 'block';
    if (actionsSection) actionsSection.style.display = 'block';
    if (pageManagementSection) pageManagementSection.style.display = 'block';
    if (exportSection) exportSection.style.display = 'block';
    if (securitySection) securitySection.style.display = 'block';

    // Select default tool
    selectTool('select');

    // Generate thumbnails after editor is initialized
    generateThumbnails();

    updateStatus('编辑器已就绪');
  } catch (error) {
    console.error('Init editor error:', error);
    handleError(error);
    updateStatus('编辑器加载失败：' + error.message);
  }
}

// Go to specific page
async function goToPage(pageNum) {
  if (!pdfEditor) return;

  currentPage = pageNum;
  await pdfEditor.renderPage(currentPage);
  updatePageInfo();

  // Update thumbnail active state
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.page) === currentPage);
  });
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

  // Apply zoom to canvas container instead of canvas directly
  // This avoids coordinate calculation issues with getBoundingClientRect
  if (canvasWrapper) {
    canvasWrapper.style.transform = `scale(${currentZoom / 100})`;
    canvasWrapper.style.transformOrigin = 'center center';
  }

  updateStatus(`缩放：${currentZoom}%`);
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
    if (selectedFiles.length < 2) {
      updateStatus('请选择至少 2 个文件进行合并');
      return;
    }

    currentOperation = 'merge';
    const filePaths = selectedFiles.map(file => file.path);

    if (window.pdfAPI) {
      const mergedBuffer = await window.pdfAPI.merge(filePaths);
      saveFile(mergedBuffer, 'merged.pdf');
    }
  } catch (error) {
    handleError(error);
  }
}

async function handleSplit() {
  try {
    currentOperation = 'split';
    const ranges = prompt('输入拆分范围（如：1-3,4-5）');
    if (!ranges) return;

    const splitBuffers = await window.pdfAPI.split(selectedFiles[0].path, ranges.split(','));
    splitBuffers.forEach((buffer, index) => {
      saveFile(buffer, `split_${index + 1}.pdf`);
    });
  } catch (error) {
    handleError(error);
  }
}

async function handleWatermark() {
  try {
    currentOperation = 'watermark';
    const watermarkText = prompt('输入水印文字');
    if (!watermarkText) return;

    const watermarkedBuffer = await window.pdfAPI.watermark(selectedFiles[0].path, watermarkText);
    saveFile(watermarkedBuffer, 'watermarked.pdf');
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
      // Export all pages
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
      }

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
