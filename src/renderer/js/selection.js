/**
 * 墨窗 (MoWin) - 选区快捷操作浮动菜单 (Selection Popover)
 * 选中文本后自动弹出：支持智能识别 LaTeX 并动态展示“转换公式”，
 * 提供加粗、常规字重、斜体、标题等级切换、代码块、本地图片、链接、表格、列表等全套操作
 */

class SelectionPopoverController {
  constructor(popoverEl, app) {
    this.popover = popoverEl;
    this.app = app;
    this.selectedRange = { start: 0, end: 0 };
    this.selectedText = '';
    this.showTimer = null;
    this.lastMousePos = { x: 200, y: 200 };

    this.initElements();
  }

  initElements() {
    this.cutBtn = this.popover.querySelector('#popover-btn-cut');
    this.copyBtn = this.popover.querySelector('#popover-btn-copy');
    this.pasteBtn = this.popover.querySelector('#popover-btn-paste');
    this.formulaBtn = this.popover.querySelector('#popover-btn-formula');
    this.boldBtn = this.popover.querySelector('#popover-btn-bold');
    this.regularBtn = this.popover.querySelector('#popover-btn-regular');
    this.italicBtn = this.popover.querySelector('#popover-btn-italic');
    this.headingSelect = this.popover.querySelector('#popover-select-heading');
    this.codeBtn = this.popover.querySelector('#popover-btn-code');
    this.imageBtn = this.popover.querySelector('#popover-btn-image');
    this.linkBtn = this.popover.querySelector('#popover-btn-link');
    this.tableBtn = this.popover.querySelector('#popover-btn-table');
    this.listBtn = this.popover.querySelector('#popover-btn-list');
    this.orderedListBtn = this.popover.querySelector('#popover-btn-ordered-list');

    // 绑定剪贴板与格式化点击事件
    if (this.cutBtn) this.cutBtn.addEventListener('click', () => this.onCut());
    if (this.copyBtn) this.copyBtn.addEventListener('click', () => this.onCopy());
    if (this.pasteBtn) this.pasteBtn.addEventListener('click', () => this.onPaste());
    this.formulaBtn.addEventListener('click', () => this.onConvertFormula());
    this.boldBtn.addEventListener('click', () => this.onBold());
    this.regularBtn.addEventListener('click', () => this.onRegular());
    this.italicBtn.addEventListener('click', () => this.onItalic());
    this.headingSelect.addEventListener('change', (e) => this.onHeadingChange(e));
    this.codeBtn.addEventListener('click', () => this.onInsertAfter('\n\n```\n代码\n```\n\n'));
    this.imageBtn.addEventListener('click', () => this.onInsertImage());
    this.linkBtn.addEventListener('click', () => this.onInsertAfter(' [链接文字](https://example.com)'));
    this.tableBtn.addEventListener('click', () => this.onInsertAfter('\n\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n\n'));
    this.listBtn.addEventListener('click', () => this.onInsertAfter('\n\n- 列表项\n- 列表项\n\n'));
    this.orderedListBtn.addEventListener('click', () => this.onInsertAfter('\n\n1. 列表项\n2. 列表项\n\n'));

    // 记录鼠标抬起时的坐标
    this.app.editor.textarea.addEventListener('mouseup', (e) => {
      this.lastMousePos = { x: e.clientX, y: e.clientY };
    });

    // 核心优化：鼠标左键多选后不自动弹窗，而是通过点击右键呼出菜单
    this.app.editor.textarea.addEventListener('contextmenu', (e) => {
      const textarea = this.app.editor.textarea;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      // 仅在有选中文本且不在阅读模式时，阻止默认系统菜单并弹出定制选区菜单
      if (start !== end && this.app.mode !== 'read') {
        e.preventDefault();
        e.stopPropagation();
        this.showAt(e.clientX, e.clientY);
      } else {
        this.hide();
      }
    });

    // 点击其他空白区域关闭
    document.addEventListener('mousedown', (e) => {
      if (!this.popover.contains(e.target) && e.target !== this.app.editor.textarea) {
        this.hide();
      }
    });
  }

  scheduleShow() {
    // 选区变化时不自动弹出菜单，由右键点击触发
    if (this.showTimer) clearTimeout(this.showTimer);
  }

  showAt(clientX, clientY) {
    const textarea = this.app.editor.textarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end || this.app.mode === 'read') {
      this.hide();
      return;
    }

    this.selectedRange = { start, end };
    this.selectedText = textarea.value.slice(start, end);

