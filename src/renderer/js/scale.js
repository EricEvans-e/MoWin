/**
 * 墨窗 (MoWin) - 独立显示比例控制器 (Display Scale)
 * 左栏 (编辑区) 与 右栏 (预览区) 独立无损缩放，只改变屏幕显示字号，不修改源文件
 */

class DisplayScaleController {
  constructor(editorSelectEl, previewSelectEl, app) {
    this.editorSelect = editorSelectEl;
    this.previewSelect = previewSelectEl;
    this.app = app;

    this.percents = [50, 60, 70, 80, 90, 100, 125, 150, 200];
    this.editorPercent = parseInt(localStorage.getItem('mowin_editor_scale') || '100', 10);
    this.previewPercent = parseInt(localStorage.getItem('mowin_preview_scale') || '100', 10);

    this.initElements();
    this.applyAll();
  }

  initElements() {
    this.populateSelect(this.editorSelect, this.editorPercent);
    this.populateSelect(this.previewSelect, this.previewPercent);

    this.editorSelect.addEventListener('change', (e) => {
      this.setEditorScale(parseInt(e.target.value, 10));
    });

    this.previewSelect.addEventListener('change', (e) => {
      this.setPreviewScale(parseInt(e.target.value, 10));
    });
  }

  populateSelect(selectEl, currentVal) {
    selectEl.innerHTML = '';
    for (const p of this.percents) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = `${p}%`;
      if (p === currentVal) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  setEditorScale(percent) {
    const p = this.percents.includes(percent) ? percent : 100;
    this.editorPercent = p;
    localStorage.setItem('mowin_editor_scale', p.toString());
    this.editorSelect.value = p;

    // 缩放编辑区字号 (基准 15px)
    const baseFontSize = 15;
    const currentSize = baseFontSize * (p / 100);
    const textarea = this.app.editor.textarea;
    const gutter = this.app.editor.gutter;

    textarea.style.fontSize = `${currentSize}px`;
    gutter.style.fontSize = `${currentSize}px`;
    gutter.style.lineHeight = '1.85';
    textarea.style.lineHeight = '1.85';

    // 重新校准行号与同步滚动映射
    this.app.editor.updateGutter();
    if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
  }

  setPreviewScale(percent) {
    const p = this.percents.includes(percent) ? percent : 100;
    this.previewPercent = p;
    localStorage.setItem('mowin_preview_scale', p.toString());
    this.previewSelect.value = p;

    // 缩放排版预览视口并重建滚动位置映射
    const viewport = this.app.previewViewport;
    viewport.style.zoom = (p / 100).toString();
    if (window.invalidateSourceBlocks) window.invalidateSourceBlocks();
  }

  stepEditor(delta) {
    const idx = this.percents.indexOf(this.editorPercent);
    const newIdx = Math.max(0, Math.min(this.percents.length - 1, (idx === -1 ? 5 : idx) + delta));
    this.setEditorScale(this.percents[newIdx]);
  }

  stepPreview(delta) {
    const idx = this.percents.indexOf(this.previewPercent);
    const newIdx = Math.max(0, Math.min(this.percents.length - 1, (idx === -1 ? 5 : idx) + delta));
    this.setPreviewScale(this.percents[newIdx]);
  }

  applyAll() {
    this.setEditorScale(this.editorPercent);
    this.setPreviewScale(this.previewPercent);
  }
}

window.DisplayScaleController = DisplayScaleController;
