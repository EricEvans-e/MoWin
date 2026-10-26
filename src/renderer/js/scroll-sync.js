/**
 * 墨窗 (MoWin) - 高精度双向同步滚动引擎
 * 基于 Markdown AST 的 data-sourcepos 源码行范围注入，
 * 实现编辑区与排版预览区的双向行号映射同步，首行像素级对准，
 * 配备阻尼防抖算法彻底消除循环震荡。
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
        bottom: top + rect.height
      });
    }
  }

  sourceBlocks() {
    if (!this.mowinBlocks) {
      this.rebuildSourceBlocks();
    }
    return this.mowinBlocks || [];
  }

  blockSpan(item) {
    return item.end === item.start ? 1 : (item.end - item.start);
  }

  /**
   * 根据预览区当前垂直滚动位置 y 计算对应的源码行号 (支持行内小数插值)
   */
  lineAtPreviewScroll(y) {
    const items = this.sourceBlocks();
    if (!items.length) return 1;

    let chosen = null;
    for (const item of items) {
      if (y < item.top || y > item.bottom) continue;
      const span = item.end - item.start;
      if (!chosen || span < (chosen.end - chosen.start) || (span === (chosen.end - chosen.start) && item.start >= chosen.start)) {
        chosen = item;
      }
    }

    if (!chosen) {
      let prev = null, next = null;
      for (const item of items) {
        if (item.bottom <= y && (!prev || item.bottom > prev.bottom)) prev = item;
        if (item.top >= y && (!next || item.top < next.top)) next = item;
      }
      if (prev && next && next.top > prev.bottom) {
        const frac = (y - prev.bottom) / (next.top - prev.bottom);
        const prevPos = prev.start + this.blockSpan(prev);
        return prevPos + frac * (next.start - prevPos);
      }
      if (next) return next.start;
      return prev ? prev.start + this.blockSpan(prev) : 1;
    }

    if (chosen.bottom <= chosen.top) return chosen.start;
    const frac = Math.min(1, Math.max(0, (y - chosen.top) / (chosen.bottom - chosen.top)));
    return chosen.start + frac * this.blockSpan(chosen);
  }

  /**
   * 将预览区平滑滚动到源码行
   */
  scrollToPreviewLine(line) {
    const items = this.sourceBlocks();
    let y = 0;
    if (line > 1 && items.length) {
      let chosen = null;
      for (const item of items) {
        const limit = item.start + this.blockSpan(item);
        if (line < item.start || line > limit) continue;
        const span = item.end - item.start;
        if (!chosen || span < (chosen.end - chosen.start)) chosen = item;
      }
      if (!chosen) {
        for (const item of items) {
          if (item.start <= line && (!chosen || item.start > chosen.start)) chosen = item;
        }
        y = chosen ? chosen.top : 0;
      } else if (chosen.bottom <= chosen.top) {
        y = chosen.top;
      } else {
        const frac = Math.min(1, Math.max(0, (line - chosen.start) / this.blockSpan(chosen)));
        y = chosen.top + frac * (chosen.bottom - chosen.top);
      }
    }

    const maxScroll = Math.max(0, this.app.previewContainer.scrollHeight - this.app.previewContainer.clientHeight);
    const targetY = Math.max(0, Math.min(maxScroll, y));
    this.app.previewContainer.scrollTop = targetY;
  }

  /**
   * 编辑区发生滚动时触发
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

      // 短暂阻尼，避免对向滚动事件反复触发
      setTimeout(() => {
        this.isSyncingFromEditor = false;
      }, 60);
    });
  }

  /**
   * 监听预览区原生滚动事件并同步到编辑区
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
        }, 60);
      });
    }, { passive: true });
  }
}

window.ScrollSyncEngine = ScrollSyncEngine;
