/**
 * 墨窗 (MoWin) - 编辑器核心控制器与历史撤销重做管理器
 * 包含：
 * 1. 完整的历史快照栈 (HistoryManager)：支持原生快捷键 Ctrl+Z (撤销) 与 Ctrl+Y / Ctrl+Shift+Z (重做)，
 *    对打字自动分词聚合，格式化按钮、智能列表回车、Tab 缩进与搜索替换等操作实现 100% 精准撤销与光标复原。
 * 2. 真实折行测量镜像引擎 (Measurement Mirror)：精准测量每一行（含因屏幕宽度折叠为多行的长段落）的实际像素高度与起始偏移，
 *    使行号栏与正文首行像素级逐行对齐，彻底杜绝折行导致行号与正文错位。
 * 3. 像素级源码行映射算法：根据视口实际滚动位置二分定位当前正文行与行内小数偏移，实现与预览区的双向精准匹配。
 */

class HistoryManager {
  constructor(editor) {
    this.editor = editor;
    this.undoStack = [];
    this.redoStack = [];
    this.maxStackSize = 250;
    this.typingTimer = null;
    this.isApplying = false;
  }

  getSnapshot() {
    return {
      text: this.editor.textarea.value,
      start: this.editor.textarea.selectionStart || 0,
      end: this.editor.textarea.selectionEnd || 0,
      time: Date.now()
    };
  }

  init(initialText) {
    this.undoStack = [];
    this.redoStack = [];
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    this.undoStack.push({
      text: initialText || '',
      start: 0,
      end: 0,
      time: Date.now()
    });
  }

  pushSnapshot(snap = null) {
    if (this.isApplying) return;
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    const current = snap || this.getSnapshot();
    if (this.undoStack.length > 0) {
      const top = this.undoStack[this.undoStack.length - 1];
      if (top.text === current.text) return; // 内容无变动时不重复压栈
    }
    this.undoStack.push(current);
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
    this.redoStack = []; // 产生新编辑时清空重做栈
  }

  recordTyping() {
    if (this.isApplying) return;
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
    }
    // 打字停顿 450ms 时将当前词组作为一个独立撤销节点归档
    this.typingTimer = setTimeout(() => {
      this.pushSnapshot();
    }, 450);
  }

  undo() {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (this.undoStack.length === 0) return false;

    const current = this.getSnapshot();
    let prev = this.undoStack.pop();

    // 若栈顶状态与当前完全一致，再向前追溯一个状态
    if (prev && prev.text === current.text && this.undoStack.length > 0) {
      this.redoStack.push(current);
      prev = this.undoStack.pop();
    } else {
      this.redoStack.push(current);
    }

    if (!prev) return false;
    this.apply(prev);
    return true;
  }

  redo() {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (this.redoStack.length === 0) return false;

    const current = this.getSnapshot();
    this.undoStack.push(current);

    const next = this.redoStack.pop();
    if (!next) return false;
    this.apply(next);
    return true;
  }

  apply(snap) {
    this.isApplying = true;
    try {
      this.editor.setValue(snap.text, [snap.start, snap.end]);
      this.editor.rebuildLineStarts();
      this.editor.updateGutter();
      this.editor.app.onTextChanged();
    } finally {
      this.isApplying = false;
    }
  }
}

class EditorController {
  constructor(textareaEl, gutterEl, app) {
    this.textarea = textareaEl;
    this.gutter = gutterEl;
    this.app = app;
    this.lineStarts = [0];
    this.lineMeasurements = [];
    this.isComposing = false;
    this.gutterUpdateTimer = null;

    this.history = new HistoryManager(this);
    this.initMirror();
    this.initEvents();
  }

