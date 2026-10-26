/**
 * 墨窗 (MoWin) - 高精度双向连续同步滚动引擎
 * 基于 Markdown AST 的 data-sourcepos 源码行区间与视口物理像素投影，
 * 实现正文编辑区与排版预览区 100% 对应、平滑连续、无抖动的双向滚动同步。
 */

class ScrollSyncEngine {
  constructor(app) {
    this.app = app;
    this.enabled = true; // 是否启用同步滚动
    this.isSyncingFromEditor = false;
    this.isSyncingFromPreview = false;
    this.editorScrollTimer = null;
    this.previewScrollTimer = null;
    this.mowinBlocks = null;

    this.initPreviewScroll();
  }

  toggle(enable = null) {
    this.enabled = enable !== null ? enable : !this.enabled;
    return this.enabled;
  }

  invalidateSourceBlocks() {
    this.mowinBlocks = null;
  }

  rebuildSourceBlocks() {
    const elements = Array.from(this.app.previewViewport.querySelectorAll('[data-sourcepos]'));
    this.mowinBlocks = [];
    if (!elements.length) return;

    const containerRect = this.app.previewContainer.getBoundingClientRect();
    const scrollTop = this.app.previewContainer.scrollTop;

    for (const el of elements) {
      const attr = el.getAttribute('data-sourcepos');
      const m = /^(\d+):\d+-(\d+):\d+/.exec(attr || '');
      if (!m) continue;

      const rect = el.getBoundingClientRect();
      const top = (rect.top - containerRect.top) + scrollTop;
      this.mowinBlocks.push({
        start: parseInt(m[1], 10),
        end: parseInt(m[2], 10),
        top: top,
        bottom: top + rect.height,
        height: rect.height
      });
    }

    // 按纵向像素 top 升序排序
    this.mowinBlocks.sort((a, b) => a.top - b.top);
  }

  sourceBlocks() {
    if (!this.mowinBlocks || !this.mowinBlocks.length) {
      this.rebuildSourceBlocks();
    }
    return this.mowinBlocks || [];
  }

  /**
   * 根据预览区当前滚动像素位置计算对应的源码行 (支持行内与间隙连续插值)
   */
  lineAtPreviewScroll(currentY) {
    const totalLines = (this.app.editor.lineStarts && this.app.editor.lineStarts.length) || 1;
    const maxScroll = Math.max(0, this.app.previewContainer.scrollHeight - this.app.previewContainer.clientHeight);

    if (currentY <= 2) return 1;

    const items = this.sourceBlocks();
    if (!items.length) {
      const ratio = maxScroll > 0 ? currentY / maxScroll : 0;
      return 1 + ratio * Math.max(0, totalLines - 1);
    }

    // 预览区顶部内边距基准 (36px)
    const anchorY = currentY + 36;

    // 1. 检查是否刚好落在某个块内部 (优先选取 span 最紧凑的具体元素，如 li 或 p)
    let bestBlock = null;
    for (const item of items) {
      if (anchorY >= item.top && anchorY <= item.bottom) {
        if (!bestBlock || (item.end - item.start) < (bestBlock.end - bestBlock.start)) {
          bestBlock = item;
        }
      }
    }

    if (bestBlock) {
      const frac = bestBlock.height > 0 ? (anchorY - bestBlock.top) / bestBlock.height : 0;
      const span = Math.max(1, bestBlock.end - bestBlock.start + 1);
      return bestBlock.start + frac * span;
    }

    // 2. 落在块与块之间的空白间隙，在相邻两块之间进行连续线性插值
    const firstBlock = items[0];
    const lastBlock = items[items.length - 1];

    if (anchorY < firstBlock.top) {
      const frac = firstBlock.top > 0 ? Math.max(0, anchorY / firstBlock.top) : 0;
      return 1 + frac * Math.max(0, firstBlock.start - 1);
    }

    if (anchorY > lastBlock.bottom) {
      const remainingDistance = Math.max(1, (maxScroll + this.app.previewContainer.clientHeight) - lastBlock.bottom);
      const frac = Math.max(0, Math.min(1, (anchorY - lastBlock.bottom) / remainingDistance));
      return lastBlock.end + frac * Math.max(0, totalLines - lastBlock.end);
    }

    // 查找前一个块和后一个块
    let prev = null, next = null;
    for (const item of items) {
      if (item.bottom <= anchorY) {
        if (!prev || item.bottom > prev.bottom) prev = item;
      }
      if (item.top >= anchorY) {
        if (!next || item.top < next.top) next = item;
      }
    }

    if (prev && next && next.top > prev.bottom) {
      const gapFrac = (anchorY - prev.bottom) / (next.top - prev.bottom);
      return prev.end + gapFrac * (next.start - prev.end);
    }

    return prev ? prev.end : (next ? next.start : 1);
  }

