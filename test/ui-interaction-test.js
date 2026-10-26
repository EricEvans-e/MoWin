const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

ipcMain.handle('app:get-initial-file', () => null);
ipcMain.handle('app:set-title', () => {});
ipcMain.handle('app:open-file-dialog', () => null);
ipcMain.handle('app:save-file-dialog', () => null);
ipcMain.handle('app:choose-folder-dialog', () => null);
ipcMain.handle('app:read-file', (e, p) => ({ success: true, content: '# Test File\nLine 2', encoding: 'utf8', lineEnding: '\n' }));
ipcMain.handle('app:write-file', () => ({ success: true }));
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
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, '../src/main/preload.js'),
      sandbox: false
    }
  });

  const errors = [];
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 3) {
      errors.push({ msg, line, src });
    }
  });

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  await new Promise(r => setTimeout(r, 1200));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const res = [];
      const app = window.mowinApp;
      if (!app) return ['FAIL: window.mowinApp is undefined'];

      // 1. 验证默认示例文档完整加载与排版
      res.push('Initial text length=' + app.editor.textarea.value.length);
      res.push('Initial line measurements count=' + app.editor.lineMeasurements.length);
      res.push('Initial headings count=' + app.headings.length);

      // 2. 测试撤销 / 重做 (Undo / Redo)
      const prevVal = app.editor.textarea.value;
      app.applyFormatting(text => window.mowinAPI.formatting.emphasis(text, { start: 0, end: 5 }, '**'));
      const formattedVal = app.editor.textarea.value;
      res.push('Bold applied: ' + (formattedVal !== prevVal));

      app.editor.undo();
      res.push('Undo success: ' + (app.editor.textarea.value === prevVal));

      app.editor.redo();
      res.push('Redo success: ' + (app.editor.textarea.value === formattedVal));

      app.editor.undo(); // 还原回初始

      // 3. 测试编辑区滚动 -> 预览区双向同步
      app.editor.textarea.scrollTop = 400;
      app.editor.textarea.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 120));
      res.push('Editor scroll (400px) -> previewContainer.scrollTop=' + Math.round(app.previewContainer.scrollTop));

      // 4. 测试预览区滚动 -> 编辑区双向同步
      app.previewContainer.scrollTop = 600;
      app.previewContainer.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 120));
      res.push('Preview scroll (600px) -> editor.textarea.scrollTop=' + Math.round(app.editor.textarea.scrollTop));

      // 5. 测试大纲跳转
      const outlineItems = document.querySelectorAll('.outline-item');
      if (outlineItems.length > 2) {
        outlineItems[2].click();
        await new Promise(r => setTimeout(r, 100));
        res.push('Clicked 3rd outline item, preview scrollTop=' + Math.round(app.previewContainer.scrollTop));
      }

      // 6. 测试浮动选区菜单与智能 LaTeX 转换识别
      app.editor.setValue('测试文本 \\\\( \\\\alpha + \\\\beta \\\\) 结尾', [5, 23]);
      app.editor.rebuildLineStarts();
      app.editor.updateGutter();
      app.selectionPopover.show();
      const formulaDisplay = app.selectionPopover.formulaBtn.style.display;
      res.push('Selection popover formula button display=' + formulaDisplay);

      // 执行公式转换
      app.selectionPopover.onConvertFormula();
      res.push('Converted text in editor=' + app.editor.textarea.value);

      // 7. 恢复示例文档
      await app.openSample();
      res.push('Sample restored successfully');

      return res;
    })()
  `);

  console.log('=== 双向同步与完整交互验证结果 ===');
  results.forEach(r => console.log('  ' + r));
  console.log('Errors caught:', errors.length);

  // 截取最终渲染截图
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '../screenshot_verified.png'), image.toPNG());
  console.log('Verified screenshot saved to screenshot_verified.png');

  app.exit(errors.length > 0 ? 1 : 0);
});