  initMirror() {
    this.mirror = document.createElement('div');
    this.mirror.id = 'editor-measurement-mirror';
    this.mirror.style.cssText = `
      visibility: hidden !important;
      position: absolute !important;
      top: -99999px !important;
      left: -99999px !important;
      pointer-events: none !important;
      z-index: -9999 !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      border: none !important;
      margin: 0 !important;
    `;
    document.body.appendChild(this.mirror);

    // 监听窗口与分栏变化，自适应重测折行高度
    const resizeObserver = new ResizeObserver(() => {
      if (this.app.mode !== 'read') {
        this.updateGutter();
      }
    });
    resizeObserver.observe(this.textarea);
  }

  syncMirrorStyles() {
    const cs = window.getComputedStyle(this.textarea);
    this.mirror.style.boxSizing = cs.boxSizing;
    const clientW = this.textarea.clientWidth;
    if (clientW > 50) {
      this.mirror.style.width = `${clientW}px`;
    } else if (this.textarea.parentElement) {
      const parentW = this.textarea.parentElement.clientWidth;
      if (parentW > 100) this.mirror.style.width = `${parentW - 60}px`;
    }

    this.mirror.style.fontFamily = cs.fontFamily;
    this.mirror.style.fontSize = cs.fontSize;
    this.mirror.style.lineHeight = cs.lineHeight;
    this.mirror.style.letterSpacing = cs.letterSpacing;
    this.mirror.style.tabSize = cs.tabSize;
    this.mirror.style.paddingLeft = cs.paddingLeft;
    this.mirror.style.paddingRight = cs.paddingRight;
    this.mirror.style.paddingTop = cs.paddingTop;
    this.mirror.style.paddingBottom = cs.paddingBottom;
  }

