/**
 * 墨窗 (MoWin) - 安全预加载脚本 (Preload)
 * 将核心排版、格式化算法及受控 IPC 通信安全暴露给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const Markdown = require('../common/markdown');
const LaTeX = require('../common/latex');
const Formatting = require('../common/formatting');
const ImagePaths = require('../common/image-paths');

contextBridge.exposeInMainWorld('mowinAPI', {
  // 核心跨平台算法库暴露
  markdown: {
    render: (text) => Markdown.render(text),
    page: (rendered, options) => Markdown.page(rendered, options)
  },
  formatting: {
    emphasis: (text, selection, marker, removeOnly) => Formatting.emphasis(text, selection, marker, removeOnly),
    heading: (text, selection, level) => Formatting.heading(text, selection, level),
    smartNewline: (lineText, col) => Formatting.smartNewline(lineText, col),
    wrap: (text, selection, left, right, placeholder) => Formatting.wrap(text, selection, left, right, placeholder),
    togglePrefix: (text, selection, prefix) => Formatting.togglePrefix(text, selection, prefix)
  },
  latex: {
    markdownFormula: (source) => LaTeX.markdownFormula(source)
  },
  imagePaths: {
    isImage: (filePath) => ImagePaths.isImage(filePath),
    markdown: (imagePath, documentPath, alt) => ImagePaths.markdown(imagePath, documentPath, alt)
  },
  path: {
    basename: (filePath, ext) => path.basename(filePath, ext),
    dirname: (filePath) => path.dirname(filePath),
    extname: (filePath) => path.extname(filePath),
    relative: (from, to) => path.relative(from, to),
    resolve: (...paths) => path.resolve(...paths),
    isAbsolute: (filePath) => path.isAbsolute(filePath)
  },

  // 文件对话框与 I/O 操作
  openFileDialog: () => ipcRenderer.invoke('app:open-file-dialog'),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('app:save-file-dialog', defaultName),
  chooseFolderDialog: () => ipcRenderer.invoke('app:choose-folder-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('app:read-file', filePath),
  writeFile: (filePath, content, encoding, lineEnding) => ipcRenderer.invoke('app:write-file', filePath, content, encoding, lineEnding),
  listFiles: (folderPath) => ipcRenderer.invoke('app:list-files', folderPath),
  
  // 导出与打印
  exportHtml: (defaultName, htmlContent) => ipcRenderer.invoke('app:export-html', defaultName, htmlContent),
  printToPdf: (marginOption) => ipcRenderer.invoke('app:print-to-pdf', marginOption),
  print: () => ipcRenderer.invoke('app:print'),

  // 窗口与系统操作
  openNewWindow: (filePath) => ipcRenderer.invoke('app:new-window', filePath),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  showDefaultAppDialog: () => ipcRenderer.invoke('app:show-default-app-dialog'),
  setWindowTitle: (title) => ipcRenderer.invoke('app:set-title', title),
  getInitialFilePath: () => ipcRenderer.invoke('app:get-initial-file'),

  // 菜单事件监听
  onMenuAction: (callback) => {
    const handler = (event, action, ...args) => callback(action, ...args);
    ipcRenderer.on('menu:action', handler);
    return () => ipcRenderer.removeListener('menu:action', handler);
  }
});