  /**
   * 将排版预览区精准滚动到对应的源码行
   */
  scrollToPreviewLine(line) {
    const totalLines = (this.app.editor.lineStarts && this.app.editor.lineStarts.length) || 1;
    const maxScroll = Math.max(0, this.app.previewContainer.scrollHeight - this.app.previewContainer.clientHeight);

    if (line <= 1) {
      this.app.previewContainer.scrollTop = 0;
      return;
    }

    if (line >= totalLines) {
      this.app.previewContainer.scrollTop = maxScroll;
      return;
    }

    const items = this.sourceBlocks();
    if (!items.length) {
      const ratio = totalLines > 1 ? (line - 1) / (totalLines - 1) : 0;
      this.app.previewContainer.scrollTop = ratio * maxScroll;
      return;
    }

    const previewPaddingTop = 36;
    const firstBlock = items[0];
    const lastBlock = items[items.length - 1];

    let targetY = 0;

    // 1. 行号在第一块之前
    if (line < firstBlock.start) {
      const frac = (line - 1) / Math.max(1, firstBlock.start - 1);
      targetY = frac * Math.max(0, firstBlock.top - previewPaddingTop);
      this.app.previewContainer.scrollTop = Math.max(0, Math.min(maxScroll, targetY));
      return;
    }

    // 2. 行号在最后一块之后
    if (line > lastBlock.end) {
      const frac = (line - lastBlock.end) / Math.max(1, totalLines - lastBlock.end);
      const startY = Math.max(0, lastBlock.bottom - previewPaddingTop);
      targetY = startY + frac * (maxScroll - startY);
      this.app.previewContainer.scrollTop = Math.max(0, Math.min(maxScroll, targetY));
      return;
    }

    // 3. 检查行号是否落在具体块中
    let bestBlock = null;
    for (const item of items) {
      if (line >= item.start && line <= item.end) {
        if (!bestBlock || (item.end - item.start) < (bestBlock.end - bestBlock.start)) {
          bestBlock = item;
        }
      }
    }

    if (bestBlock) {
      const span = Math.max(1, bestBlock.end - bestBlock.start + 1);
      const frac = Math.max(0, Math.min(1, (line - bestBlock.start) / span));
      targetY = (bestBlock.top - previewPaddingTop) + frac * bestBlock.height;
      this.app.previewContainer.scrollTop = Math.max(0, Math.min(maxScroll, targetY));
      return;
    }

    // 4. 行号落在两块之间的空白行 (例如标题与段落间或代码块周围的空行)
    let prev = null, next = null;
    for (const item of items) {
      if (item.end < line) {
        if (!prev || item.end > prev.end) prev = item;
      }
      if (item.start > line) {
        if (!next || item.start < next.start) next = item;
      }
    }

    if (prev && next && next.start > prev.end) {
      const lineFrac = (line - prev.end) / (next.start - prev.end);
      const startY = Math.max(0, prev.bottom - previewPaddingTop);
      const endY = Math.max(0, next.top - previewPaddingTop);
      targetY = startY + lineFrac * (endY - startY);
      this.app.previewContainer.scrollTop = Math.max(0, Math.min(maxScroll, targetY));
      return;
    }

    targetY = prev ? (prev.bottom - previewPaddingTop) : 0;
    this.app.previewContainer.scrollTop = Math.max(0, Math.min(maxScroll, targetY));
  }

  /**
   * 编辑区发生滚动时触发 (同步到预览区)
   */
  handleEditorScroll() {
    if (!this.enabled || this.isSyncingFromPreview || this.app.mode !== 'split') {
      return;
    }

    if (this.editorScrollTimer !== null) {
      cancelAnimationFrame(this.editorScrollTimer);
    }

    this.editorScrollTimer = requestAnimationFrame(() => {
      this.editorScrollTimer = null;
      if (this.isSyncingFromPreview) return;

      this.isSyncingFromEditor = true;
      const linePos = this.app.editor.sourcePosition();
      this.scrollToPreviewLine(linePos);

      // 短暂阻尼防震荡
      setTimeout(() => {
        this.isSyncingFromEditor = false;
      }, 50);
    });
  }

  /**
   * 监听预览区原生滚动事件 (同步到编辑区)
   */
  initPreviewScroll() {
    this.app.previewContainer.addEventListener('scroll', () => {
      if (!this.enabled || this.isSyncingFromEditor || this.app.mode !== 'split') {
        return;
      }

      if (this.previewScrollTimer !== null) {
        cancelAnimationFrame(this.previewScrollTimer);
      }

      this.previewScrollTimer = requestAnimationFrame(() => {
        this.previewScrollTimer = null;
        if (this.isSyncingFromEditor) return;

        this.isSyncingFromPreview = true;
        const currentY = this.app.previewContainer.scrollTop;
        const line = this.lineAtPreviewScroll(currentY);
        this.app.editor.scrollToLine(line);

        setTimeout(() => {
          this.isSyncingFromPreview = false;
        }, 50);
      });
    }, { passive: true });
  }
}

window.ScrollSyncEngine = ScrollSyncEngine;
