const { test, expect, _electron } = require('@playwright/test');
const path = require('path');

test.describe('新功能 E2E 测试', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await _electron.launch({
      args: [path.join(__dirname, '../../')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      }
    });
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test.describe('最近文件功能', () => {
    test('欢迎面板应该包含最近文件区域', async () => {
      const welcomePanel = window.locator('#welcomePanel');
      await expect(welcomePanel).toBeAttached();
      
      const recentFilesSection = window.locator('#recentFilesSection');
      await expect(recentFilesSection).toBeAttached();
    });

    test('最近文件列表容器存在', async () => {
      const recentFilesList = window.locator('#recentFilesList');
      await expect(recentFilesList).toBeAttached();
    });

    test('清除最近文件按钮存在', async () => {
      const clearBtn = window.locator('#clearRecentFilesBtn');
      await expect(clearBtn).toBeAttached();
    });
  });

  test.describe('幻灯片模式', () => {
    test('幻灯片菜单项存在', async () => {
      const viewMenu = window.locator('[data-action="view"]');
      await viewMenu.hover();
      
      const slideshowItem = window.locator('[data-action="slideshow"]');
      await expect(slideshowItem).toBeVisible();
    });

    test('幻灯片模态框可以打开', async () => {
      const viewMenu = window.locator('[data-action="view"]');
      await viewMenu.hover();
      
      const slideshowItem = window.locator('[data-action="slideshow"]');
      await slideshowItem.click();
      
      await expect(window.locator('#slideshowModal')).toHaveClass(/active/);
    });

    test('幻灯片模态框包含设置选项', async () => {
      const viewMenu = window.locator('[data-action="view"]');
      await viewMenu.hover();
      
      const slideshowItem = window.locator('[data-action="slideshow"]');
      await slideshowItem.click();
      
      await expect(window.locator('#slideshowInterval')).toBeVisible();
      await expect(window.locator('#slideshowLoop')).toBeVisible();
      await expect(window.locator('#slideshowShowControls')).toBeVisible();
    });

    test('幻灯片模态框可以关闭', async () => {
      const viewMenu = window.locator('[data-action="view"]');
      await viewMenu.hover();
      
      const slideshowItem = window.locator('[data-action="slideshow"]');
      await slideshowItem.click();
      
      await window.locator('#cancelSlideshowModal').click();
      await expect(window.locator('#slideshowModal')).not.toHaveClass(/active/);
    });
  });

  test.describe('PDF 比较功能', () => {
    test('比较菜单项存在', async () => {
      const toolsMenu = window.locator('[data-action="tools"]');
      await toolsMenu.hover();
      
      const compareItem = window.locator('[data-action="compare"]');
      await expect(compareItem).toBeVisible();
    });

    test('比较模态框DOM元素存在', async () => {
      const compareModal = window.locator('#compareModal');
      await expect(compareModal).toBeAttached();
    });

    test('比较模态框包含文件选择输入框', async () => {
      const compareFile1 = window.locator('#compareFile1');
      const compareFile2 = window.locator('#compareFile2');
      const selectBtn = window.locator('#selectCompareFile1Btn');
      
      await expect(compareFile1).toBeAttached();
      await expect(compareFile2).toBeAttached();
      await expect(selectBtn).toBeAttached();
    });

    test('比较模态框包含同步选项', async () => {
      const syncScrolling = window.locator('#syncScrolling');
      const syncZoom = window.locator('#syncZoom');
      
      await expect(syncScrolling).toBeAttached();
      await expect(syncZoom).toBeAttached();
    });
  });

  test.describe('电子签名功能', () => {
    test('签名菜单项存在', async () => {
      const toolsMenu = window.locator('[data-action="tools"]');
      await toolsMenu.hover();
      
      const signatureItem = window.locator('[data-action="signature"]');
      await expect(signatureItem).toBeVisible();
    });

    test('签名模态框DOM元素存在', async () => {
      const signatureModal = window.locator('#signatureModal');
      await expect(signatureModal).toBeAttached();
    });

    test('签名模态框包含三种签名方式标签', async () => {
      const drawTab = window.locator('.signature-tab[data-tab="draw"]');
      const typeTab = window.locator('.signature-tab[data-tab="type"]');
      const uploadTab = window.locator('.signature-tab[data-tab="upload"]');
      
      await expect(drawTab).toBeAttached();
      await expect(typeTab).toBeAttached();
      await expect(uploadTab).toBeAttached();
    });

    test('签名画布DOM元素存在', async () => {
      const canvas = window.locator('#signatureCanvas');
      await expect(canvas).toBeAttached();
    });

    test('签名颜色选择器存在', async () => {
      const colorBtns = window.locator('.signature-color-btn');
      expect(await colorBtns.count()).toBeGreaterThan(0);
    });

    test('清除签名按钮存在', async () => {
      const clearBtn = window.locator('#clearSignatureBtn');
      await expect(clearBtn).toBeAttached();
    });

    test('签名类型输入框存在', async () => {
      const typeInput = window.locator('#signatureTypeInput');
      await expect(typeInput).toBeAttached();
    });

    test('上传签名按钮存在', async () => {
      const uploadBtn = window.locator('#uploadSignatureBtn');
      await expect(uploadBtn).toBeAttached();
    });
  });

  test.describe('表单填写功能', () => {
    test('表单填写菜单项存在', async () => {
      const toolsMenu = window.locator('[data-action="tools"]');
      await toolsMenu.hover();
      
      const formFillItem = window.locator('[data-action="formFill"]');
      await expect(formFillItem).toBeVisible();
    });
  });

  test.describe('全屏模式', () => {
    test('全屏菜单项存在', async () => {
      const viewMenu = window.locator('[data-action="view"]');
      await viewMenu.hover();
      
      const fullscreenItem = window.locator('[data-action="fullscreen"]');
      await expect(fullscreenItem).toBeVisible();
    });
  });

  test.describe('快速操作按钮', () => {
    test('快速操作区域DOM元素存在', async () => {
      const quickActions = window.locator('#quickActions');
      await expect(quickActions).toBeAttached();
    });

    test('页眉页脚按钮DOM元素存在', async () => {
      const btn = window.locator('#quickHeaderFooterBtn');
      await expect(btn).toBeAttached();
    });

    test('背景按钮DOM元素存在', async () => {
      const btn = window.locator('#quickBackgroundBtn');
      await expect(btn).toBeAttached();
    });

    test('压缩PDF按钮DOM元素存在', async () => {
      const btn = window.locator('#quickCompressBtn');
      await expect(btn).toBeAttached();
    });

    test('导出图片按钮DOM元素存在', async () => {
      const btn = window.locator('#quickExportImagesBtn');
      await expect(btn).toBeAttached();
    });

    test('图片转PDF按钮DOM元素存在', async () => {
      const btn = window.locator('#quickImagesToPdfBtn');
      await expect(btn).toBeAttached();
    });

    test('提取文本按钮DOM元素存在', async () => {
      const btn = window.locator('#quickExtractTextBtn');
      await expect(btn).toBeAttached();
    });

    test('文档统计按钮DOM元素存在', async () => {
      const btn = window.locator('#quickDocStatsBtn');
      await expect(btn).toBeAttached();
    });
  });

  test.describe('模态框DOM元素完整性测试', () => {
    test('页眉页脚模态框DOM元素存在', async () => {
      const modal = window.locator('#headerFooterModal');
      await expect(modal).toBeAttached();
      
      const headerInput = window.locator('#headerText');
      const footerInput = window.locator('#footerText');
      const fontSize = window.locator('#headerFooterFontSize');
      
      await expect(headerInput).toBeAttached();
      await expect(footerInput).toBeAttached();
      await expect(fontSize).toBeAttached();
    });

    test('背景模态框DOM元素存在', async () => {
      const modal = window.locator('#backgroundModal');
      await expect(modal).toBeAttached();
      
      const bgColor = window.locator('#bgColor');
      const bgOpacity = window.locator('#bgOpacity');
      
      await expect(bgColor).toBeAttached();
      await expect(bgOpacity).toBeAttached();
    });

    test('文档统计模态框DOM元素存在', async () => {
      const modal = window.locator('#docStatsModal');
      await expect(modal).toBeAttached();
      
      const fileSize = window.locator('#statFileSize');
      const pageCount = window.locator('#statPageCount');
      const imageCount = window.locator('#statImageCount');
      
      await expect(fileSize).toBeAttached();
      await expect(pageCount).toBeAttached();
      await expect(imageCount).toBeAttached();
    });
  });

  test.describe('签名模态框交互测试', () => {
    test('签名模态框可以打开', async () => {
      const toolsMenu = window.locator('[data-action="tools"]');
      await toolsMenu.hover();
      
      const signatureItem = window.locator('[data-action="signature"]');
      await signatureItem.click();
      
      await expect(window.locator('#signatureModal')).toHaveClass(/active/);
    });

    test('签名模态框可以关闭', async () => {
      const toolsMenu = window.locator('[data-action="tools"]');
      await toolsMenu.hover();
      
      const signatureItem = window.locator('[data-action="signature"]');
      await signatureItem.click();
      
      await expect(window.locator('#signatureModal')).toHaveClass(/active/);
      
      await window.locator('#closeSignatureModal').click();
      await expect(window.locator('#signatureModal')).not.toHaveClass(/active/);
    });

    test('签名标签页可以切换', async () => {
      const toolsMenu = window.locator('[data-action="tools"]');
      await toolsMenu.hover();
      
      const signatureItem = window.locator('[data-action="signature"]');
      await signatureItem.click();
      
      await expect(window.locator('#signatureModal')).toHaveClass(/active/);
      
      const drawTab = window.locator('.signature-tab[data-tab="draw"]');
      await expect(drawTab).toHaveClass(/active/);
      
      const typeTab = window.locator('.signature-tab[data-tab="type"]');
      await typeTab.click();
      await expect(typeTab).toHaveClass(/active/);
      
      const uploadTab = window.locator('.signature-tab[data-tab="upload"]');
      await uploadTab.click();
      await expect(uploadTab).toHaveClass(/active/);
    });
  });
});
