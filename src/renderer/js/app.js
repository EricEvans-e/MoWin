/**
 * 墨窗 (MoWin) - 渲染进程总控制器
 * 聚合编辑器、排版预览、侧栏导航、双向同步滚动、选区浮动菜单、状态栏及离线 MathJax 排版
 */

const path = require('path');
const Markdown = require('../../common/markdown');
const Formatting = require('../../common/formatting');
const EditorController = require('./editor');
const ScrollSyncEngine = require('./scroll-sync');
const SidebarController = require('./sidebar');
const SelectionPopoverController = require('./selection');
const SearchController = require('./search');
const DisplayScaleController = require('./scale');

class AppController {
  constructor() {
    this.currentFilePath = null;
    this.currentEncoding = 'utf8';
    this.currentLineEnding = '\r\n'; // Windows 默认标准换行
    this.isModified = false;
    this.mode = 'split'; // 'edit' | 'split' | 'read'
    this.theme = 'system'; // 'system' | 'light' | 'dark'
    this.renderTimer = null;
    this.headings = [];

    this.initDOM();
    this.initComponents();
    this.initMenuListener();
    this.initMathJax();
    this.loadInitialFile();
  }

  initDOM() {
    this.editorContainer = document.getElementById('editor-container');
    this.previewContainer = document.getElementById('preview-container');
    this.previewViewport = document.getElementById('preview-viewport');
    this.paneDivider = document.getElementById('pane-divider');
    this.titleDisplay = document.getElementById('document-title-display');
    this.statusBar = document.getElementById('status-bar');

    // 工具栏按钮
    document.getElementById('btn-sidebar-toggle').addEventListener('click', () => this.sidebar.toggle());
    document.getElementById('btn-toolbar-open').addEventListener('click', () => this.openFile());
    document.getElementById('btn-toolbar-save').addEventListener('click', () => this.saveFile());
    document.getElementById('btn-toolbar-theme').addEventListener('click', () => this.cycleTheme());

    // 视图模式分段按钮
    document.getElementById('mode-btn-edit').addEventListener('click', () => this.setMode('edit'));
    document.getElementById('mode-btn-split').addEventListener('click', () => this.setMode('split'));
    document.getElementById('mode-btn-read').addEventListener('click', () => this.setMode('read'));

    // 支持预览区内的链接与滚动反馈
    window.onMowinScroll = (line) => {
      this.scrollSync.handlePreviewScroll(line);
    };

    // 拦截预览中的超链接
    this.previewViewport.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && a.href) {
        e.preventDefault();
        if (a.hash && a.hash.startsWith('#heading-')) {
          const el = document.querySelector(a.hash);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        } else {
          window.mowinAPI.openExternal(a.href);
        }
      }
    });

    // 监听窗口调整时重新估算源码位置
    window.addEventListener('resize', () => {
      if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
    });
  }

  initComponents() {
    const textarea = document.getElementById('markdown-editor');
    const gutter = document.getElementById('editor-gutter');
    this.editor = new EditorController(textarea, gutter, this);

    this.sidebar = new SidebarController(document.getElementById('sidebar'), this);
    this.scrollSync = new ScrollSyncEngine(this);
    this.selectionPopover = new SelectionPopoverController(document.getElementById('selection-popover'), this);
    this.search = new SearchController(document.getElementById('find-replace-bar'), this);

    const editorScaleSelect = document.getElementById('editor-scale-select');
    const previewScaleSelect = document.getElementById('preview-scale-select');
    this.scale = new DisplayScaleController(editorScaleSelect, previewScaleSelect, this);

    // 加载保存的主题
    const savedTheme = localStorage.getItem('mowin_theme') || 'system';
    this.setTheme(savedTheme);
  }

  initMathJax() {
    window.MathJax = {
      loader: { load: [] },
      tex: {
        packages: ['base', 'ams', 'newcommand', 'noundefined', 'configmacros', 'boldsymbol', 'mathtools', 'cancel', 'color'],
        maxBuffer: 100000
      },
      svg: { fontCache: 'none' },
      options: { enableMenu: false, enableAssistiveMml: false },
      startup: { typeset: false }
    };

    // 动态载入离线 MathJax
    const script = document.createElement('script');
    script.src = '../../vendor/MathJax/tex-svg-full.js';
    script.onload = () => {
      this.renderPreview();
    };
    document.head.appendChild(script);
  }

  async loadInitialFile() {
    const initialPath = await window.mowinAPI.getInitialFilePath();
    if (initialPath) {
      await this.openDocumentPath(initialPath);
    } else {
      // 首次加载示例引导内容
      const samplePath = path.join(__dirname, '../../../示例.md');
      const fs = require('fs');
      if (fs.existsSync(samplePath)) {
        await this.openDocumentPath(samplePath);
      } else {
        this.newDocument();
      }
    }
  }

  initMenuListener() {
    window.mowinAPI.onMenuAction((action, ...args) => {
      switch (action) {
        case 'new-document': this.newDocument(); break;
        case 'open-file': this.openFile(); break;
        case 'choose-folder': this.sidebar.chooseFolder(); break;
        case 'save-file': this.saveFile(); break;
        case 'save-as': this.saveAs(); break;
        case 'save-utf8': this.saveUTF8(); break;
        case 'revert-saved': this.revertSaved(); break;
        case 'export-html': this.exportHTML(); break;
        case 'export-pdf': this.exportPDF(); break;
        case 'open-sample': this.openSample(); break;

        // 编辑菜单
        case 'undo': document.execCommand('undo'); break;
        case 'redo': document.execCommand('redo'); break;
        case 'find': this.search.show(false); break;
        case 'replace': this.search.show(true); break;
        case 'find-next': this.search.findNext(); break;
        case 'find-prev': this.search.findPrev(); break;

        // 格式菜单
        case 'format-bold': this.applyFormatting(text => Formatting.emphasis(text, this.getSelection(), '**')); break;
        case 'format-italic': this.applyFormatting(text => Formatting.emphasis(text, this.getSelection(), '*')); break;
        case 'format-inline-code': this.applyFormatting(text => Formatting.wrap(text, this.getSelection(), '`', '`', 'code')); break;
        case 'format-strikethrough': this.applyFormatting(text => Formatting.wrap(text, this.getSelection(), '~~', '~~')); break;
        case 'format-heading': this.applyFormatting(text => Formatting.heading(text, this.getSelection(), args[0])); break;
        case 'format-quote': this.applyFormatting(text => Formatting.togglePrefix(text, this.getSelection(), '> ')); break;
        case 'format-list': this.applyFormatting(text => Formatting.togglePrefix(text, this.getSelection(), '- ')); break;
        case 'format-task-list': this.applyFormatting(text => Formatting.togglePrefix(text, this.getSelection(), '- [ ] ')); break;
        case 'format-code-block': this.applyFormatting(text => Formatting.wrap(text, this.getSelection(), '\n```\n', '\n```\n', '代码')); break;
        case 'format-table': this.editor.insertAtCursor('\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n'); break;
        case 'format-link': this.applyFormatting(text => Formatting.wrap(text, this.getSelection(), '[', '](https://example.com)', '链接文字')); break;
        case 'format-image': this.selectionPopover.onInsertImage(); break;

        // 视图菜单
        case 'mode-edit': this.setMode('edit'); break;
        case 'mode-split': this.setMode('split'); break;
        case 'mode-read': this.setMode('read'); break;
        case 'toggle-sidebar': this.sidebar.toggle(); break;
        case 'toggle-sync-scroll': this.scrollSync.toggle(args[0]); break;
        case 'refresh-files': this.sidebar.refreshFiles(); break;
        case 'cycle-theme': this.cycleTheme(); break;
        case 'set-editor-scale': this.scale.setEditorScale(args[0]); break;
        case 'set-preview-scale': this.scale.setPreviewScale(args[0]); break;
        case 'font-larger': this.scale.stepEditor(1); break;
        case 'font-smaller': this.scale.stepEditor(-1); break;
        case 'preview-larger': this.scale.stepPreview(1); break;
        case 'preview-smaller': this.scale.stepPreview(-1); break;
      }
    });
  }

  getSelection() {
    return {
      start: this.editor.textarea.selectionStart,
      end: this.editor.textarea.selectionEnd
    };
  }

  applyFormatting(formatter) {
    if (this.mode === 'read') this.setMode('split');
    const text = this.editor.textarea.value;
    const edit = formatter(text);
    if (edit) {
      this.editor.applyEdit(edit);
    }
  }

  onTextChanged() {
    this.isModified = true;
    this.updateTitleAndStatus();
    this.scheduleRender();
  }

  onEditorScrolled() {
    this.selectionPopover.hide();
    this.scrollSync.handleEditorScroll();
  }

  onSelectionChanged() {
    this.selectionPopover.scheduleShow();
    this.updateStatusLine();
  }

  scheduleRender() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderPreview();
    }, 180);
  }

  /**
   * 渲染预览区与公式排版
   */
  async renderPreview() {
    const text = this.editor.textarea.value;
    const { body, headings } = Markdown.render(text);
    this.headings = headings;
    this.sidebar.updateHeadings(headings);

    // 解析图片路径（若为本地图片，转换为 mowin-resource:// 协议进行加载）
    const docDir = this.currentFilePath ? path.dirname(this.currentFilePath) : '';
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = body;

    const imgEls = tempContainer.querySelectorAll('img');
    for (const img of imgEls) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
        let absImgPath = src;
        if (docDir && !path.isAbsolute(src)) {
          absImgPath = path.resolve(docDir, src);
        }
        img.src = `mowin-resource:///${encodeURIComponent(absImgPath.replace(/\\/g, '/'))}`;
      }
    }

    this.previewViewport.innerHTML = tempContainer.innerHTML;
    if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();

    // 调度离线 MathJax SVG 排版
    this.sidebar.setPdfEnabled(false);
    if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
      try {
        await window.MathJax.startup.promise;
        if (!document.getElementById('MJX-offline-styles')) {
          const style = window.MathJax.startup.document.outputJax.styleSheet(window.MathJax.startup.document);
          style.id = 'MJX-offline-styles';
          document.head.appendChild(style);
        }

        const mathNodes = Array.from(this.previewViewport.querySelectorAll('.mowin-math'));
        for (const node of mathNodes) {
          const tex = node.textContent;
          const isDisplay = node.dataset.display === 'true';
          try {
            const svgOutput = await window.MathJax.tex2svgPromise(tex, { display: isDisplay });
            svgOutput.querySelectorAll('mjx-assistive-mml').forEach(n => n.remove());
            node.replaceChildren(svgOutput);
          } catch (err) {
            node.classList.add('math-error');
            node.textContent = tex;
            node.title = '公式排版异常：' + err.message;
          }
        }
        this.sidebar.setPdfEnabled(true);
      } catch (err) {
        console.warn('MathJax 排版异常:', err);
      }
    } else {
      this.sidebar.setPdfEnabled(true);
    }
  }

  scrollToHeading(index) {
    const el = document.getElementById(`heading-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  syncPreviewToLine(linePos) {
    if (window.scrollToLine) {
      window.scrollToLine(linePos);
    }
  }

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('.segmented-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`mode-btn-${mode}`).classList.add('active');

    if (mode === 'edit') {
      this.editorContainer.classList.remove('hidden');
      this.previewContainer.classList.add('hidden');
      this.paneDivider.style.display = 'none';
      this.editor.textarea.focus();
    } else if (mode === 'read') {
      this.editorContainer.classList.add('hidden');
      this.previewContainer.classList.remove('hidden');
      this.paneDivider.style.display = 'none';
    } else {
      // split
      this.editorContainer.classList.remove('hidden');
      this.previewContainer.classList.remove('hidden');
      this.paneDivider.style.display = 'block';
      this.editor.textarea.focus();
    }
    this.selectionPopover.hide();
  }

  setTheme(theme) {
    this.theme = theme;
    localStorage.setItem('mowin_theme', theme);
    document.body.classList.remove('light-theme', 'dark-theme');
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    }
  }

  cycleTheme() {
    const next = this.theme === 'system' ? 'light' : (this.theme === 'light' ? 'dark' : 'system');
    this.setTheme(next);
  }

  newDocument() {
    this.currentFilePath = null;
    this.currentEncoding = 'utf8';
    this.currentLineEnding = '\r\n';
    this.isModified = false;
    this.editor.setValue('', [0, 0]);
    this.editor.rebuildLineStarts();
    this.editor.updateGutter();
    this.renderPreview();
    this.updateTitleAndStatus();
  }

  async openFile() {
    const filePath = await window.mowinAPI.openFileDialog();
    if (!filePath) return;
    await this.openDocumentPath(filePath);
  }

  async openDocumentPath(filePath) {
    const res = await window.mowinAPI.readFile(filePath);
    if (!res.success) {
      alert('读取文件失败: ' + res.error);
      return;
    }

    this.currentFilePath = filePath;
    this.currentEncoding = res.encoding;
    this.currentLineEnding = res.lineEnding;
    this.isModified = false;

    this.editor.setValue(res.content, [0, 0]);
    this.editor.rebuildLineStarts();
    this.editor.updateGutter();
    this.renderPreview();
    this.updateTitleAndStatus();
  }

  async saveFile() {
    if (!this.currentFilePath) {
      return this.saveAs();
    }
    const content = this.editor.textarea.value;
    const res = await window.mowinAPI.writeFile(this.currentFilePath, content, this.currentEncoding, this.currentLineEnding);
    if (res.success) {
      this.isModified = false;
      this.updateTitleAndStatus();
    } else {
      alert('保存失败: ' + res.error);
    }
  }

  async saveAs() {
    const defaultName = this.currentFilePath ? path.basename(this.currentFilePath) : '未命名.md';
    const filePath = await window.mowinAPI.saveFileDialog(defaultName);
    if (!filePath) return;
    this.currentFilePath = filePath;
    await this.saveFile();
  }

  async saveUTF8() {
    this.currentEncoding = 'utf8';
    await this.saveAs();
  }

  async revertSaved() {
    if (!this.currentFilePath) return;
    await this.openDocumentPath(this.currentFilePath);
  }

  async exportHTML() {
    const defaultName = this.currentFilePath ? path.basename(this.currentFilePath, path.extname(this.currentFilePath)) : '文档';
    // 提取当前渲染好的预览内容与 MathJax SVG 样式
    const mainHtml = this.previewViewport.innerHTML;
    const mathStyles = Array.from(document.querySelectorAll('style[id^=MJX]')).map(s => s.outerHTML).join('\n');
    const fullHtml = Markdown.page({ body: mainHtml }, {
      title: defaultName,
      typeset: false,
      mathStyles: mathStyles
    });

    await window.mowinAPI.exportHtml(defaultName, fullHtml);
  }

  async exportPDF() {
    const margin = this.sidebar.getPdfMarginOption();
    await window.mowinAPI.printToPdf(margin);
  }

  async openSample() {
    const samplePath = path.join(__dirname, '../../../示例.md');
    await this.openDocumentPath(samplePath);
  }

  updateTitleAndStatus() {
    const fileName = this.currentFilePath ? path.basename(this.currentFilePath) : '未命名';
    const dirtyMarker = this.isModified ? ' •' : '';
    const fullTitle = `${fileName}${dirtyMarker} - 墨窗`;

    this.titleDisplay.textContent = `${fileName}${dirtyMarker}`;
    window.mowinAPI.setWindowTitle(fullTitle);
    this.updateStatusLine();
  }

  updateStatusLine() {
    const text = this.editor.textarea.value;
    const charCount = text.replace(/\s/g, '').length;
    const totalLines = this.editor.lineStarts.length;
    const { line } = this.editor.getCurrentLineAndCol();
    const encStr = this.currentEncoding.toUpperCase();
    const endingStr = this.currentLineEnding === '\r\n' ? 'CRLF' : 'LF';
    const stateStr = this.isModified ? '修改待保存' : '已保存';

    this.statusBar.textContent = `${charCount} 字符   ·   ${totalLines} 行   ·   第 ${line} 行   ·   ${encStr} / ${endingStr}   ·   ${stateStr}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.mowinApp = new AppController();
});
