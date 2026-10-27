const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const assert = require('assert');

ipcMain.handle('app:get-initial-file', () => null);
ipcMain.handle('app:set-title', () => {});
ipcMain.handle('app:set-dirty-state', () => {});
ipcMain.handle('app:clear-window-file', () => true);
ipcMain.handle('app:open-file-dialog', () => null);
ipcMain.handle('app:open-image-dialog', () => 'C:/images/test.png');
ipcMain.handle('app:save-file-dialog', () => 'C:/tmp/saved.md');
ipcMain.handle('app:choose-folder-dialog', () => null);
ipcMain.handle('app:read-file', (e, p) => ({
  success: true,
  content: '# MoWin',
  encoding: 'utf8',
  hasBOM: false,
  lineEnding: '\n',
  filePath: p
}));
ipcMain.handle('app:write-file', async () => ({ success: true }));
ipcMain.handle('app:list-files', () => ({ success: true, files: [] }));
ipcMain.handle('app:export-html', () => true);
ipcMain.handle('app:print-to-pdf', () => true);
ipcMain.handle('app:print', () => true);
ipcMain.handle('app:new-window', () => true);
ipcMain.handle('app:open-external', () => true);
ipcMain.handle('app:show-default-app-dialog', () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../src/main/preload.js'),
      sandbox: false
    }
  });

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  await new Promise(r => setTimeout(r, 600));

  const testResults = await win.webContents.executeJavaScript(`
    (async () => {
      const results = {};
      const sidebar = document.getElementById('sidebar');
      const divider = document.getElementById('sidebar-divider');
      const app = window.mowinApp;

      // 1. 验证 divider 存在
      results.hasDivider = Boolean(divider);
      results.dividerParent = divider ? divider.parentElement.id : null;

      // 2. 初始宽度测试 (默认 220px)
      results.initialWidth = parseInt(sidebar.style.width, 10);

      // 3. 模拟拖拽：将侧栏往左拉到 160px
      const workspaceRect = document.getElementById('main-workspace').getBoundingClientRect();
      const targetLeft = workspaceRect.left + 160;

      divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: workspaceRect.left + results.initialWidth }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: targetLeft }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: targetLeft }));

      results.widthAfterDragLeft = parseInt(sidebar.style.width, 10);
      results.savedInLocalStorage = localStorage.getItem('mowin_sidebar_width');

      // 4. 模拟拖拽至极窄极限 (50px)，验证 clamp 到 140px
      divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: targetLeft }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: workspaceRect.left + 50 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: workspaceRect.left + 50 }));

      results.widthAtMinClamp = parseInt(sidebar.style.width, 10);

      // 5. 模拟双击分割条快速恢复默认 220px
      divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      results.widthAfterDblClick = parseInt(sidebar.style.width, 10);

      // 6. 验证侧栏隐藏/展示时宽度保持与动画属性
      sidebar.style.transition = 'none'; // 禁用 transition 避免 headless 窗口动画节流干扰
      app.sidebar.toggle(); // 隐藏
      results.isHidden = sidebar.classList.contains('hidden');
      const computedHidden = window.getComputedStyle(sidebar);
      results.hiddenMarginLeft = computedHidden.marginLeft;
      results.rawStyleMarginLeft = sidebar.style.marginLeft;
      results.sidebarCustomProp = sidebar.style.getPropertyValue('--sidebar-width');

      app.sidebar.toggle(); // 重新展开
      results.isShownAfterToggle = !sidebar.classList.contains('hidden');
      results.widthAfterToggle = parseInt(sidebar.style.width, 10);
      sidebar.style.transition = '';

      return results;
    })()
  `);

  console.log('=== 侧栏拖拽与宽度调整测试结果 ===');
  console.log(JSON.stringify(testResults, null, 2));

  try {
    assert.strictEqual(testResults.hasDivider, true, '侧栏分割条 sidebar-divider 必须存在');
    assert.strictEqual(testResults.dividerParent, 'main-workspace', '分割条必须在 main-workspace 内');
    assert.strictEqual(testResults.initialWidth, 220, '侧栏初始默认宽度必须为 220px');
    assert.strictEqual(testResults.widthAfterDragLeft, 160, '向左拖拽后侧栏宽度必须变为 160px');
    assert.strictEqual(testResults.savedInLocalStorage, '160', '调整后的宽度必须持久化存储在 localStorage');
    assert.strictEqual(testResults.widthAtMinClamp, 140, '向左过度拖拽必须安全 clamp 限制在 140px');
    assert.strictEqual(testResults.widthAfterDblClick, 220, '双击分割条必须恢复默认 220px');
    assert.strictEqual(testResults.isHidden, true, '切换隐藏时 sidebar 必须具有 hidden class');
    assert.strictEqual(testResults.hiddenMarginLeft, '-224px', '侧栏隐藏时 marginLeft 必须准确计算为负宽度全量隐藏');
    assert.strictEqual(testResults.isShownAfterToggle, true, '再次切换时 sidebar 必须恢复显示');
    assert.strictEqual(testResults.widthAfterToggle, 220, '展开后宽度必须保留设置值');

    console.log('\n\x1b[32m=== 所有 9 项侧栏拖拽与宽度调整断言全部严格 PASS！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
