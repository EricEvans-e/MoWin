/**
 * 墨窗 (MoWin) - Windows Markdown 编辑器主进程
 * 多窗口管理、本地资源安全协议、编码检测、文件 I/O、PDF / HTML 导出及注册表集成
 */

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
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
  // 如果该文件已在某个窗口打开，则直接激活该窗口 (Windows 大小写不敏感比对)
  if (targetFilePath) {
    const normTarget = path.normalize(targetFilePath).toLowerCase();
    for (const [id, info] of openWindows.entries()) {
      if (info.filePath && path.normalize(info.filePath).toLowerCase() === normTarget) {
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
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    }
  });

  const winInfo = {
    win,
    filePath: targetFilePath ? path.resolve(targetFilePath) : null,
    docDir: targetFilePath ? path.dirname(path.resolve(targetFilePath)) : null,
    isModified: false,
    forceClose: false
  };
  openWindows.set(win.id, winInfo);

  // 原生 Windows 右键上下文菜单 (Cut, Copy, Paste, Format)
  win.webContents.on('context-menu', (event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    const menuTemplate = [];

    if (isEditable) {
      menuTemplate.push(
        { label: '撤销(&U)', accelerator: 'CmdOrCtrl+Z', enabled: editFlags.canUndo, click: () => win.webContents.send('menu:action', 'undo') },
        { label: '重做(&R)', accelerator: 'CmdOrCtrl+Y', enabled: editFlags.canRedo, click: () => win.webContents.send('menu:action', 'redo') },
        { type: 'separator' },
        { label: '剪切(&T)', accelerator: 'CmdOrCtrl+X', enabled: editFlags.canCut, role: 'cut' },
        { label: '复制(&C)', accelerator: 'CmdOrCtrl+C', enabled: editFlags.canCopy, role: 'copy' },
        { label: '粘贴(&P)', accelerator: 'CmdOrCtrl+V', enabled: editFlags.canPaste, role: 'paste' },
        { label: '全选(&A)', accelerator: 'CmdOrCtrl+A', enabled: editFlags.canSelectAll, role: 'selectAll' }
      );
      if (selectionText && selectionText.trim()) {
        menuTemplate.push(
          { type: 'separator' },
          { label: '加粗(&B)', click: () => win.webContents.send('menu:action', 'format-bold') },
          { label: '斜体(&I)', click: () => win.webContents.send('menu:action', 'format-italic') },
          { label: '行内代码', click: () => win.webContents.send('menu:action', 'format-inline-code') },
          {
            label: '设为标题…',
            submenu: [
              { label: '1 级标题', click: () => win.webContents.send('menu:action', 'format-heading', 1) },
              { label: '2 级标题', click: () => win.webContents.send('menu:action', 'format-heading', 2) },
              { label: '3 级标题', click: () => win.webContents.send('menu:action', 'format-heading', 3) },
              { label: '恢复正文', click: () => win.webContents.send('menu:action', 'format-heading', 0) }
            ]
          }
        );
      }
    } else {
      if (editFlags.canCopy) {
        menuTemplate.push({ label: '复制(&C)', accelerator: 'CmdOrCtrl+C', role: 'copy' });
      }
      menuTemplate.push({ label: '全选(&A)', accelerator: 'CmdOrCtrl+A', role: 'selectAll' });
    }

    menuTemplate.push(
      { type: 'separator' },
      { label: '查找…(&F)', accelerator: 'CmdOrCtrl+F', click: () => win.webContents.send('menu:action', 'find') }
    );

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    contextMenu.popup({ window: win });
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.once('ready-to-show', () => {
    win.show();
    // 首次启动时提示设置默认应用
    DefaultApp.offer(win, true);
  });

  // 窗口关闭拦截（未保存修改时原生对话框防护）
  win.on('close', async (e) => {
    const info = openWindows.get(win.id);
    if (info && info.isModified && !info.forceClose) {
      e.preventDefault();
      const fileName = info.filePath ? path.basename(info.filePath) : '未命名.md';
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        title: '未保存的更改 - 墨窗',
        message: `是否将更改保存到“${fileName}”？`,
        detail: '如果不保存，您所做的修改将会彻底丢失。'
      });
      if (response === 0) { // 保存并关闭
        win.webContents.send('menu:action', 'save-and-close');
      } else if (response === 1) { // 不保存直接关闭
        info.forceClose = true;
        win.destroy();
      } // 2: 取消关闭
    }
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

const { detectAndReadFile, saveFileWithFormat } = require('../common/file-io');

// 单实例锁配置与多文件关联唤起
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    let targetFile = null;
    const args = commandLine.slice(app.isPackaged ? 1 : 2);
    for (const arg of args) {
      if (!arg.startsWith('-') && fs.existsSync(arg) && fs.statSync(arg).isFile()) {
        targetFile = path.resolve(arg);
        break;
      }
    }
    const win = createDocumentWindow(targetFile);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  // 设置自定义本地资源加载协议 mowin-resource://
  protocol.handle('mowin-resource', (request) => {
    try {
      const url = new URL(request.url);
      let rawPath = decodeURIComponent(url.pathname);
      // Windows 路径开头斜杠处理 (/C:/... -> C:/...)
      if (process.platform === 'win32' && rawPath.startsWith('/') && rawPath.length > 2 && rawPath[2] === ':') {
        rawPath = rawPath.slice(1);
      }
      return net.fetch(pathToFileURL(rawPath).toString());
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

ipcMain.handle('app:confirm-save-dialog', async (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    title: '未保存的更改 - 墨窗',
    message: `是否将更改保存到“${fileName}”？`,
    detail: '如果不保存，您所做的修改将会彻底丢失。'
  });
  if (response === 0) return 'save';
  if (response === 1) return 'dont-save';
  return 'cancel';
});

ipcMain.handle('app:read-file', async (event, filePath) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    // 检查其他窗口是否已经打开了该文件 (Windows 大小写不敏感比对)
    if (win) {
      const normTarget = path.normalize(filePath).toLowerCase();
      for (const [id, info] of openWindows.entries()) {
        if (info.win && !info.win.isDestroyed() && id !== win.id) {
          if (info.filePath && path.normalize(info.filePath).toLowerCase() === normTarget) {
            info.win.focus();
            return { success: false, alreadyOpen: true };
          }
        }
      }
    }

    const data = detectAndReadFile(filePath);
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

ipcMain.handle('app:write-file', async (event, filePath, content, encoding, lineEnding, hasBOM) => {
  try {
    saveFileWithFormat(filePath, content, encoding, lineEnding, hasBOM);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && openWindows.has(win.id)) {
      const info = openWindows.get(win.id);
      info.filePath = filePath;
      info.docDir = path.dirname(filePath);
    }
    const stat = fs.statSync(filePath);
    return { success: true, mtime: stat.mtimeMs };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:open-image-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择本地图片文件',
    filters: [
      { name: '常见图片格式 (*.png;*.jpg;*.jpeg;*.webp;*.svg;*.gif;*.bmp;*.ico)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp', 'ico'] },
      { name: '所有文件 (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
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

ipcMain.handle('app:read-image-data-url', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon'
    };
    const mime = mimeMap[ext] || 'image/png';
    const data = fs.readFileSync(filePath);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('app:force-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const info = openWindows.get(win.id);
    if (info) info.forceClose = true;
    win.destroy();
  }
  return true;
});

ipcMain.handle('app:clear-window-file', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && openWindows.has(win.id)) {
    const info = openWindows.get(win.id);
    info.filePath = null;
    info.docDir = null;
    info.isModified = false;
  }
  return true;
});

ipcMain.handle('app:set-dirty-state', (event, isModified) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && openWindows.has(win.id)) {
    const info = openWindows.get(win.id);
    info.isModified = Boolean(isModified);
  }
  return true;
});

ipcMain.handle('app:set-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setTitle(title);
  }
});