  initEvents() {
    const formatting = window.mowinAPI.formatting;
    const imagePaths = window.mowinAPI.imagePaths;

    // 监听用户键盘输入
    this.textarea.addEventListener('input', () => {
      this.rebuildLineStarts();
      this.scheduleUpdateGutter();
      this.history.recordTyping();
      this.app.onTextChanged();
    });

    // 监听编辑区滚动，驱动行号指示栏同步滚动并通知双栏滚动引擎
    this.textarea.addEventListener('scroll', () => {
      this.gutter.scrollTop = this.textarea.scrollTop;
      this.app.onEditorScrolled();
    }, { passive: true });

    // 中文输入法合成状态
    this.textarea.addEventListener('compositionstart', () => { this.isComposing = true; });
    this.textarea.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.rebuildLineStarts();
      this.scheduleUpdateGutter();
      this.history.recordTyping();
      this.app.onTextChanged();
    });

    // 智能按键拦截处理：Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, 回车智能续写, Tab 缩进
    this.textarea.addEventListener('keydown', (e) => {
      if (this.isComposing) return;

      // 1. 撤销 / 重做快捷键处理 (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
      if (e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          this.redo();
          return;
        }
      }

      // 2. 回车智能续写列表 / 退出列表
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        const text = this.textarea.value;
        const selStart = this.textarea.selectionStart;
        const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
        const currentLine = text.slice(lineStart, selStart);

        const smart = formatting.smartNewline(currentLine, currentLine.length);
        if (smart.handled) {
          e.preventDefault();
          this.history.pushSnapshot(); // 记录回车前快照

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
          this.history.pushSnapshot(); // 记录回车后快照
          return;
        }
      }

      // 3. Tab 缩进 (2 个空格 / 多行选区整行缩进)
      else if (e.key === 'Tab') {
        e.preventDefault();
        this.history.pushSnapshot(); // 记录缩进前快照
        const selStart = this.textarea.selectionStart;
        const selEnd = this.textarea.selectionEnd;
        if (e.shiftKey) {
          this.unindentSelectedLines();
        } else if (selStart !== selEnd) {
          this.indentSelectedLines();
        } else {
          this.insertAtCursor('  ');
        }
        this.rebuildLineStarts();
        this.updateGutter();
        this.app.onTextChanged();
        this.history.pushSnapshot(); // 记录缩进后快照
        return;
      }
    });

    // 选区变化触发浮动快捷菜单
    const onSelectChange = () => {
      if (this.isComposing) return;
      this.app.onSelectionChanged();
    };
    this.textarea.addEventListener('mouseup', onSelectChange);
    this.textarea.addEventListener('select', onSelectChange);
    this.textarea.addEventListener('keyup', (e) => {
      onSelectChange();
    });

    // 拖拽文件进入编辑区直接插入图片
    this.textarea.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    this.textarea.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      const filePaths = files.map(f => {
        return (window.mowinAPI.getPathForFile ? window.mowinAPI.getPathForFile(f) : f.path) || '';
      }).filter(Boolean);
      const imgPaths = filePaths.filter(p => imagePaths.isImage(p));
      if (!imgPaths.length) return;

      const docPath = this.app.currentFilePath;
      const mdImages = imgPaths.map(p => imagePaths.markdown(p, docPath)).join('\n');
      this.insertAtCursor('\n' + mdImages + '\n');
    });
  }

  undo() {
    return this.history.undo();
  }

  redo() {
    return this.history.redo();
  }

  insertAtCursor(text) {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    this.applyEdit({
      range: [start, end],
      replacement: text,
      selection: [start + text.length, start + text.length]
    });
  }

  setValue(text, selection = null) {
    this.textarea.value = text;
    if (selection) {
      this.textarea.selectionStart = selection[0];
      this.textarea.selectionEnd = selection[1];
    }
  }

  applyEdit(edit) {
    this.history.pushSnapshot(); // 记录格式修改前快照
    const text = this.textarea.value;
    const newText = text.slice(0, edit.range[0]) + edit.replacement + text.slice(edit.range[1]);
    this.setValue(newText, edit.selection);
    this.rebuildLineStarts();
    this.updateGutter();
    this.app.onTextChanged();
    this.history.pushSnapshot(); // 记录格式修改后快照
  }

  getCoordinatesAtOffset(offset) {
    if (!this.mirror) return null;
    this.syncMirrorStyles();
    const text = this.textarea.value;
    const clampedOffset = Math.max(0, Math.min(offset, text.length));
    const before = text.slice(0, clampedOffset);

    const measurer = document.createElement('div');
    measurer.style.cssText = this.mirror.style.cssText;
    measurer.style.height = 'auto';
    measurer.textContent = before;
    const span = document.createElement('span');
    span.textContent = '\u200b';
    measurer.appendChild(span);
    document.body.appendChild(measurer);

    const textareaRect = this.textarea.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const measurerRect = measurer.getBoundingClientRect();

    const relX = spanRect.left - measurerRect.left;
    const relY = spanRect.top - measurerRect.top;

    document.body.removeChild(measurer);

    return {
      x: textareaRect.left + relX - this.textarea.scrollLeft,
      y: textareaRect.top + relY - this.textarea.scrollTop
    };
  }

  indentSelectedLines() {
    const text = this.textarea.value;
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    let lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const block = text.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const newLines = lines.map(line => '  ' + line);

    const replacement = newLines.join('\n');
    this.setValue(text.slice(0, lineStart) + replacement + text.slice(lineEnd), [lineStart, lineStart + replacement.length]);
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

  scheduleUpdateGutter() {
    if (this.gutterUpdateTimer) clearTimeout(this.gutterUpdateTimer);
    this.gutterUpdateTimer = setTimeout(() => {
      this.updateGutter();
    }, 60);
  }

  /**
   * 核心行号与长段落折行测量引擎
   * 通过不可见镜像元素测量每一行的物理像素高度和准确 Y 坐标，
   * 并在行号指示栏中生成完美对齐的行号结构
   */
  updateGutter() {
    if (!this.mirror) return;
    this.syncMirrorStyles();

    const text = this.textarea.value;
    const lines = text.split('\n');
    const count = lines.length;

    let mirrorHtml = '';
    for (let i = 0; i < count; i++) {
      const lineStr = lines[i];
      const safeText = lineStr
        ? lineStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        : '&nbsp;';
      mirrorHtml += `<div class="m-line">${safeText}</div>`;
    }
    this.mirror.innerHTML = mirrorHtml;

    const children = this.mirror.children;
    const measurements = [];
    let gutterHtml = '';
    const cs = window.getComputedStyle(this.textarea);
    const baseLineHeight = parseFloat(cs.lineHeight) || 27.75;
    const paddingTop = parseFloat(cs.paddingTop) || 30;
    const clientW = this.textarea.clientWidth || 600;
    const fontSize = parseFloat(cs.fontSize) || 15;
    // 估算必定不会折行的单行最大字符数阈值 (中文字符宽约 1em，英文字符宽约 0.6em)
    const safeSingleLineLength = Math.max(10, Math.floor((clientW - 50) / fontSize));

    let runningTop = paddingTop;
    for (let i = 0; i < count; i++) {
      const lineStr = lines[i] || '';
      let h = baseLineHeight;
      // 仅对可能折行的长段落读取真实高度，避免对几千行频繁触发布局重排 (Reflow)
      if (lineStr.length > safeSingleLineLength) {
        const el = children[i];
        if (el) h = el.offsetHeight || baseLineHeight;
      }
      measurements.push({
        line: i + 1,
        top: runningTop,
        height: h
      });
      gutterHtml += `<div class="gutter-num" style="height:${h}px;line-height:${baseLineHeight}px;">${i + 1}</div>`;
      runningTop += h;
    }

    this.lineMeasurements = measurements;
    this.gutter.innerHTML = gutterHtml;
    this.gutter.scrollTop = this.textarea.scrollTop;
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
   * 基于真实折行测量的高精度首行源码行计算 (含小数偏移)
   */
  sourcePosition() {
    if (!this.lineMeasurements || !this.lineMeasurements.length) return 1;
    const totalLines = this.lineMeasurements.length;
    if (totalLines <= 1) return 1;

    const cs = window.getComputedStyle(this.textarea);
    const paddingTop = parseFloat(cs.paddingTop) || 30;
    const scrollTop = this.textarea.scrollTop;
    const maxScroll = Math.max(0, this.textarea.scrollHeight - this.textarea.clientHeight);

    // 顶部边缘快速对齐
    if (scrollTop <= 2) return 1;

    const currentY = scrollTop + paddingTop;

    // 二分查找当前视口顶部对应的行
    let low = 0, high = totalLines - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const item = this.lineMeasurements[mid];
      if (currentY < item.top) {
        high = mid - 1;
      } else if (currentY >= item.top + item.height) {
        low = mid + 1;
      } else {
        const frac = item.height > 0 ? (currentY - item.top) / item.height : 0;
        return item.line + Math.max(0, Math.min(0.99, frac));
      }
    }

    if (high < 0) return 1;
    return totalLines;
  }

  /**
   * 滚动编辑区到指定行 (像素级精准定位，支持小数平滑滚动)
   */
  scrollToLine(line) {
    if (!this.lineMeasurements || !this.lineMeasurements.length) return;
    const total = this.lineMeasurements.length;
    const clampedLine = Math.max(1, Math.min(total, line));
    const targetItem = this.lineMeasurements[Math.floor(clampedLine) - 1];
    if (!targetItem) return;

    const cs = window.getComputedStyle(this.textarea);
    const paddingTop = parseFloat(cs.paddingTop) || 30;
    const frac = clampedLine - Math.floor(clampedLine);
    const targetY = (targetItem.top - paddingTop) + (frac * targetItem.height);

    const maxScroll = Math.max(0, this.textarea.scrollHeight - this.textarea.clientHeight);
    this.textarea.scrollTop = Math.max(0, Math.min(maxScroll, targetY));
  }
}

window.EditorController = EditorController;
