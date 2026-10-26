/**
 * 墨窗 (MoWin) - 双向同步滚动引擎
 * 精确实现编辑区与排版预览区的双向行号映射同步，彻底消除循环反馈震荡
 */

class ScrollSyncEngine {
  constructor(app) {
    this.app = app;
    this.enabled = true; // 是否启用同步滚动
    this.isSyncingFromEditor = false;
    this.isSyncingFromPreview = false;
    this.editorScrollTimer = null;
    this.previewScrollTimer = null;
  }

  toggle(enable = null) {
    this.enabled = enable !== null ? enable : !this.enabled;
    return this.enabled;
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
      this.app.syncPreviewToLine(linePos);

      // 短暂阻尼，避免对向滚动事件反复触发
      setTimeout(() => {
        this.isSyncingFromEditor = false;
      }, 50);
    });
  }

  /**
   * 预览区发生滚动时触发 (由预览 DOM 消息回调)
   */
  handlePreviewScroll(line) {
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
      this.app.editor.scrollToLine(line);

      setTimeout(() => {
        this.isSyncingFromPreview = false;
      }, 50);
    });
  }
}

module.exports = ScrollSyncEngine;
