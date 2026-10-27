/**
 * 墨窗 (MoWin) - 渲染进程总控制器
 * 聚合编辑器、排版预览、侧栏导航、双向同步滚动、选区浮动菜单、状态栏及离线 MathJax 排版
 */

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
    this.initDividerDrag();
    this.initMenuListener();
    this.loadInitialFile();
  }

  initDOM() {
    this.editorContainer = document.getElementById('editor-container');
    this.previewContainer = document.getElementById('preview-container');
    this.previewViewport = document.getElementById('preview-viewport');
    this.paneDivider = document.getElementById('pane-divider');
    this.titleDisplay = document.getElementById('document-title-display');
    this.statusBar = document.getElementById('status-bar');
    this.themeBtn = document.getElementById('btn-toolbar-theme');
    this.saveBtn = document.getElementById('btn-toolbar-save');

    // 工具栏按钮绑定
    document.getElementById('btn-sidebar-toggle').addEventListener('click', () => this.sidebar.toggle());
    document.getElementById('btn-toolbar-open').addEventListener('click', () => this.openFile());
    this.saveBtn.addEventListener('click', () => this.saveFile());
    this.themeBtn.addEventListener('click', () => this.cycleTheme());

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
          if (el) {
            const containerRect = this.previewContainer.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const targetTop = (elRect.top - containerRect.top) + this.previewContainer.scrollTop - 24;
            this.previewContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          }
        } else {
          window.mowinAPI.openExternal(a.href);
        }
      }
    });

    // 监听窗口调整时重新估算源码位置与行号
    window.addEventListener('resize', () => {
      this.editor.updateGutter();
      if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
    });

    // 全局快捷键补全：支持 Ctrl+Shift+Z 重做
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        this.editor.redo();
      }
    });

    // 支持拖拽 Markdown 文件到窗口任意区域直接打开
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;
      const first = files[0];
      const ext = window.mowinAPI.path.extname(first.name || first.path).toLowerCase();
      const mdExts = ['.md', '.markdown', '.mdown', '.mkd', '.mmd', '.txt'];
      if (mdExts.includes(ext)) {
        e.preventDefault();
        await this.openDocumentPath(first.path);
      }
    });

    // 窗口关闭前如果有未保存修改，触发系统防护提示
    window.addEventListener('beforeunload', (e) => {
      if (this.isModified) {
        e.returnValue = false;
      }
    });

    window.invalidateSourceBlocks = () => {
      if (this.scrollSync) this.scrollSync.invalidateSourceBlocks();
    };
    window.scrollToLine = (line) => {
      if (this.scrollSync) this.scrollSync.scrollToPreviewLine(line);
    };
  }

  initComponents() {
    const textarea = document.getElementById('markdown-editor');
    const gutter = document.getElementById('editor-gutter');
    this.editor = new window.EditorController(textarea, gutter, this);

    this.sidebar = new window.SidebarController(document.getElementById('sidebar'), this);
    this.scrollSync = new window.ScrollSyncEngine(this);
    this.selectionPopover = new window.SelectionPopoverController(document.getElementById('selection-popover'), this);
    this.search = new window.SearchController(document.getElementById('find-replace-bar'), this);

    const editorScaleSelect = document.getElementById('editor-scale-select');
    const previewScaleSelect = document.getElementById('preview-scale-select');
    this.scale = new window.DisplayScaleController(editorScaleSelect, previewScaleSelect, this);

    // 加载保存的主题
    const savedTheme = localStorage.getItem('mowin_theme') || 'system';
    this.setTheme(savedTheme);
  }

  // 实现左右分栏拖拽调整宽度
  initDividerDrag() {
    let isDragging = false;
    this.paneDivider.addEventListener('mousedown', (e) => {
      if (this.mode !== 'split') return;
      isDragging = true;
      this.paneDivider.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const splitRect = document.getElementById('content-split').getBoundingClientRect();
      const offset = e.clientX - splitRect.left;
      const minWidth = 240;
      const maxWidth = splitRect.width - minWidth;
      if (offset >= minWidth && offset <= maxWidth) {
        this.editorContainer.style.flex = 'none';
        this.editorContainer.style.width = `${offset}px`;
        this.previewContainer.style.flex = '1';
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.paneDivider.classList.remove('resizing');
        document.body.style.cursor = 'default';
        this.editor.updateGutter();
        if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
      }
    });
  }

  async loadInitialFile() {
    const initialPath = await window.mowinAPI.getInitialFilePath();
    if (initialPath) {
      await this.openDocumentPath(initialPath);
    } else {
      await this.openSample();
    }
  }

  initMenuListener() {
    const formatting = window.mowinAPI.formatting;

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
        case 'undo': this.editor.undo(); break;
        case 'redo': this.editor.redo(); break;
        case 'find': this.search.show(false); break;
        case 'replace': this.search.show(true); break;
        case 'find-next': this.search.findNext(); break;
        case 'find-prev': this.search.findPrev(); break;

        // 格式菜单
        case 'format-bold': this.applyFormatting(text => formatting.emphasis(text, this.getSelection(), '**')); break;
        case 'format-italic': this.applyFormatting(text => formatting.emphasis(text, this.getSelection(), '*')); break;
        case 'format-inline-code': this.applyFormatting(text => formatting.wrap(text, this.getSelection(), '`', '`', 'code')); break;
        case 'format-strikethrough': this.applyFormatting(text => formatting.wrap(text, this.getSelection(), '~~', '~~')); break;
        case 'format-heading': this.applyFormatting(text => formatting.heading(text, this.getSelection(), args[0])); break;
        case 'format-quote': this.applyFormatting(text => formatting.togglePrefix(text, this.getSelection(), '> ')); break;
        case 'format-list': this.applyFormatting(text => formatting.togglePrefix(text, this.getSelection(), '- ')); break;
        case 'format-task-list': this.applyFormatting(text => formatting.togglePrefix(text, this.getSelection(), '- [ ] ')); break;
        case 'format-code-block': this.applyFormatting(text => formatting.wrap(text, this.getSelection(), '\n```\n', '\n```\n', '代码')); break;
        case 'format-table': this.editor.insertAtCursor('\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n'); break;
        case 'format-link': this.applyFormatting(text => formatting.wrap(text, this.getSelection(), '[', '](https://example.com)', '链接文字')); break;
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
    const { body, headings } = window.mowinAPI.markdown.render(text);
    this.headings = headings;
    this.sidebar.updateHeadings(headings);

    // 解析图片路径（若为本地图片，转换为 mowin-resource:// 协议进行安全加载）
    const docDir = this.currentFilePath ? window.mowinAPI.path.dirname(this.currentFilePath) : '';
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = body;

    const imgEls = tempContainer.querySelectorAll('img');
    for (const img of imgEls) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
        let absImgPath = src;
        if (docDir && !window.mowinAPI.path.isAbsolute(src)) {
          absImgPath = window.mowinAPI.path.resolve(docDir, src);
        }
        img.src = `mowin-resource:///${encodeURIComponent(absImgPath.replace(/\\/g, '/'))}`;
      }
      img.addEventListener('load', () => {
        if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
      });
    }

    // 注入代码块“复制”按钮
    const preEls = tempContainer.querySelectorAll('pre');
    for (const pre of preEls) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.title = '复制完整代码到剪贴板';
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const codeEl = pre.querySelector('code');
        const codeText = codeEl ? codeEl.innerText : pre.innerText;
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.textContent = '已复制 ✓';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '复制';
            copyBtn.classList.remove('copied');
          }, 1500);
        } catch (err) {
          copyBtn.textContent = '复制失败';
        }
      });
      pre.appendChild(copyBtn);
    }

    this.previewViewport.replaceChildren(...tempContainer.childNodes);
    if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();

    // 调度离线 MathJax SVG 排版 (带批次代际控制，快速打字自动废弃旧任务)
    this.renderGeneration = (this.renderGeneration || 0) + 1;
    const currentGeneration = this.renderGeneration;

    this.sidebar.setPdfEnabled(false);
    if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
      try {
        await window.MathJax.startup.promise;
        if (this.renderGeneration !== currentGeneration) return;

        if (!document.getElementById('MJX-offline-styles')) {
          const style = window.MathJax.startup.document.outputJax.styleSheet(window.MathJax.startup.document);
          style.id = 'MJX-offline-styles';
          document.head.appendChild(style);
        }

        const mathNodes = Array.from(this.previewViewport.querySelectorAll('.mowin-math'));
        for (const node of mathNodes) {
          if (this.renderGeneration !== currentGeneration) return;
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
        if (this.renderGeneration === currentGeneration) {
          this.sidebar.setPdfEnabled(true);
          if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
        }
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
      const containerRect = this.previewContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetTop = (elRect.top - containerRect.top) + this.previewContainer.scrollTop - 24;
      this.previewContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
  }

  syncPreviewToLine(linePos) {
    if (this.scrollSync) {
      this.scrollSync.scrollToPreviewLine(linePos);
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
      this.editorContainer.style.flex = '1';
      this.editorContainer.style.width = 'auto';
      this.editor.textarea.focus();
    } else if (mode === 'read') {
      this.editorContainer.classList.add('hidden');
      this.previewContainer.classList.remove('hidden');
      this.paneDivider.style.display = 'none';
      this.previewContainer.style.flex = '1';
    } else {
      // split
      this.editorContainer.classList.remove('hidden');
      this.previewContainer.classList.remove('hidden');
      this.paneDivider.style.display = 'block';
      this.editorContainer.style.flex = '1';
      this.editorContainer.style.width = 'auto';
      this.previewContainer.style.flex = '1';
      this.editor.textarea.focus();
    }
    this.selectionPopover.hide();
    if (mode !== 'read') {
      this.editor.updateGutter();
    }
    if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
  }

  setTheme(theme) {
    this.theme = theme;
    localStorage.setItem('mowin_theme', theme);
    document.body.classList.remove('light-theme', 'dark-theme');
    if (theme === 'light') {
      document.body.classList.add('light-theme');
      this.themeBtn.title = '当前外观：浅色模式 (点击切换)';
    } else if (theme === 'dark') {
      document.body.classList.add('dark-theme');
      this.themeBtn.title = '当前外观：深色模式 (点击切换)';
    } else {
      this.themeBtn.title = '当前外观：跟随系统 (点击切换)';
    }
  }

  cycleTheme() {
    const next = this.theme === 'system' ? 'light' : (this.theme === 'light' ? 'dark' : 'system');
    this.setTheme(next);
  }

  async promptSaveUnsaved() {
    const fileName = this.currentFilePath ? window.mowinAPI.path.basename(this.currentFilePath) : '未命名.md';
    return await window.mowinAPI.confirmSaveDialog(fileName); // 'save' | 'dont-save' | 'cancel'
  }

  async newDocument() {
    if (this.isModified) {
      const decision = await this.promptSaveUnsaved();
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const saved = await this.saveFile();
        if (!saved) return;
      }
    }

    this.currentFilePath = null;
    this.currentEncoding = 'utf8';
    this.currentLineEnding = '\r\n';
    this.isModified = false;
    this.editor.setValue('', [0, 0]);
    this.editor.rebuildLineStarts();
    this.editor.updateGutter();
    this.editor.history.init('');
    this.renderPreview();
    this.updateTitleAndStatus();
  }

  async openFile() {
    if (this.isModified) {
      const decision = await this.promptSaveUnsaved();
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const saved = await this.saveFile();
        if (!saved) return;
      }
    }

    const filePath = await window.mowinAPI.openFileDialog();
    if (!filePath) return;
    await this.openDocumentPath(filePath);
  }

  async openDocumentPath(filePath) {
    if (this.isModified && this.currentFilePath !== filePath) {
      const decision = await this.promptSaveUnsaved();
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const saved = await this.saveFile();
        if (!saved) return;
      }
    }

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
    this.editor.history.init(res.content);
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

      // 保存成功视觉反馈
      const saveSpan = this.saveBtn.querySelector('span');
      if (saveSpan) {
        saveSpan.textContent = '已保存 ✓';
        setTimeout(() => { saveSpan.textContent = '保存'; }, 1500);
      }
      return true;
    } else {
      alert('保存失败: ' + res.error);
      return false;
    }
  }

  async saveAs() {
    const defaultName = this.currentFilePath ? window.mowinAPI.path.basename(this.currentFilePath) : '未命名.md';
    const filePath = await window.mowinAPI.saveFileDialog(defaultName);
    if (!filePath) return false;
    this.currentFilePath = filePath;
    return await this.saveFile();
  }

  async saveUTF8() {
    this.currentEncoding = 'utf8';
    return await this.saveAs();
  }

  async revertSaved() {
    if (!this.currentFilePath) return;
    await this.openDocumentPath(this.currentFilePath);
  }

  async exportHTML() {
    const defaultName = this.currentFilePath ? window.mowinAPI.path.basename(this.currentFilePath, window.mowinAPI.path.extname(this.currentFilePath)) : '文档';
    // 提取当前渲染好的预览内容与 MathJax SVG 样式
    const mainHtml = this.previewViewport.innerHTML;
    const mathStyles = Array.from(document.querySelectorAll('style[id^=MJX]')).map(s => s.outerHTML).join('\n');
    const fullHtml = window.mowinAPI.markdown.page({ body: mainHtml }, {
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
    const sampleText = `# 墨窗 · 专注于纯粹写作与排版

一窗幽墨，一点专注。欢迎使用为你精心打造的 Windows Markdown 阅读与编辑器。

## 开始写作

在左侧输入 Markdown，右侧会实时显示排版。通过顶部操作栏的按钮随时在 **编辑**、**双栏** 和 **阅读** 三种模式之间切换。

> 文字完整保存在你自己的本地电脑中。墨窗不需要注册账号，完全离线运行，不连接任何第三方云端服务。

### 常用格式

支持 **加粗**、*斜体*、~~删除线~~、\`行内代码\`，以及丰富的表格与引用语法：

- 纯净本地存储，保障数据隐私安全
- 回车自动智能续写列表项
  - 空项回车自动退出列表
  - 支持多层嵌套结构

1. 打开或新建文件
2. 专注于输入内容
3. 按 Ctrl+S 极速保存

### 今日清单

- [x] 打开墨窗体验全新界面
- [x] 感受左右双栏视口第一行精准对齐
- [ ] 记录下今天的所思所想

## 表格与快捷键

| 功能 | Windows 快捷键 | 功能 | Windows 快捷键 |
| :--- | :--- | :--- | :--- |
| 新建文档 | Ctrl+N | 保存文档 | Ctrl+S |
| 查找与替换 | Ctrl+F / Ctrl+H | 插入链接 | Ctrl+K |
| 切换加粗 | Ctrl+B | 切换斜体 | Ctrl+I |
| 标题等级 | Ctrl+Alt+1~6 | 恢复正文 | Ctrl+Alt+0 |
| 显示/隐藏侧栏 | Ctrl+\\ | 导出 PDF / 打印 | Ctrl+P |

\`\`\`javascript
// 你好，墨窗！
function greetMoWin() {
  const message = "用文字记录思考，以排版呈现优雅。";
  console.log(message);
}
greetMoWin();
\`\`\`

## 离线数学公式

内置离线 MathJax 组件，无需联网即可排版复杂的科学公式与对齐矩阵：

行内公式：$\\frac{a_1}{b}$，根式公式：$\\sqrt{x^2+y^2}$。

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

$$
\\begin{aligned}
a+b &= c \\\\
x &= c-b
\\end{aligned}
$$

$$
\\begin{pmatrix}
1 & 2 \\\\
3 & 4
\\end{pmatrix}
$$

> 提示：在编辑区选中任意 LaTeX 代码后，浮动菜单首项会自动显示「**转换公式**」，一键将 \\(...\\)、\\[...\\] 或公式命令转为标准 Markdown 公式！

## 本地图片支持

支持从 Windows 资源管理器直接将图片拖拽到编辑区，或通过菜单「插入本地图片…」选择。墨窗会智能根据文件位置自动采用相对路径（同级或子文件夹）或绝对路径，并支持包含空格路径的自动转义。

## 双向同步滚动与独立缩放

- **首行对准同步**：在双栏模式下滑动任意一栏，另一栏随之跟随，并且视口首行精确对应相同内容；若需独立查阅，可在「视图 → 双栏同步滚动」中取消勾选。
- **独立显示比例**：左栏与右栏右下角均可独立切换 50% ~ 200% 显示比例。缩小字号可以在一屏内展现更多篇幅，不改变实际文档内容。
- **大纲与文件目录**：点击左上角「侧栏」，随时在大纲跳转和本地文件夹树之间切换。
- **导出与分享**：侧栏底部提供「导出 HTML」与「打印 / 导出 PDF」，预设正常、较窄、极窄三档专业页边距。

---

愿墨窗陪伴你写下的每一个字符，都成为值得留存的印记。
`;
    this.currentFilePath = null;
    this.currentEncoding = 'utf8';
    this.currentLineEnding = '\r\n';
    this.isModified = false;
    this.editor.setValue(sampleText, [0, 0]);
    this.editor.rebuildLineStarts();
    this.editor.updateGutter();
    this.editor.history.init(sampleText);
    this.renderPreview();
    this.updateTitleAndStatus();
  }

  updateTitleAndStatus() {
    const fileName = this.currentFilePath ? window.mowinAPI.path.basename(this.currentFilePath) : '未命名';
    const dirtyMarker = this.isModified ? ' •' : '';
    const fullTitle = `${fileName}${dirtyMarker} - 墨窗`;

    this.titleDisplay.textContent = `${fileName}${dirtyMarker}`;
    window.mowinAPI.setWindowTitle(fullTitle);
    this.updateStatusLine();
  }

  updateStatusLine() {
    const text = this.editor.textarea.value;
    const charCount = text.replace(/\s/g, '').length;
    const readMinutes = Math.max(1, Math.ceil(charCount / 350));
    const totalLines = this.editor.lineStarts.length;
    const { line } = this.editor.getCurrentLineAndCol();
    const encStr = this.currentEncoding.toUpperCase();
    const endingStr = this.currentLineEnding === '\r\n' ? 'CRLF' : 'LF';
    const stateStr = this.isModified ? '修改待保存' : '已保存';

    this.statusBar.textContent = `${charCount} 字符 (约 ${readMinutes} 分钟阅读)   ·   ${totalLines} 行   ·   第 ${line} 行   ·   ${encStr} / ${endingStr}   ·   ${stateStr}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.mowinApp = new AppController();
});
