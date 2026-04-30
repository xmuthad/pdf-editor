const { test, expect, _electron } = require('@playwright/test');
const path = require('path');

test.describe('PDF Editor E2E Tests', () => {
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

  test('应用应该正常启动并显示主界面', async () => {
    await expect(window.locator('.app-container')).toBeVisible();
    await expect(window.locator('.menu-bar')).toBeVisible();
    await expect(window.locator('.toolbar-main')).toBeVisible();
    await expect(window.locator('.status-bar')).toBeVisible();
  });

  test('工具栏按钮应该可见且可点击', async () => {
    await expect(window.locator('#openFileBtn')).toBeVisible();
    await expect(window.locator('#saveBtn')).toBeVisible();
    await expect(window.locator('#undoToolbarBtn')).toBeVisible();
    await expect(window.locator('#redoToolbarBtn')).toBeVisible();
    await expect(window.locator('#zoomOutBtn')).toBeVisible();
    await expect(window.locator('#zoomInBtn')).toBeVisible();
  });

  test('帮助模态框应该可以打开和关闭', async () => {
    const menuItem = window.locator('[data-action="help"]');
    await expect(menuItem).toBeVisible();
    
    await menuItem.click();
    await expect(window.locator('#helpModal')).toHaveClass(/active/);
    
    await window.locator('#closeHelpModalBtn').click();
    await expect(window.locator('#helpModal')).not.toHaveClass(/active/);
  });

  test('设置模态框应该可以打开和关闭', async () => {
    await window.locator('[data-action="settings"]').click();
    await expect(window.locator('#settingsModal')).toHaveClass(/active/);

    await window.locator('#closeSettingsModalBtn').click();
    await expect(window.locator('#settingsModal')).not.toHaveClass(/active/);
  });

  test('缩放控制应该工作', async () => {
    const zoomLevel = window.locator('#zoomLevel');

    await expect(zoomLevel).toHaveText('100%');

    await window.locator('#zoomInBtn').click();
    await expect(zoomLevel).toHaveText('110%');

    await window.locator('#zoomInBtn').click();
    await expect(zoomLevel).toHaveText('120%');

    await window.locator('#zoomOutBtn').click();
    await expect(zoomLevel).toHaveText('110%');
  });

  test('工具按钮应该可以切换选中状态', async () => {
    const selectTool = window.locator('[data-tool="select"]');
    const textTool = window.locator('[data-tool="text"]');

    await selectTool.click();
    await expect(selectTool).toHaveClass(/active/);

    await textTool.click();
    await expect(textTool).toHaveClass(/active/);
    await expect(selectTool).not.toHaveClass(/active/);
  });

  test('书签侧边栏标签应该可切换', async () => {
    const bookmarksTab = window.locator('.sidebar-tab[data-tab="bookmarks"]');
    const pagesTab = window.locator('.sidebar-tab[data-tab="pages"]');

    await bookmarksTab.click();
    await expect(bookmarksTab).toHaveClass(/active/);

    await pagesTab.click();
    await expect(pagesTab).toHaveClass(/active/);
  });

  test('状态栏应该可见且包含文本', async () => {
    const statusMessage = window.locator('#statusMessage');
    await expect(statusMessage).toBeVisible();
    const text = await statusMessage.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('右侧侧边栏应该可见', async () => {
    const rightSidebar = window.locator('#rightSidebar');
    await expect(rightSidebar).toBeVisible();
  });

  test('工具栏保存按钮可见', async () => {
    const saveBtn = window.locator('#saveBtn');
    await expect(saveBtn).toBeVisible();
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

  test('多工具连续切换', async () => {
    const tools = ['select', 'hand', 'text', 'eraser', 'highlight', 'underline'];

    for (const tool of tools) {
      const toolBtn = window.locator(`[data-tool="${tool}"]`);
      await toolBtn.click();
      await expect(toolBtn).toHaveClass(/active/);
    }
  });

  test('左侧侧边栏切换按钮存在', async () => {
    const leftToggle = window.locator('#leftSidebarToggle');
    await expect(leftToggle).toBeVisible();
  });

  test('菜单栏存在', async () => {
    const menuBar = window.locator('.menu-bar');
    await expect(menuBar).toBeVisible();
  });

  test('缩放信息显示', async () => {
    const zoomStatus = window.locator('#zoomStatus');
    await expect(zoomStatus).toBeVisible();
  });

  test('欢迎面板在没有文件时存在', async () => {
    const welcomePanel = window.locator('#welcomePanel');
    await expect(welcomePanel).toBeAttached();
  });

  test('上传占位区域存在', async () => {
    const uploadPlaceholder = window.locator('#uploadPlaceholder');
    await expect(uploadPlaceholder).toBeAttached();
  });
});