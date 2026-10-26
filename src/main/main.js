/**
 * 墨窗 (MoWin) - Windows Markdown 编辑器主进程
 * 多窗口管理、本地资源安全协议、编码检测、文件 I/O、PDF / HTML 导出及注册表集成
 */

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildAppMenu } = require('./menu');
const DefaultApp = require('./default-app');

// 命令行自检参数检查
if (process.argv.includes('--self-test')) {
  require('../../test/self-tests');
  app.exit(0);
}

// 注册自定义安全协议 mowin-resource:// 供预览安全加载本地图片
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mowin-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

// 跟踪所有已打开的窗口
const openWindows = new Map(); // windowId -> { win, filePath, docDir }

function createDocumentWindow(targetFilePath = null) {
  // 如果该文件已在某个窗口打开，则直接激活该窗口
  if (targetFilePath) {
    const normTarget = path.normalize(targetFilePath);
    for (const [id, info] of openWindows.entries()) {
      if (info.filePath && path.normalize(info.filePath) === normTarget) {
        if (!info.win.isDestroyed()) {
          info.win.focus();
          return info.win;
        }
      }
    }
  }

  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 780,
    minHeight: 520,
    title: '墨窗',
    backgroundColor: '#fcfbf8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  const winInfo = {
    win,
    filePath: targetFilePath ? path.resolve(targetFilePath) : null,
    docDir: targetFilePath ? path.dirname(path.resolve(targetFilePath)) : null
  };
  openWindows.set(win.id, winInfo);

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => {
    win.show();
    // 首次启动时提示设置默认应用
    DefaultApp.offer(win, true);
  });

  win.on('closed', () => {
    openWindows.delete(win.id);
  });

  return win;
}

// 递归扫描文件夹下的 Markdown 和文本文件 (最多 10000 个)
function scanFolder(folderPath, maxFiles = 10000) {
  const result = [];
  const allowedExts = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mmd', '.txt']);

  function walk(currentDir) {
    if (result.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      if (result.length >= maxFiles) break;
      const name = entry.name;
      // 忽略隐藏文件、版本控制和依赖文件夹
      if (name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN') {
        continue;
      }
      const fullPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (allowedExts.has(ext)) {
          result.push(fullPath);
        }
      }
    }
  }

  walk(folderPath);
  return result.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// 检测文件编码与换行符
function detectAndReadFile(filePath) {
  const buf = fs.readFileSync(filePath);
  let encoding = 'utf8';
  let text = '';

  // 检测 BOM 标记
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    encoding = 'utf16le';
    text = buf.slice(2).toString('utf16le');
  } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    // 简单支持 UTF-16BE (转置字节)
    encoding = 'utf16be';
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i < buf.length - 1; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    text = swapped.toString('utf16le');
  } else {
    // UTF-8
    let offset = 0;
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      offset = 3; // UTF-8 BOM
    }
    encoding = 'utf8';
    text = buf.slice(offset).toString('utf8');
  }

  // 检测换行符
  const lineEnding = text.includes('\r\n') ? '\r\n' : (text.includes('\r') ? '\r' : '\n');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return {
    content: normalized,
    encoding,
    lineEnding,
    filePath
  };
}

// 写入文件（保留编码和换行符）
function saveFileWithFormat(filePath, content, encoding = 'utf8', lineEnding = '\n') {
  const textWithEnding = content.replace(/\n/g, lineEnding);
  let buf;
  if (encoding.toLowerCase().startsWith('utf16') || encoding.toLowerCase() === 'utf-16') {
    buf = Buffer.from(textWithEnding, 'utf16le');
  } else {
    buf = Buffer.from(textWithEnding, 'utf8');
  }
  fs.writeFileSync(filePath, buf);
}

