// 初始化文件列表和当前操作状态
let selectedFiles = [];
let currentOperation = null;

// 文件选择事件处理
document.getElementById('fileInput').addEventListener('change', handleFileSelect);
document.getElementById('dropZone').addEventListener('dragover', handleDragOver);
document.getElementById('dropZone').addEventListener('drop', handleFileDrop);

// 处理文件选择
function handleFileSelect(e) {
  addFiles(e.target.files);
}

// 处理拖放文件
function handleFileDrop(e) {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
}

// 添加文件到列表
function addFiles(files) {
  selectedFiles = Array.from(files);
  updatePreview();
  updateStatus(`已选择${selectedFiles.length}个文件`);
}

// 更新PDF预览
function updatePreview() {
  const iframe = document.getElementById('pdfPreview');
  if(selectedFiles.length > 0) {
    const url = URL.createObjectURL(selectedFiles[0]);
    iframe.src = url;
  }
}

// 操作处理函数
async function handleMerge() {
  try {
    currentOperation = 'merge';
    const filePaths = selectedFiles.map(file => file.path);
    const mergedBuffer = await window.pdfAPI.merge(filePaths);
    saveFile(mergedBuffer, 'merged.pdf');
  } catch (error) {
    handleError(error);
  }
}

async function handleSplit() {
  try {
    currentOperation = 'split';
    const ranges = prompt('输入拆分范围（如：1-3,4-5）').split(',');
    const splitBuffers = await window.pdfAPI.split(selectedFiles[0].path, ranges);
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
    const watermarkedBuffer = await window.pdfAPI.watermark(selectedFiles[0].path, watermarkText);
    saveFile(watermarkedBuffer, 'watermarked.pdf');
  } catch (error) {
    handleError(error);
  }
}

// 保存文件到本地
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

// 错误处理
function handleError(error) {
  console.error(error);
  updateStatus(`操作失败: ${error.message}`);
}

// 更新状态显示
function updateStatus(message) {
  document.getElementById('status').textContent = message;
}

// 初始化拖放效果
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}