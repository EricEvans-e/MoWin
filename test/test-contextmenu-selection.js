const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const assert = require('assert');

ipcMain.handle('app:get-initial-file', () => null);
ipcMain.handle('app:set-title', () => {});
ipcMain.handle('app:set-dirty-state', () => {});
ipcMain.handle('app:clear-window-file', () => true);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, '../src/main/preload.js'),
      sandbox: false
    }
  });

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  await new Promise(r => setTimeout(r, 600));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.mowinApp;
      const res = {};

      app.editor.setValue('测试多选内容示例文本', [2, 6]); // 选中 "多选内容"
      // 模拟鼠标左键抬起 (mouseup)
      app.editor.textarea.dispatchEvent(new MouseEvent('mouseup', { clientX: 300, clientY: 200, bubbles: true }));
      // 模拟 select 事件
      app.editor.textarea.dispatchEvent(new Event('select', { bubbles: true }));

      // 等待 250ms (验证以前 180ms 自动弹出的计时器)
      await new Promise(r => setTimeout(r, 250));

      const popover = document.getElementById('selection-popover');
      res.popoverDisplayAfterLeftSelect = window.getComputedStyle(popover).display;

      // 现在通过右键点击 (contextmenu) 呼出菜单
      const contextEvent = new MouseEvent('contextmenu', {
        clientX: 320,
        clientY: 210,
        bubbles: true,
        cancelable: true
      });
      const wasPrevented = !app.editor.textarea.dispatchEvent(contextEvent);
      res.contextMenuPrevented = wasPrevented;
      res.popoverDisplayAfterRightClick = window.getComputedStyle(popover).display;
      res.popoverLeft = popover.style.left;
      res.popoverTop = popover.style.top;

      // 验证剪切、复制、粘贴按钮存在
      res.hasCutBtn = !!popover.querySelector('#popover-btn-cut');
      res.hasCopyBtn = !!popover.querySelector('#popover-btn-copy');
      res.hasPasteBtn = !!popover.querySelector('#popover-btn-paste');

      // 点击空白区域自动收起
      document.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
      res.popoverDisplayAfterClickOutside = window.getComputedStyle(popover).display;

      // 当没有选中文本时右键，不应弹出定制菜单
      app.editor.setValue('无选中文本', [3, 3]);
      const noSelectContextEvent = new MouseEvent('contextmenu', {
        clientX: 320,
        clientY: 210,
        bubbles: true,
        cancelable: true
      });
      const wasPreventedNoSelect = !app.editor.textarea.dispatchEvent(noSelectContextEvent);
      res.noSelectContextPrevented = wasPreventedNoSelect;
      res.popoverDisplayNoSelect = window.getComputedStyle(popover).display;

      return res;
    })()
  `);

  console.log('=== 选区右键呼出菜单测试结果 ===');
  console.log(JSON.stringify(results, null, 2));

  try {
    assert.strictEqual(results.popoverDisplayAfterLeftSelect, 'none', '左键多选后菜单绝不应自动弹出 (必须为 none)');
    assert.strictEqual(results.contextMenuPrevented, true, '有选区时右键必须拦截系统菜单');
    assert.strictEqual(results.popoverDisplayAfterRightClick, 'flex', '有选区时右键必须弹出选区格式化菜单 (display: flex)');
    assert(results.popoverLeft && results.popoverTop, '菜单必须在右键坐标处定位');
    assert(results.hasCutBtn && results.hasCopyBtn && results.hasPasteBtn, '选区菜单必须包含剪切、复制、粘贴');
    assert.strictEqual(results.popoverDisplayAfterClickOutside, 'none', '点击空白处菜单必须自动隐藏');
    assert.strictEqual(results.noSelectContextPrevented, false, '无选区时右键不应拦截原生系统菜单');
    assert.strictEqual(results.popoverDisplayNoSelect, 'none', '无选区时右键不应弹出选区菜单');

    console.log('\n\x1b[32m=== 所有 7 项选区右键呼出菜单断言测试全部严格 PASS！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
