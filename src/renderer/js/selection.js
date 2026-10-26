/**
 * 墨窗 (MoWin) - 选区快捷操作浮动菜单 (Selection Popover)
 * 选中文本后自动弹出：支持智能识别 LaTeX 并动态展示“转换公式”，
 * 提供加粗、常规字重、斜体、标题等级切换、代码块、本地图片、链接、表格、列表等全套操作
 */

const LaTeX = require('../../common/latex');
const Formatting = require('../../common/formatting');

class SelectionPopoverController {
  constructor(popoverEl, app) {
    this.popover = popoverEl;
    this.app = app;
    this.selectedRange = { start: 0, end: 0 };
    this.selectedText = '';
    this.showTimer = null;

    this.initElements();
  }

  initElements() {
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

    // 绑定点击事件
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

    // 点击其他空白区域关闭
    document.addEventListener('mousedown', (e) => {
      if (!this.popover.contains(e.target) && e.target !== this.app.editor.textarea) {
        this.hide();
      }
    });
  }

  scheduleShow() {
    if (this.showTimer) clearTimeout(this.showTimer);
    const textarea = this.app.editor.textarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 仅在有有效选区且非阅读模式下显示
    if (start === end || this.app.mode === 'read') {
      this.hide();
      return;
    }

    this.showTimer = setTimeout(() => {
      this.show();
    }, 200);
  }

  show() {
    const textarea = this.app.editor.textarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end || this.app.mode === 'read') {
      this.hide();
      return;
    }

    this.selectedRange = { start, end };
    this.selectedText = textarea.value.slice(start, end);

    // 智能识别选区是否包含 LaTeX 命令
    const convertedFormula = LaTeX.markdownFormula(this.selectedText);
    if (convertedFormula) {
      this.formulaBtn.style.display = 'flex';
    } else {
      this.formulaBtn.style.display = 'none';
    }

    this.headingSelect.value = '';

    // 计算定位位置 (跟随光标或视口中央)
    const rect = textarea.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 220, Math.max(20, rect.left + 80));
    const y = Math.min(window.innerHeight - 380, Math.max(60, rect.top + 60));

    this.popover.style.left = `${x}px`;
    this.popover.style.top = `${y}px`;
    this.popover.style.display = 'flex';
  }

  hide() {
    if (this.showTimer) clearTimeout(this.showTimer);
    this.popover.style.display = 'none';
  }

  onConvertFormula() {
    const converted = LaTeX.markdownFormula(this.selectedText);
    if (!converted) return;
    this.app.editor.applyEdit({
      range: [this.selectedRange.start, this.selectedRange.end],
      replacement: converted,
      selection: [this.selectedRange.start, this.selectedRange.start + converted.length]
    });
    this.hide();
  }

  onBold() {
    const text = this.app.editor.textarea.value;
    const edit = Formatting.emphasis(text, this.selectedRange, '**');
    this.app.editor.applyEdit(edit);
    this.hide();
  }

  onRegular() {
    const text = this.app.editor.textarea.value;
    const edit = Formatting.emphasis(text, this.selectedRange, '**', true);
    this.app.editor.applyEdit(edit);
    this.hide();
  }

  onItalic() {
    const text = this.app.editor.textarea.value;
    const edit = Formatting.emphasis(text, this.selectedRange, '*');
    this.app.editor.applyEdit(edit);
    this.hide();
  }

  onHeadingChange(e) {
    const val = e.target.value;
    if (val === '') return;
    const level = parseInt(val, 10);
    const text = this.app.editor.textarea.value;
    const edit = Formatting.heading(text, this.selectedRange, level);
    this.app.editor.applyEdit(edit);
    this.hide();
  }

  onInsertAfter(snippet) {
    const end = Math.max(this.selectedRange.start, this.selectedRange.end);
    const text = this.app.editor.textarea.value;
    const newText = text.slice(0, end) + snippet + text.slice(end);
    this.app.editor.setValue(newText, [end + snippet.length, end + snippet.length]);
    this.app.editor.rebuildLineStarts();
    this.app.editor.updateGutter();
    this.app.onTextChanged();
    this.hide();
  }

  async onInsertImage() {
    this.hide();
    const filePath = await window.mowinAPI.openFileDialog();
    if (!filePath) return;
    const altText = this.selectedText || '图片';
    const ImagePaths = require('../../common/image-paths');
    const md = ImagePaths.markdown(filePath, this.app.currentFilePath, altText);
    this.onInsertAfter('\n' + md + '\n');
  }
}

module.exports = SelectionPopoverController;
