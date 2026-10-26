/**
 * 墨窗 (MoWin) - 编辑器核心控制器
 * 包含行号同步、智能列表续写、制表符缩进、撤销/重做支持、拖拽插入图片及滚动行号计算
 */

class EditorController {
  constructor(textareaEl, gutterEl, app) {
    this.textarea = textareaEl;
    this.gutter = gutterEl;
    this.app = app;
    this.lineStarts = [0];
    this.isComposing = false;

    this.initEvents();
  }

  initEvents() {
    const formatting = window.mowinAPI.formatting;
    const imagePaths = window.mowinAPI.imagePaths;

    // 监听输入
    this.textarea.addEventListener('input', () => {
      this.rebuildLineStarts();
      this.updateGutter();
      this.app.onTextChanged();
    });

    // 监听滚动，驱动行号指示栏同步滚动并通知双栏滚动引擎
    this.textarea.addEventListener('scroll', () => {
      this.gutter.scrollTop = this.textarea.scrollTop;
      this.app.onEditorScrolled();
    }, { passive: true });

    // 中文输入法合成状态
    this.textarea.addEventListener('compositionstart', () => { this.isComposing = true; });
    this.textarea.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.rebuildLineStarts();
      this.updateGutter();
      this.app.onTextChanged();
    });

    // 智能按键拦截处理
    this.textarea.addEventListener('keydown', (e) => {
      if (this.isComposing) return;

      // 1. 回车智能续写列表 / 退出列表
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        const text = this.textarea.value;
        const selStart = this.textarea.selectionStart;
        const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
        const currentLine = text.slice(lineStart, selStart);

        const smart = formatting.smartNewline(currentLine, currentLine.length);
        if (smart.handled) {
          e.preventDefault();
          if (smart.exitList) {
            // 退出空列表项：删除当前行的列表符号并换行
            const beforeLine = text.slice(0, lineStart);
            const afterCursor = text.slice(selStart);
            const newText = beforeLine + '\n' + afterCursor;
            this.setValue(newText, [lineStart + 1, lineStart + 1]);
          } else {
            // 续写下一项
            this.insertAtCursor(smart.insertion);
          }
          this.rebuildLineStarts();
          this.updateGutter();
          this.app.onTextChanged();
        }
      }

      // 2. Tab 缩进 (2 个空格)
      else if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          // 反向缩进
          this.unindentSelectedLines();
        } else {
          this.insertAtCursor('  ');
        }
        this.app.onTextChanged();
      }
    });

    // 选区变化触发浮动快捷菜单
    const onSelectChange = () => {
      if (this.isComposing) return;
      this.app.onSelectionChanged();
    };
    this.textarea.addEventListener('mouseup', onSelectChange);
    this.textarea.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        onSelectChange();
      }
    });

    // 拖拽文件进入编辑区直接插入图片
    this.textarea.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    this.textarea.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      const imgFiles = files.filter(f => imagePaths.isImage(f.path));
      if (!imgFiles.length) return;

      const docPath = this.app.currentFilePath;
      const mdImages = imgFiles.map(f => imagePaths.markdown(f.path, docPath)).join('\n');
      this.insertAtCursor('\n' + mdImages + '\n');
      this.app.onTextChanged();
    });
  }

  insertAtCursor(text) {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const val = this.textarea.value;
    this.textarea.value = val.slice(0, start) + text + val.slice(end);
    const newPos = start + text.length;
    this.textarea.selectionStart = newPos;
    this.textarea.selectionEnd = newPos;
  }

  setValue(text, selection = null) {
    this.textarea.value = text;
    if (selection) {
      this.textarea.selectionStart = selection[0];
      this.textarea.selectionEnd = selection[1];
    }
  }

  applyEdit(edit) {
    const text = this.textarea.value;
    const newText = text.slice(0, edit.range[0]) + edit.replacement + text.slice(edit.range[1]);
    this.setValue(newText, edit.selection);
    this.rebuildLineStarts();
    this.updateGutter();
    this.app.onTextChanged();
  }

  unindentSelectedLines() {
    const text = this.textarea.value;
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    let lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const block = text.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const newLines = lines.map(line => {
      if (line.startsWith('  ')) return line.slice(2);
      if (line.startsWith(' ')) return line.slice(1);
      if (line.startsWith('\t')) return line.slice(1);
      return line;
    });

    const replacement = newLines.join('\n');
    this.setValue(text.slice(0, lineStart) + replacement + text.slice(lineEnd), [lineStart, lineStart + replacement.length]);
  }

  rebuildLineStarts() {
    const text = this.textarea.value;
    const starts = [0];
    let pos = 0;
    while ((pos = text.indexOf('\n', pos)) !== -1) {
      pos++;
      starts.push(pos);
    }
    this.lineStarts = starts;
  }

  updateGutter() {
    const count = this.lineStarts.length;
    let gutterText = '';
    for (let i = 1; i <= count; i++) {
      gutterText += i + '\n';
    }
    this.gutter.textContent = gutterText;
  }

  getLineNumber(charIndex) {
    if (this.lineStarts.length <= 1) return 1;
    let low = 0, high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.lineStarts[mid] <= charIndex) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }

  getCurrentLineAndCol() {
    const selStart = this.textarea.selectionStart || 0;
    const line = this.getLineNumber(selStart);
    const lineStart = this.lineStarts[line - 1] || 0;
    const col = selStart - lineStart + 1;
    return { line, col };
  }

  /**
   * 计算编辑区首行对应的源码行位置 (含行内小数偏移，用于双向滚动同步)
   */
  sourcePosition() {
    const totalLines = this.lineStarts.length;
    if (totalLines <= 1) return 1;
    const scrollTop = this.textarea.scrollTop;
    const scrollHeight = this.textarea.scrollHeight - this.textarea.clientHeight;
    if (scrollHeight <= 0) return 1;

    // 单行平均高度估算
    const lineHeight = this.textarea.scrollHeight / totalLines;
    const exactLine = (scrollTop / lineHeight) + 1;
    return Math.max(1, Math.min(totalLines, exactLine));
  }

  /**
   * 滚动编辑区到指定行
   */
  scrollToLine(line) {
    const totalLines = this.lineStarts.length;
    if (totalLines <= 1) {
      this.textarea.scrollTop = 0;
      return;
    }
    const lineHeight = this.textarea.scrollHeight / totalLines;
    const targetY = (line - 1) * lineHeight;
    this.textarea.scrollTop = Math.max(0, targetY);
  }
}

window.EditorController = EditorController;
