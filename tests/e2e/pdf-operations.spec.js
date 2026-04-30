const { test, expect, _electron } = require('@playwright/test');
const path = require('path');

test.describe('PDF 操作流程 E2E 测试', () => {
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

  test.describe('书签功能流程', () => {
    test('打开书签标签页', async () => {
      await window.locator('.sidebar-tab[data-tab="bookmarks"]').click();
      await expect(window.locator('#bookmarksTab')).toHaveClass(/active/);
    });

    test('打开书签模态框', async () => {
      await window.locator('.sidebar-tab[data-tab="bookmarks"]').click();
      await window.locator('#addBookmarkBtn').click();
      await expect(window.locator('#bookmarkModal')).toHaveClass(/active/);
    });

    test('书签模态框包含标题和页码输入', async () => {
      await window.locator('.sidebar-tab[data-tab="bookmarks"]').click();
      await window.locator('#addBookmarkBtn').click();
      await expect(window.locator('#bookmarkTitle')).toBeVisible();
      await expect(window.locator('#bookmarkPage')).toBeVisible();
    });

    test('输入书签信息', async () => {
      await window.locator('.sidebar-tab[data-tab="bookmarks"]').click();
      await window.locator('#addBookmarkBtn').click();
      await window.locator('#bookmarkTitle').fill('Chapter 1');
      await window.locator('#bookmarkPage').fill('5');
      await expect(window.locator('#bookmarkTitle')).toHaveValue('Chapter 1');
    });

    test('关闭书签模态框', async () => {
      await window.locator('.sidebar-tab[data-tab="bookmarks"]').click();
      await window.locator('#addBookmarkBtn').click();
      await window.locator('#cancelBookmarkBtn').click();
      await expect(window.locator('#bookmarkModal')).not.toHaveClass(/active/);
    });
  });

  test.describe('帮助和设置模态框', () => {
    test('帮助模态框可以打开和关闭', async () => {
      await window.locator('[data-action="help"]').click();
      await expect(window.locator('#helpModal')).toHaveClass(/active/);
      await window.locator('#closeHelpModalBtn').click();
      await expect(window.locator('#helpModal')).not.toHaveClass(/active/);
    });

    test('设置模态框可以打开和关闭', async () => {
      await window.locator('[data-action="settings"]').click();
      await expect(window.locator('#settingsModal')).toHaveClass(/active/);
      await window.locator('#closeSettingsModalBtn').click();
      await expect(window.locator('#settingsModal')).not.toHaveClass(/active/);
    });

    test('设置复选框可交互', async () => {
      await window.locator('[data-action="settings"]').click();
      await expect(window.locator('#settingsModal')).toHaveClass(/active/);

      const checkbox = window.locator('#openLastFileCheckbox');
      await checkbox.check();
      await expect(checkbox).toBeChecked();

      await checkbox.uncheck();
      await expect(checkbox).not.toBeChecked();
    });
  });

  test.describe('侧边栏切换', () => {
    test('书签侧边栏标签切换', async () => {
      const bookmarksTab = window.locator('.sidebar-tab[data-tab="bookmarks"]');
      const pagesTab = window.locator('.sidebar-tab[data-tab="pages"]');

      await bookmarksTab.click();
      await expect(bookmarksTab).toHaveClass(/active/);
      await expect(pagesTab).not.toHaveClass(/active/);

      await pagesTab.click();
      await expect(pagesTab).toHaveClass(/active/);
      await expect(bookmarksTab).not.toHaveClass(/active/);
    });
  });

  test.describe('工具切换', () => {
    test('工具按钮可以切换选中状态', async () => {
      const selectTool = window.locator('[data-tool="select"]');
      const textTool = window.locator('[data-tool="text"]');

      await selectTool.click();
      await expect(selectTool).toHaveClass(/active/);

      await textTool.click();
      await expect(textTool).toHaveClass(/active/);
      await expect(selectTool).not.toHaveClass(/active/);
    });

    test('多工具连续切换', async () => {
      const tools = ['select', 'hand', 'text', 'eraser', 'highlight', 'underline'];

      for (const tool of tools) {
        const toolBtn = window.locator(`[data-tool="${tool}"]`);
        await toolBtn.click();
        await expect(toolBtn).toHaveClass(/active/);
      }
    });
  });

  test.describe('缩放控制', () => {
    test('缩放显示当前百分比', async () => {
      await expect(window.locator('#zoomLevel')).toHaveText('100%');
    });

    test('缩放按钮可见', async () => {
      await expect(window.locator('#zoomOutBtn')).toBeVisible();
      await expect(window.locator('#zoomInBtn')).toBeVisible();
    });

    test('连续放大', async () => {
      for (let i = 0; i < 5; i++) {
        await window.locator('#zoomInBtn').click();
      }
      await expect(window.locator('#zoomLevel')).toHaveText('150%');
    });

    test('连续缩小', async () => {
      for (let i = 0; i < 5; i++) {
        await window.locator('#zoomOutBtn').click();
      }
      await expect(window.locator('#zoomLevel')).toHaveText('50%');
    });
  });
});