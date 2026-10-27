const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mowin-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
]);

ipcMain.handle('app:get-initial-file', () => null);
ipcMain.handle('app:set-title', () => {});
ipcMain.handle('app:read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content, encoding: 'utf8', lineEnding: '\n', filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('app:read-image-data-url', (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
});
let capturedExportHtml = '';
ipcMain.handle('app:export-html', (event, defaultName, htmlContent) => {
  capturedExportHtml = htmlContent;
  return true;
});
ipcMain.handle('app:clear-window-file', () => true);
ipcMain.handle('app:set-dirty-state', () => true);
ipcMain.handle('app:open-image-dialog', () => null);
ipcMain.handle('app:list-files', (event, folderPath) => {
  return { success: true, files: ['doc1.md', 'notes.md', 'chapter1.md'] };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../src/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const log = [];
      const app = window.mowinApp;

      // 1. 测试选区操作与插入表格支持 Ctrl+Z 撤销
      app.editor.setValue('起始文本', [4, 4]);
      app.selectionPopover.selectedRange = { start: 4, end: 4 };
      app.selectionPopover.onInsertAfter('\\n\\n| A | B |\\n| - | - |\\n| 1 | 2 |\\n\\n');
      const textAfterInsert = app.editor.textarea.value;
      const hasTable = textAfterInsert.includes('| A | B |');
      app.editor.undo();
      const textAfterUndo = app.editor.textarea.value;
      const undoTableOk = textAfterUndo === '起始文本';
      log.push({ test: 'popover_table_undo', hasTable, undoTableOk });

      // 2. 测试阅读模式下触发查找自动切至双栏
      app.setMode('read');
      const modeBeforeFind = app.mode;
      app.search.show(false);
      const modeAfterFind = app.mode;
      log.push({ test: 'find_in_read_mode_autosplit', modeBeforeFind, modeAfterFind });
      app.search.hide();

      // 3. 测试侧栏快速过滤文件
      app.sidebar.currentFolder = 'C:/test-folder';
      app.sidebar.filesList = ['C:/test-folder/readme.md', 'C:/test-folder/notes.md', 'C:/test-folder/guide.md'];
      app.sidebar.switchTab('files');
      app.sidebar.fileFilterQuery = 'note';
      app.sidebar.renderFiles();
      const renderedFiles = Array.from(document.querySelectorAll('#sidebar-content .file-item')).map(el => el.textContent);
      log.push({ test: 'sidebar_file_filter', renderedFiles });

      // 4. 测试缩放变更自动清空滚动缓存
      let invalidated = false;
      const originalInvalidate = window.invalidateSourceBlocks;
      window.invalidateSourceBlocks = () => { invalidated = true; originalInvalidate(); };
      app.scale.setPreviewScale(125);
      log.push({ test: 'zoom_invalidates_blocks', invalidated });
      window.invalidateSourceBlocks = originalInvalidate;

      // 5. 测试 HTML 导出图片转换为 Base64 且移除复制按钮
      // 创建包含临时图片和代码块的预览
      app.editor.setValue('# 标题\\n\\n\`\`\`js\\nconst a = 1;\\n\`\`\`\\n\\n<img src="./fig1.png" data-abs-path="dummy.png" data-original-src="./fig1.png" />');
      await new Promise(r => setTimeout(r, 250));
      await app.exportHTML();
      return log;
    })()
  `);

  console.log('=== 优化与修复验证结果 ===');
  console.log(JSON.stringify(results, null, 2));

  // 严格断言
  const assert = require('assert');
  try {
    const tableTest = results.find(r => r.test === 'popover_table_undo');
    assert(tableTest && tableTest.hasTable && tableTest.undoTableOk, 'popover table undo must succeed');

    const findTest = results.find(r => r.test === 'find_in_read_mode_autosplit');
    assert(findTest && findTest.modeBeforeFind === 'read' && findTest.modeAfterFind === 'split', 'find in read mode must auto split');

    const filterTest = results.find(r => r.test === 'sidebar_file_filter');
    assert(filterTest && filterTest.renderedFiles.some(f => f.includes('notes.md')), 'sidebar file filter must match');

    const zoomTest = results.find(r => r.test === 'zoom_invalidates_blocks');
    assert(zoomTest && zoomTest.invalidated, 'zoom must invalidate scroll sync cache');

    assert(capturedExportHtml.length > 0, 'Exported HTML must not be empty');
    assert(!capturedExportHtml.includes('code-copy-btn'), 'Exported HTML must not contain code-copy-btn');
    assert(!capturedExportHtml.includes('mowin-resource://'), 'Exported HTML must not contain mowin-resource protocol');

    console.log('\n\x1b[32m=== 全部优化断言测试严格通过！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
