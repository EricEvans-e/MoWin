const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

let printToPdfReceivedOptions = null;

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
  content: '# PDF 测试文档\n\n正文内容',
  encoding: 'utf8',
  hasBOM: false,
  lineEnding: '\n',
  filePath: p
}));
ipcMain.handle('app:write-file', async () => ({ success: true }));
ipcMain.handle('app:list-files', () => ({ success: true, files: [] }));
ipcMain.handle('app:export-html', () => true);
ipcMain.handle('app:print-to-pdf', async (e, opts) => {
  printToPdfReceivedOptions = opts;
  return true;
});
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

  // 1. 设置暗黑主题、放大屏幕预览到 150%、录入包含公式、代码块、表格、引用的 Markdown
  await win.webContents.executeJavaScript(`
    window.mowinApp.setTheme('dark');
    window.mowinApp.scale.setPreviewScale(150);
    window.mowinApp.currentFilePath = 'E:/docs/技术架构方案.md';
    window.mowinApp.editor.setValue('# 技术架构方案\\n\\n这是一段引言文字。\\n\\n\`\`\`javascript\\nfunction calculateSum(a, b) {\\n  return a + b;\\n}\\n\`\`\`\\n\\n> 关键架构约束说明\\n\\n| 模块 | 协议 |\\n| --- | --- |\\n| 网关 | HTTP/2 |\\n\\n$$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$\\n', [0, 0]);
    window.mowinApp.renderPreview();
  `);
  await new Promise(r => setTimeout(r, 500));

  // 先真实调用 printToPDF 生成实际 PDF 二进制
  const actualPdfBuffer = await win.webContents.printToPDF({
    margins: { marginType: 'custom', top: 1.0, bottom: 1.0, left: 1.0, right: 1.0 },
    printBackground: true,
    pageSize: 'A4'
  });
  console.log('PDF byte size generated:', actualPdfBuffer ? actualPdfBuffer.length : 0);
  assert(actualPdfBuffer && actualPdfBuffer.length > 5000, '实际生成的 PDF 二进制大小必须有效');

  // 开启 print 媒体模拟测试打印样式
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });

  const printInspection = await win.webContents.executeJavaScript(`
    (() => {
      const h1 = document.querySelector('#preview-viewport h1');
      const body = document.body;
      const pre = document.querySelector('#preview-viewport pre');
      const blockquote = document.querySelector('#preview-viewport blockquote');
      const th = document.querySelector('#preview-viewport th');
      const viewport = document.getElementById('preview-viewport');
      const mathDisplay = document.querySelector('.mowin-math[data-display="true"]');

      const h1Style = window.getComputedStyle(h1);
      const preStyle = window.getComputedStyle(pre);
      const bqStyle = window.getComputedStyle(blockquote);
      const thStyle = window.getComputedStyle(th);
      const vpStyle = window.getComputedStyle(viewport);
      const mathStyle = mathDisplay ? window.getComputedStyle(mathDisplay) : {};

      return {
        bodyBg: window.getComputedStyle(body).backgroundColor,
        h1Color: h1Style.color,
        h1BreakAfter: h1Style.breakAfter || h1Style.pageBreakAfter,
        preBg: preStyle.backgroundColor,
        preColor: preStyle.color,
        preBreakInside: preStyle.breakInside || preStyle.pageBreakInside,
        preWhiteSpace: preStyle.whiteSpace,
        bqBg: bqStyle.backgroundColor,
        bqBreakInside: bqStyle.breakInside || bqStyle.pageBreakInside,
        thBg: thStyle.backgroundColor,
        viewportZoom: vpStyle.zoom,
        mathBreakInside: mathStyle.breakInside || mathStyle.pageBreakInside
      };
    })()
  `);

  console.log('=== 打印与 PDF 导出排版分析结果 ===');
  console.log(JSON.stringify(printInspection, null, 2));

  // 释放 debugger，以便后续正常调用 printToPDF
  if (win.webContents.debugger.isAttached()) {
    win.webContents.debugger.detach();
  }

  // 2. 模拟在编辑模式下触发 exportPDF，验证自动先渲染并提取文件名
  await win.webContents.executeJavaScript(`
    window.mowinApp.setMode('edit');
    window.mowinApp.editor.setValue('# 纯编辑模式文档\\n\\n编辑模式下导出的正文', [0, 0]);
    window.mowinApp.exportPDF();
  `);
  await new Promise(r => setTimeout(r, 400));

  console.log('IPC PrintToPdf received options:', printToPdfReceivedOptions);

  try {
    // 断言 1: 背景必须为纯白
    assert.strictEqual(printInspection.bodyBg, 'rgb(255, 255, 255)', '打印背景必须为纯白色');

    // 断言 2: 暗黑主题下的标题必须恢复为深黑色高对比度，绝不可为近白色
    assert.strictEqual(printInspection.h1Color, 'rgb(17, 24, 39)', '标题文字必须是深色高对比度 (#111827)，不可是白色');

    // 断言 3: 代码块背景必须是浅灰色，不可是黑色背景
    assert.strictEqual(printInspection.preBg, 'rgb(246, 248, 250)', '代码块背景必须是清爽浅灰 (#f6f8fa)，不可是大黑块');
    assert.strictEqual(printInspection.preColor, 'rgb(31, 35, 40)', '代码块字体颜色必须是清晰深色 (#1f2328)');

    // 断言 4: 屏幕放大到 150% 时，打印必须自动重置为 1 (100% 标准字号)
    assert.strictEqual(printInspection.viewportZoom, '1', '打印视口缩放必须强制重置为 1 (100%)，不可受屏幕缩放影响');

    // 断言 5: 分页防断裂保护
    assert(printInspection.preBreakInside === 'avoid', '代码块必须具有 break-inside: avoid，防止被跨页切断');
    assert(printInspection.bqBreakInside === 'avoid', '引用块必须具有 break-inside: avoid');
    assert(printInspection.mathBreakInside === 'avoid', '块级数学公式必须具有 break-inside: avoid');
    assert(printInspection.h1BreakAfter === 'avoid', '标题必须具有 break-after: avoid，防止孤行标题出现在页尾');

    // 断言 6: 代码块长行自动换行
    assert.strictEqual(printInspection.preWhiteSpace, 'pre-wrap', '打印模式下代码必须 pre-wrap 自动换行，防止右侧超出纸张被截断');

    // 断言 7: 提取默认文件名
    assert(printToPdfReceivedOptions && printToPdfReceivedOptions.defaultName.includes('.pdf'), '必须传递带 .pdf 后缀的文件名');

    console.log('\n\x1b[32m=== 所有 7 项 PDF 优化断言全部严格 PASS！===\x1b[0m\n');
    app.exit(0);
  } catch (err) {
    console.error('\n\x1b[31mFAIL 断言失败:\x1b[0m', err.message);
    app.exit(1);
  }
});