app.whenReady().then(() => {
  // 设置自定义本地资源加载协议 mowin-resource://
  protocol.handle('mowin-resource', (request) => {
    try {
      const url = new URL(request.url);
      let rawPath = decodeURIComponent(url.pathname);
      // Windows 路径开头斜杠处理
      if (process.platform === 'win32' && rawPath.startsWith('/') && rawPath.length > 2 && rawPath[2] === ':') {
        rawPath = rawPath.slice(1);
      }
      return net.fetch('file:///' + rawPath.replace(/\\/g, '/'));
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  });

  buildAppMenu(createDocumentWindow);

  // 解析启动参数中的文件路径
  let initialFile = null;
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  for (const arg of args) {
    if (!arg.startsWith('-') && fs.existsSync(arg) && fs.statSync(arg).isFile()) {
      initialFile = path.resolve(arg);
      break;
    }
  }

  createDocumentWindow(initialFile);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createDocumentWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// =================== IPC 通信事件处理 ===================

ipcMain.handle('app:get-initial-file', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const info = openWindows.get(win.id);
  return info ? info.filePath : null;
});

ipcMain.handle('app:open-file-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '打开 Markdown 或文本文件',
    filters: [
      { name: 'Markdown / 文本文件', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mmd', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

ipcMain.handle('app:save-file-dialog', async (event, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '保存 Markdown 文件',
    defaultPath: defaultName || '未命名.md',
    filters: [
      { name: 'Markdown 文件 (*.md)', extensions: ['md'] },
      { name: '文本文件 (*.txt)', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (canceled || !filePath) return null;
  return filePath;
});

ipcMain.handle('app:choose-folder-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择包含 Markdown 的文件夹',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

ipcMain.handle('app:read-file', async (event, filePath) => {
  try {
    const data = detectAndReadFile(filePath);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && openWindows.has(win.id)) {
      const info = openWindows.get(win.id);
      info.filePath = filePath;
      info.docDir = path.dirname(filePath);
    }
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:write-file', async (event, filePath, content, encoding, lineEnding) => {
  try {
    saveFileWithFormat(filePath, content, encoding, lineEnding);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && openWindows.has(win.id)) {
      const info = openWindows.get(win.id);
      info.filePath = filePath;
      info.docDir = path.dirname(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:list-files', async (event, folderPath) => {
  try {
    const files = scanFolder(folderPath);
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:export-html', async (event, defaultName, htmlContent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出为 HTML 网页',
    defaultPath: (defaultName || '未命名') + '.html',
    filters: [{ name: 'HTML 文件 (*.html)', extensions: ['html', 'htm'] }]
  });
  if (canceled || !filePath) return false;
  try {
    fs.writeFileSync(filePath, htmlContent, 'utf8');
    return true;
  } catch (err) {
    dialog.showErrorBox('导出 HTML 失败', err.message);
    return false;
  }
});

ipcMain.handle('app:print-to-pdf', async (event, marginOption) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // 页边距映射 (单位: 英寸)
  // 正常 · 25.4 mm = 1.0 inch
  // 较窄 · 12.7 mm = 0.5 inch
  // 极窄 · 6.35 mm = 0.25 inch
  let marginInches = 1.0;
  if (marginOption === 1) marginInches = 0.5;
  else if (marginOption === 2) marginInches = 0.25;

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '存储为 PDF 文件',
    defaultPath: '文档.pdf',
    filters: [{ name: 'PDF 文档 (*.pdf)', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return false;

  try {
    const pdfData = await win.webContents.printToPDF({
      margins: {
        marginType: 'custom',
        top: marginInches,
        bottom: marginInches,
        left: marginInches,
        right: marginInches
      },
      printBackground: true,
      pageSize: 'A4'
    });
    fs.writeFileSync(filePath, pdfData);
    return true;
  } catch (err) {
    dialog.showErrorBox('导出 PDF 失败', err.message);
    return false;
  }
});

ipcMain.handle('app:print', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.webContents.print({ silent: false, printBackground: true });
  return true;
});

ipcMain.handle('app:new-window', (event, filePath) => {
  createDocumentWindow(filePath);
  return true;
});

ipcMain.handle('app:open-external', (event, url) => {
  shell.openExternal(url);
  return true;
});

ipcMain.handle('app:show-default-app-dialog', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) DefaultApp.offer(win, false);
});

ipcMain.handle('app:set-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setTitle(title);
});
