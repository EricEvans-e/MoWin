const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const assert = require('assert');

let dirtyStates = [];
let windowFileCleared = false;
let promptSaveCount = 0;

ipcMain.handle('app:get-initial-file', () => null);
ipcMain.handle('app:set-title', () => {});
ipcMain.handle('app:set-dirty-state', (e, isDirty) => {
  dirtyStates.push(isDirty);
});
ipcMain.handle('app:clear-window-file', () => {
  windowFileCleared = true;
  return true;
});
ipcMain.handle('app:open-file-dialog', () => null);
ipcMain.handle('app:open-image-dialog', () => 'C:/images/test.png');
ipcMain.handle('app:save-file-dialog', () => 'C:/tmp/saved.md');
ipcMain.handle('app:choose-folder-dialog', () => null);
ipcMain.handle('app:read-file', (e, p) => ({
  success: true,
  content: '# Read Content',
  encoding: 'utf8',
  hasBOM: false,
  lineEnding: '\n',
  filePath: p
}));
ipcMain.handle('app:write-file', async (e, p, c, enc, le, bom) => {
  // 模拟异步落盘延迟 50ms
  await new Promise(r => setTimeout(r, 50));
  return { success: true };
});
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

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  await new Promise(r => setTimeout(r, 800));

  const testResults = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.mowinApp;
      const results = {};

      // Test 1: Tab 多行整行缩进与 Shift+Tab 逆缩进
      app.editor.setValue('line1\\nline2\\nline3', [0, 11]); // 选中 line1 和 line2
      // 模拟 Tab 键按下
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, cancelable: true });
      app.editor.textarea.dispatchEvent(tabEvent);
      results.tabIndented = app.editor.textarea.value;

      // 模拟 Shift+Tab 键按下
      const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
      app.editor.textarea.dispatchEvent(shiftTabEvent);
      results.tabUnindented = app.editor.textarea.value;

      // Test 2: 替换功能字面量 $1, $& 替换
      app.editor.setValue('abc abc abc', [0, 0]);
      app.search.show(true);
      app.search.findInput.value = 'abc';
      app.search.replaceInput.value = '$1';
      app.search.replaceAll();
      results.replaceAllWithLiteral = app.editor.textarea.value;
      app.search.hide();

      // Test 3: 替换前插入字符不会替换错位
      app.editor.setValue('target target', [0, 0]);
      app.search.show(true);
      app.search.findInput.value = 'target';
      app.search.performFind();
      // 在前面插入前缀
      app.editor.setValue('PREFIX target target', [0, 0]);
      app.search.replaceInput.value = 'REPLACED';
      app.search.replaceCurrent();
      results.replaceAfterEdit = app.editor.textarea.value;
      app.search.hide();

      // Test 4: 预览区缩放徽章固定定位，滚动时不滚出视口
      const previewPane = document.getElementById('preview-pane');
      const previewContainer = document.getElementById('preview-container');
      const badge = previewPane.querySelector('.scale-badge');
      const badgeRectBefore = badge.getBoundingClientRect();
      previewContainer.scrollTop = 500;
      previewContainer.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 50));
      const badgeRectAfter = badge.getBoundingClientRect();
      results.badgeFixed = (badgeRectBefore.top === badgeRectAfter.top && badgeRectBefore.bottom === badgeRectAfter.bottom);

      // Test 5: 分栏宽度记忆在切换模式后保持
      app.savedSplitWidth = 380;
      app.setMode('split');
      results.splitWidthModeSplit = app.editorContainer.style.width;
      app.setMode('edit');
      app.setMode('split');
      results.splitWidthAfterEditToSplit = app.editorContainer.style.width;

      // Test 6: 保存竞态保护
      app.currentFilePath = 'C:/tmp/test.md';
      app.editor.setValue('Version 1', [0, 0]);
      app.isModified = true;
      // 触发保存
      const savePromise = app.saveFile();
      // 在异步落盘中途用户继续敲入新字符 Version 2
      app.editor.textarea.value = 'Version 2';
      await savePromise;
      results.dirtyAfterTypingDuringSave = app.isModified; // 应当依然是 true！

      return results;
    })()
  `);

  console.log('=== UX 与功能回归测试结果 ===');
  console.log(JSON.stringify(testResults, null, 2));

  try {
    // 断言 1: 多行 Tab 缩进
    assert.strictEqual(testResults.tabIndented, '  line1\n  line2\nline3', 'Tab 必须为选中的前两行分别增加 2 个空格');
    assert.strictEqual(testResults.tabUnindented, 'line1\nline2\nline3', 'Shift+Tab 必须正确逆缩进');

    // 断言 2: $1 字面量替换
    assert.strictEqual(testResults.replaceAllWithLiteral, '$1 $1 $1', 'replaceAll 必须将 $1 视为纯字面量而非正则模板');

    // 断言 3: 插入后替换不替换错位
    assert.strictEqual(testResults.replaceAfterEdit, 'PREFIX REPLACED target', '在输入后执行替换必须精确定位');

    // 断言 4: 缩放徽章固定不随正文滚出
    assert.strictEqual(testResults.badgeFixed, true, '缩放徽章必须固定在面板右下角');

    // 断言 5: 分栏宽度保持
    assert.strictEqual(testResults.splitWidthModeSplit, '380px', '分栏宽度必须为 380px');
    assert.strictEqual(testResults.splitWidthAfterEditToSplit, '380px', '切换模式后分栏宽度必须保留 380px');

    // 断言 6: 保存竞态保护
    assert.strictEqual(testResults.dirtyAfterTypingDuringSave, true, '在保存过程中输入新字符，isModified 必须保持 true');

    console.log('\n\x1b[32m=== 所有 6 项关键 UX 与功能回归测试全部 PASS！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
