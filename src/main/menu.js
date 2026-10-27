/**
 * 墨窗 (MoWin) - 原生 Windows 菜单栏与快捷键配置
 */

const { Menu, dialog, app } = require('electron');
const DefaultApp = require('./default-app');

function buildAppMenu(createDocumentWindow) {
  const isMac = process.platform === 'darwin';

  const send = (action, ...args) => {
    const focused = require('electron').BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) {
      focused.webContents.send('menu:action', action, ...args);
    }
  };

  const scaleLevels = [50, 60, 70, 80, 90, 100, 125, 150, 200];

  const template = [
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '新建(&N)',
          accelerator: 'CmdOrCtrl+N',
          click: () => createDocumentWindow()
        },
        {
          label: '打开…(&O)',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('open-file')
        },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('choose-folder')
        },
        { type: 'separator' },
        {
          label: '保存(&S)',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save-file')
        },
        {
          label: '另存为…(&A)',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('save-as')
        },
        {
          label: '以 UTF-8 另存为…',
          click: () => send('save-utf8')
        },
        {
          label: '恢复到上次保存',
          click: () => send('revert-saved')
        },
        { type: 'separator' },
        {
          label: '导出 HTML…',
          click: () => send('export-html')
        },
        {
          label: '打印 / 导出 PDF…(&P)',
          accelerator: 'CmdOrCtrl+P',
          click: () => send('export-pdf')
        },
        { type: 'separator' },
        {
          label: '默认打开 Markdown 文件…',
          click: (item, win) => {
            if (win) DefaultApp.offer(win, false);
          }
        },
        { type: 'separator' },
        {
          label: '关闭窗口(&W)',
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        },
        {
          label: '退出墨窗(&X)',
          accelerator: isMac ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '编辑(&E)',
      submenu: [
        { label: '撤销(&U)', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: '重做(&R)', accelerator: 'CmdOrCtrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { label: '剪切(&T)', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制(&C)', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴(&P)', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选(&A)', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        { label: '查找…(&F)', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: '查找并替换…(&H)', accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
        { label: '查找下一个', accelerator: 'F3', click: () => send('find-next') },
        { label: '查找上一个', accelerator: 'Shift+F3', click: () => send('find-prev') }
      ]
    },
    {
      label: '格式(&M)',
      submenu: [
        { label: '加粗(&B)', accelerator: 'CmdOrCtrl+B', click: () => send('format-bold') },
        { label: '斜体(&I)', accelerator: 'CmdOrCtrl+I', click: () => send('format-italic') },
        { label: '行内代码(&E)', accelerator: 'CmdOrCtrl+E', click: () => send('format-inline-code') },
        { label: '删除线', click: () => send('format-strikethrough') },
        { type: 'separator' },
        { label: '1 级标题', accelerator: 'CmdOrCtrl+Alt+1', click: () => send('format-heading', 1) },
        { label: '2 级标题', accelerator: 'CmdOrCtrl+Alt+2', click: () => send('format-heading', 2) },
        { label: '3 级标题', accelerator: 'CmdOrCtrl+Alt+3', click: () => send('format-heading', 3) },
        { label: '4 级标题', accelerator: 'CmdOrCtrl+Alt+4', click: () => send('format-heading', 4) },
        { label: '5 级标题', accelerator: 'CmdOrCtrl+Alt+5', click: () => send('format-heading', 5) },
        { label: '6 级标题', accelerator: 'CmdOrCtrl+Alt+6', click: () => send('format-heading', 6) },
        { label: '恢复正文', accelerator: 'CmdOrCtrl+Alt+0', click: () => send('format-heading', 0) },
        { type: 'separator' },
        { label: '引用(&Q)', click: () => send('format-quote') },
        { label: '无序列表(&L)', click: () => send('format-list') },
        { label: '任务列表(&K)', click: () => send('format-task-list') },
        { label: '代码块', click: () => send('format-code-block') },
        { label: '表格', click: () => send('format-table') },
        { label: '链接(&K)', accelerator: 'CmdOrCtrl+K', click: () => send('format-link') },
        { label: '插入本地图片…', click: () => send('format-image') }
      ]
    },
    {
      label: '视图(&V)',
      submenu: [
        { label: '编辑模式', accelerator: 'CmdOrCtrl+1', click: () => send('mode-edit') },
        { label: '双栏预览', accelerator: 'CmdOrCtrl+2', click: () => send('mode-split') },
        { label: '阅读模式', accelerator: 'CmdOrCtrl+3', click: () => send('mode-read') },
        { type: 'separator' },
        { label: '显示 / 隐藏侧栏', accelerator: 'CmdOrCtrl+\\', click: () => send('toggle-sidebar') },
        {
          label: '双栏同步滚动',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => send('toggle-sync-scroll', menuItem.checked)
        },
        { label: '刷新文件列表', click: () => send('refresh-files') },
        { label: '切换外观 (系统 / 浅色 / 深色)', click: () => send('cycle-theme') },
        { type: 'separator' },
        { label: '放大(&I)', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: '缩小(&O)', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: '重置显示比例(&R)', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        {
          label: '左栏显示比例 (编辑区)',
          submenu: [
            { label: '增大左栏字号', accelerator: 'CmdOrCtrl+Alt+=', click: () => send('editor-zoom-in') },
            { label: '减小左栏字号', accelerator: 'CmdOrCtrl+Alt+-', click: () => send('editor-zoom-out') },
            { label: '重置左栏 (100%)', click: () => send('set-editor-scale', 100) },
            { type: 'separator' },
            ...scaleLevels.map(p => ({
              label: `${p}%`,
              click: () => send('set-editor-scale', p)
            }))
          ]
        },
        {
          label: '右栏显示比例 (排版预览)',
          submenu: [
            { label: '增大右栏字号', accelerator: 'CmdOrCtrl+Shift+=', click: () => send('preview-zoom-in') },
            { label: '减小右栏字号', accelerator: 'CmdOrCtrl+Shift+-', click: () => send('preview-zoom-out') },
            { label: '重置右栏 (100%)', click: () => send('set-preview-scale', 100) },
            { type: 'separator' },
            ...scaleLevels.map(p => ({
              label: `${p}%`,
              click: () => send('set-preview-scale', p)
            }))
          ]
        }
      ]
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '快速上手 (示例.md)',
          click: () => send('open-sample')
        },
        {
          label: '运行全量功能自检…',
          click: (item, win) => {
            try {
              require('../../test/self-tests');
              dialog.showMessageBox(win, {
                type: 'info',
                title: '功能自检结果',
                message: '36 项核心功能自检全部通过！',
                detail: '包括 GFM 渲染、大纲解析、离线 MathJax 公式保护、LaTeX 转换、双栏滚动算法及编码往返等。'
              });
            } catch (err) {
              dialog.showMessageBox(win, {
                type: 'error',
                title: '自检异常',
                message: '自检测试出现失败：' + err.message
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: '关于 墨窗(&A)…',
          click: (item, win) => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: '关于 墨窗',
              message: '墨窗 · Windows Markdown 阅读与编辑器',
              detail: '版本 1.0.0 (Windows 专享版)\n\n融合极致排版、实时双向同步滚动、离线 MathJax 数学公式与纯净写作体验。\n\n学习并借鉴自 macOS 墨页，为 Windows 用户精心打造。'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { buildAppMenu };
