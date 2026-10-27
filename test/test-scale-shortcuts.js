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
    (() => {
      const app = window.mowinApp;
      const res = {};

      // 1. 初始化两栏比例均为 100%
      app.scale.setEditorScale(100);
      app.scale.setPreviewScale(100);

      // 2. 测试编辑区活跃时触发快捷键缩放 (Ctrl+= 放大)
      app.scale.activePane = 'editor';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true }));
      res.editorAfterZoomIn = app.scale.editorPercent;

      // 再次 Ctrl++ (带 Shift) 放大
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true, bubbles: true }));
      res.editorAfterZoomIn2 = app.scale.editorPercent;

      // Ctrl+- 缩小
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus', ctrlKey: true, bubbles: true }));
      res.editorAfterZoomOut = app.scale.editorPercent;

      // Ctrl+0 重置
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, bubbles: true }));
      res.editorAfterReset = app.scale.editorPercent;

      // 3. 测试预览渲染后 / 预览区活跃时快捷键缩放 (Ctrl+= 放大预览)
      app.scale.activePane = 'preview';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true }));
      res.previewAfterZoomIn = app.scale.previewPercent;

      // 小键盘 NumpadAdd 放大
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'NumpadAdd', ctrlKey: true, bubbles: true }));
      res.previewAfterZoomInNumpad = app.scale.previewPercent;

      // 小键盘 NumpadSubtract 缩小
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'NumpadSubtract', ctrlKey: true, bubbles: true }));
      res.previewAfterZoomOutNumpad = app.scale.previewPercent;

      // Ctrl+Numpad0 重置预览
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Numpad0', ctrlKey: true, bubbles: true }));
      res.previewAfterReset = app.scale.previewPercent;

      // 4. 测试阅读模式下快捷键缩放预览
      app.setMode('read');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true }));
      res.readModeZoomIn = app.scale.previewPercent;

      // 5. 测试 Ctrl + 滚轮缩放 (Wheel)
      app.setMode('split');
      const previewPane = document.getElementById('preview-pane');
      const wheelEvt = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true });
      previewPane.dispatchEvent(wheelEvt);
      res.wheelPreviewZoom = app.scale.previewPercent;

      // 6. 验证 HUD Toast 元素
      const toast = document.getElementById('scale-hud-toast');
      res.hudToastText = toast ? toast.textContent : '';

      return res;
    })()
  `);

  console.log('=== 快捷键与滚轮缩放测试结果 ===');
  console.log(JSON.stringify(results, null, 2));

  try {
    assert.strictEqual(results.editorAfterZoomIn, 125, '编辑区快捷键 Ctrl+= 应当放大到 125%');
    assert.strictEqual(results.editorAfterZoomIn2, 150, '编辑区快捷键 Ctrl++ 应当放大到 150%');
    assert.strictEqual(results.editorAfterZoomOut, 125, '编辑区快捷键 Ctrl+- 应当缩小到 125%');
    assert.strictEqual(results.editorAfterReset, 100, '编辑区快捷键 Ctrl+0 应当重置到 100%');

    assert.strictEqual(results.previewAfterZoomIn, 125, '预览区快捷键 Ctrl+= 应当放大到 125%');
    assert.strictEqual(results.previewAfterZoomInNumpad, 150, '预览区小键盘 Ctrl+NumpadAdd 应当放大到 150%');
    assert.strictEqual(results.previewAfterZoomOutNumpad, 125, '预览区小键盘 Ctrl+NumpadSubtract 应当缩小到 125%');
    assert.strictEqual(results.previewAfterReset, 100, '预览区小键盘 Ctrl+Numpad0 应当重置到 100%');

    assert.strictEqual(results.readModeZoomIn, 125, '阅读模式下快捷键应当放大预览区到 125%');
    assert.strictEqual(results.wheelPreviewZoom, 150, '预览区 Ctrl+滚轮向上应当放大到 150%');
    assert(results.hudToastText.length > 0, 'HUD Toast 气泡必须显示文字');

    console.log('\n\x1b[32m=== 所有 7 项快捷键与滚轮缩放断言测试全部严格 PASS！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
