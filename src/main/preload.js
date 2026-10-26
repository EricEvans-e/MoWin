/**
 * 墨窗 (MoWin) - 安全预加载脚本 (Preload)
 * 将受控的系统与 IPC 能力暴露给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mowinAPI', {
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
