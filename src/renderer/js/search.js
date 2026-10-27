/**
 * 墨窗 (MoWin) - 查找与替换控制器
 */

class SearchController {
  constructor(barEl, app) {
    this.bar = barEl;
    this.app = app;
    this.matches = [];
    this.currentIndex = -1;

    this.initElements();
  }

  initElements() {
    this.findInput = this.bar.querySelector('#find-input');
    this.replaceInput = this.bar.querySelector('#replace-input');
    this.replaceRow = this.bar.querySelector('#replace-row');
    this.countEl = this.bar.querySelector('#find-count');
    this.prevBtn = this.bar.querySelector('#btn-find-prev');
    this.nextBtn = this.bar.querySelector('#btn-find-next');
    this.replaceBtn = this.bar.querySelector('#btn-replace');
    this.replaceAllBtn = this.bar.querySelector('#btn-replace-all');
    this.closeBtn = this.bar.querySelector('#btn-find-close');

    this.findInput.addEventListener('input', () => this.performFind());
    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) this.findPrev();
        else this.findNext();
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.replaceCurrent();
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });

    this.prevBtn.addEventListener('click', () => this.findPrev());
    this.nextBtn.addEventListener('click', () => this.findNext());
    this.replaceBtn.addEventListener('click', () => this.replaceCurrent());
    this.replaceAllBtn.addEventListener('click', () => this.replaceAll());
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  show(isReplace = false) {
    if (this.app.mode === 'read') {
      this.app.setMode('split');
    }

    this.bar.style.display = 'flex';
    this.replaceRow.style.display = isReplace ? 'flex' : 'none';

    // 如果选区内已有文字，填入查找框
    const textarea = this.app.editor.textarea;
    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selected && !selected.includes('\n')) {
      this.findInput.value = selected;
    }

    if (isReplace) {
      this.replaceInput.focus();
    } else {
      this.findInput.focus();
      this.findInput.select();
    }

    this.performFind();
  }

  hide() {
    this.bar.style.display = 'none';
    this.app.editor.textarea.focus();
  }

  performFind() {
    const query = this.findInput.value;
    const text = this.app.editor.textarea.value;
    this.matches = [];
    this.currentIndex = -1;

    if (!query) {
      this.countEl.textContent = '0 / 0';
      return;
    }

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      this.matches.push({ start: pos, end: pos + query.length });
      pos += query.length;
    }

    if (this.matches.length > 0) {
      const cursor = this.app.editor.textarea.selectionStart;
      let closest = 0;
      for (let i = 0; i < this.matches.length; i++) {
        if (this.matches[i].start >= cursor) {
          closest = i;
          break;
        }
      }
      this.currentIndex = closest;
      this.highlightMatch();
    } else {
      this.countEl.textContent = '0 / 0';
    }
  }

  highlightMatch() {
    if (this.currentIndex < 0 || this.currentIndex >= this.matches.length) return;
    const m = this.matches[this.currentIndex];
    this.countEl.textContent = `${this.currentIndex + 1} / ${this.matches.length}`;

    const textarea = this.app.editor.textarea;
    textarea.selectionStart = m.start;
    textarea.selectionEnd = m.end;

    // 滚动到该匹配项
    const line = this.app.editor.getLineNumber(m.start);
    this.app.editor.scrollToLine(line);
  }

  findNext() {
    if (!this.matches.length) return;
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    this.highlightMatch();
  }

  findPrev() {
    if (!this.matches.length) return;
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this.highlightMatch();
  }

  replaceCurrent() {
    if (this.currentIndex < 0 || !this.matches.length) return;
    const m = this.matches[this.currentIndex];
    const replacement = this.replaceInput.value;
    this.app.editor.applyEdit({
      range: [m.start, m.end],
      replacement: replacement,
      selection: [m.start, m.start + replacement.length]
    });
    this.performFind();
  }

  replaceAll() {
    const query = this.findInput.value;
    if (!query) return;
    const replacement = this.replaceInput.value;
    const text = this.app.editor.textarea.value;
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const newText = text.replace(regex, replacement);
    if (newText === text) return;

    this.app.editor.history.pushSnapshot(); // 记录替换前快照
    this.app.editor.setValue(newText, [0, 0]);
    this.app.editor.rebuildLineStarts();
    this.app.editor.updateGutter();
    this.app.onTextChanged();
    this.app.editor.history.pushSnapshot(); // 记录替换后快照
    this.performFind();
  }
}

window.SearchController = SearchController;
