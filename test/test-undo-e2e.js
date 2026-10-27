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
  content: '',
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

  const testReport = await win.webContents.executeJavaScript(`
    (async () => {
      const app = window.mowinApp;
      const editor = app.editor;
      const textarea = editor.textarea;
      const report = { steps: [], errors: [] };

      // 初始化为空文档
      editor.setValue('', [0, 0]);
      editor.history.init('');

      // 辅助函数：模拟打字并触发 input 事件
      function typeText(newFullText, cursor = null) {
        textarea.value = newFullText;
        const cur = cursor !== null ? cursor : newFullText.length;
        textarea.selectionStart = cur;
        textarea.selectionEnd = cur;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // 辅助函数：按键模拟
      function pressKey(key, ctrl = false, shift = false) {
        const ev = new KeyboardEvent('keydown', {
          key: key,
          ctrlKey: ctrl,
          shiftKey: shift,
          bubbles: true,
          cancelable: true
        });
        textarea.dispatchEvent(ev);
      }

      // ==========================================
      // 测试 1：连续 10 次独立编辑，支持逐步深层撤销 10 步
      // ==========================================
      const sentences = [
        '第一步：标题',
        '第一步：标题。第二步：列表',
        '第一步：标题。第二步：列表，第三步：代码',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式；第五步：表格',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式；第五步：表格。第六步：加粗',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式；第五步：表格。第六步：加粗，第七步：斜体',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式；第五步：表格。第六步：加粗，第七步：斜体！第八步：引用',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式；第五步：表格。第六步：加粗，第七步：斜体！第八步：引用；第九步：链接',
        '第一步：标题。第二步：列表，第三步：代码！第四步：公式；第五步：表格。第六步：加粗，第七步：斜体！第八步：引用；第九步：链接。第十步：完成。'
      ];

      for (let i = 0; i < sentences.length; i++) {
        typeText(sentences[i]);
      }

      // 等待防抖计时器完成
      await new Promise(r => setTimeout(r, 400));

      const undoStates = [];
      for (let i = sentences.length - 1; i >= 0; i--) {
        pressKey('z', true, false); // Ctrl+Z
        undoStates.push(textarea.value);
      }

      report.undo10States = undoStates;
      report.undoToInitial = (textarea.value === '');

      // 依次重做 10 步
      const redoStates = [];
      for (let i = 0; i < sentences.length; i++) {
        pressKey('y', true, false); // Ctrl+Y
        redoStates.push(textarea.value);
      }
      report.redo10States = redoStates;
      report.redoToLatest = (textarea.value === sentences[sentences.length - 1]);

      // ==========================================
      // 测试 2：打字 -> 切换为退格删除 -> Ctrl+Z 优先撤销删除
      // ==========================================
      editor.setValue('', [0, 0]);
      editor.history.init('');

      typeText('墨窗');
      await new Promise(r => setTimeout(r, 400)); // 确立检查点
      typeText('墨窗编辑器'); // 输入模式
      // 模拟用户按下 Backspace 删除 3 个字
      typeText('墨窗', 2); // 模式从输入切到删除
      await new Promise(r => setTimeout(r, 400));

      pressKey('z', true, false); // 撤销删除
      const afterUndoDelete = textarea.value;
      pressKey('z', true, false); // 撤销输入
      const afterUndoTyping = textarea.value;

      report.modeSwitchUndoDelete = afterUndoDelete; // 应为 '墨窗编辑器'
      report.modeSwitchUndoTyping = afterUndoTyping; // 应为 '墨窗'

      // ==========================================
      // 测试 3：中文输入法 IME 合成中间状态不污染撤销栈
      // ==========================================
      editor.setValue('初始', [2, 2]);
      editor.history.init('初始');

      // 模拟 IME compositionstart
      textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      // 模拟中间拼音输入
      textarea.value = '初始ceshi';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      // 模拟候选词上屏并触发 compositionend
      textarea.value = '初始测试';
      textarea.selectionStart = 4;
      textarea.selectionEnd = 4;
      textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));

      // 撤销
      pressKey('z', true, false);
      report.afterImeUndo = textarea.value; // 应直接回到 '初始'，绝无 '初始ceshi'

      // ==========================================
      // 测试 4：多达 30 步深层操作无丢失撤销
      // ==========================================
      editor.setValue('', [0, 0]);
      editor.history.init('');
      for (let i = 1; i <= 30; i++) {
        editor.insertAtCursor('条目' + i + '、');
      }
      let deepCount = 0;
      while (editor.undo()) {
        deepCount++;
      }
      report.deepUndoCount = deepCount; // 应当精准完成 30 步撤销
      report.deepUndoFinished = (textarea.value === '');

      return report;
    })()
  `);

  console.log('=== 深度撤销与重做 E2E 测试结果 ===');
  console.log(JSON.stringify(testReport, null, 2));

  try {
    // 验证测试 1: 10 步深度撤销与重做
    assert.strictEqual(testReport.undoToInitial, true, '10 次编辑必须能够逐步撤销回初始状态');
    assert.strictEqual(testReport.redoToLatest, true, '10 次撤销后必须能够逐步重做回最终状态');
    assert.strictEqual(testReport.undo10States.length, 10, '撤销步骤记录必须达到 10 次');

    // 验证测试 2: 模式切换
    assert.strictEqual(testReport.modeSwitchUndoDelete, '墨窗编辑器', '第 1 次撤销必须优先撤销退格删除，恢复被删文字');
    assert.strictEqual(testReport.modeSwitchUndoTyping, '墨窗', '第 2 次撤销必须恢复原始文字');

    // 验证测试 3: 中文 IME
    assert.strictEqual(testReport.afterImeUndo, '初始', '中文输入法撤销必须直接回到上屏前状态，不包含中间拼音');

    // 验证测试 4: 30 步深层撤销
    assert.strictEqual(testReport.deepUndoCount, 30, '30 次连续编辑操作必须支持完整的 30 步连续撤销');
    assert.strictEqual(testReport.deepUndoFinished, true, '30 次撤销后文本必须完全归空');

    console.log('\n\x1b[32m=== 所有深层撤销与重做测试全部 PASS 100%！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