    // 智能识别选区是否包含 LaTeX 结构
    const convertedFormula = window.mowinAPI.latex.markdownFormula(this.selectedText);
    if (convertedFormula) {
      this.formulaBtn.style.display = 'flex';
    } else {
      this.formulaBtn.style.display = 'none';
    }

    this.headingSelect.value = '';

    const popoverWidth = 210;
    const popoverHeight = convertedFormula ? 430 : 395;

    let targetX = clientX + 4;
    let targetY = clientY + 4;

    // 边界检测
    if (targetX + popoverWidth > window.innerWidth - 10) {
      targetX = Math.max(10, clientX - popoverWidth - 6);
    }
    if (targetY + popoverHeight > window.innerHeight - 30) {
      targetY = Math.max(30, window.innerHeight - popoverHeight - 30);
    }

    this.popover.style.left = `${Math.max(10, targetX)}px`;
    this.popover.style.top = `${Math.max(30, targetY)}px`;
    this.popover.style.display = 'flex';
  }

  show() {
    this.showAt(this.lastMousePos.x, this.lastMousePos.y);
  }

  hide() {
    if (this.showTimer) clearTimeout(this.showTimer);
    this.popover.style.display = 'none';
    this.selectedRange = { start: 0, end: 0 };
    this.selectedText = '';
  }

  onCut() {
    const text = this.selectedText;
    navigator.clipboard.writeText(text);
    this.app.editor.applyEdit({
      range: [this.selectedRange.start, this.selectedRange.end],
      replacement: '',
      selection: [this.selectedRange.start, this.selectedRange.start]
    });
    this.hide();
    this.app.editor.textarea.focus();
  }

  onCopy() {
    navigator.clipboard.writeText(this.selectedText);
    this.hide();
    this.app.editor.textarea.focus();
  }

  async onPaste() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) return;
      this.app.editor.applyEdit({
        range: [this.selectedRange.start, this.selectedRange.end],
        replacement: clip,
        selection: [this.selectedRange.start + clip.length, this.selectedRange.start + clip.length]
      });
    } catch (e) {}
    this.hide();
    this.app.editor.textarea.focus();
  }

  onConvertFormula() {
    const converted = window.mowinAPI.latex.markdownFormula(this.selectedText);
    if (!converted) return;
    this.app.editor.applyEdit({
      range: [this.selectedRange.start, this.selectedRange.end],
      replacement: converted,
      selection: [this.selectedRange.start, this.selectedRange.start + converted.length]
    });
    this.hide();
    this.app.editor.textarea.focus();
  }

  onBold() {
    const text = this.app.editor.textarea.value;
    const edit = window.mowinAPI.formatting.emphasis(text, this.selectedRange, '**');
    this.app.editor.applyEdit(edit);
    this.hide();
    this.app.editor.textarea.focus();
  }

  onRegular() {
    const text = this.app.editor.textarea.value;
    const edit = window.mowinAPI.formatting.emphasis(text, this.selectedRange, '**', true);
    this.app.editor.applyEdit(edit);
    this.hide();
    this.app.editor.textarea.focus();
  }

  onItalic() {
    const text = this.app.editor.textarea.value;
    const edit = window.mowinAPI.formatting.emphasis(text, this.selectedRange, '*');
    this.app.editor.applyEdit(edit);
    this.hide();
    this.app.editor.textarea.focus();
  }

  onHeadingChange(e) {
    const val = e.target.value;
    if (val === '') return;
    const level = parseInt(val, 10);
    const text = this.app.editor.textarea.value;
    const edit = window.mowinAPI.formatting.heading(text, this.selectedRange, level);
    this.app.editor.applyEdit(edit);
    this.hide();
    this.app.editor.textarea.focus();
  }

  onInsertAfter(snippet) {
    const end = Math.max(this.selectedRange.start, this.selectedRange.end);
    this.app.editor.applyEdit({
      range: [end, end],
      replacement: snippet,
      selection: [end + snippet.length, end + snippet.length]
    });
    this.hide();
    this.app.editor.textarea.focus();
  }

  async onInsertImage() {
    const range = { ...this.selectedRange };
    const altText = this.selectedText || '图片';
    this.hide();
    const filePath = await window.mowinAPI.openImageDialog();
    if (!filePath) return;
    const md = window.mowinAPI.imagePaths.markdown(filePath, this.app.currentFilePath, altText);
    const end = Math.max(range.start, range.end);
    this.app.editor.applyEdit({
      range: [end, end],
      replacement: '\n' + md + '\n',
      selection: [end + md.length + 2, end + md.length + 2]
    });
    this.app.editor.textarea.focus();
  }
}

window.SelectionPopoverController = SelectionPopoverController;
