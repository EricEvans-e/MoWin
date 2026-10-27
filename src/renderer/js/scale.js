/**
 * 墨窗 (MoWin) - 独立显示比例与全局快捷键缩放控制器 (Display Scale Controller)
 * 支持左栏 (编辑区) 与 右栏 (排版预览) 独立无损缩放，
 * 并支持 Ctrl + = / Ctrl + + / Ctrl + - / Ctrl + 0 全局快捷键与 Ctrl + 鼠标滚轮缩放，
 * 智能感知当前聚焦与悬停区域，并提供沉浸式 HUD 比例浮层提示。
 */

class DisplayScaleController {
  constructor(editorSelectEl, previewSelectEl, app) {
    this.editorSelect = editorSelectEl;
    this.previewSelect = previewSelectEl;
    this.app = app;

    this.percents = [50, 60, 70, 80, 90, 100, 125, 150, 200];
    this.editorPercent = parseInt(localStorage.getItem('mowin_editor_scale') || '100', 10);
    this.previewPercent = parseInt(localStorage.getItem('mowin_preview_scale') || '100', 10);

    this.activePane = 'editor';
    this.hoveredPane = null;
    this.lastWheelTime = 0;
    this.toastTimer = null;

    this.initElements();
    this.initToastElement();
    this.initInteractionTracking();
    this.initKeyboardListener();
    this.initWheelListener();
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

  initToastElement() {
    let toast = document.getElementById('scale-hud-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'scale-hud-toast';
      document.body.appendChild(toast);
    }
    this.toastEl = toast;
  }

  initInteractionTracking() {
    // 跟踪鼠标悬停区域与活跃交互区域
    if (this.app.editorContainer) {
      this.app.editorContainer.addEventListener('mouseenter', () => {
        this.hoveredPane = 'editor';
      });
      this.app.editorContainer.addEventListener('click', () => {
        this.activePane = 'editor';
      });
    }

    if (this.app.editor && this.app.editor.textarea) {
      this.app.editor.textarea.addEventListener('focus', () => {
        this.activePane = 'editor';
      });
      this.app.editor.textarea.addEventListener('input', () => {
        this.activePane = 'editor';
      });
    }

    const previewPane = this.app.previewPane || document.getElementById('preview-pane');
    if (previewPane) {
      previewPane.addEventListener('mouseenter', () => {
        this.hoveredPane = 'preview';
      });
      previewPane.addEventListener('click', () => {
        this.activePane = 'preview';
      });
    }

    if (this.app.previewContainer) {
      this.app.previewContainer.addEventListener('mouseenter', () => {
        this.hoveredPane = 'preview';
      });
      this.app.previewContainer.addEventListener('click', () => {
        this.activePane = 'preview';
      });
      this.app.previewContainer.addEventListener('scroll', () => {
        this.activePane = 'preview';
      });
    }
  }

  getActivePane() {
    if (this.app.mode === 'edit') return 'editor';
    if (this.app.mode === 'read') return 'preview';

    // 双栏模式：优先根据鼠标悬停的栏目判断
    if (this.hoveredPane) return this.hoveredPane;

    // 检查是否有聚焦
    if (document.activeElement === this.app.editor.textarea) {
      return 'editor';
    }
    if (this.app.previewContainer && this.app.previewContainer.contains(document.activeElement)) {
      return 'preview';
    }

    return this.activePane || 'editor';
  }

  initKeyboardListener() {
    // 全局捕获阶段侦听 Ctrl 组合键，避免被输入控件拦截
    window.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || e.altKey) return;

      const key = e.key;
      const code = e.code;

      // 1. 放大：Ctrl + = 或 Ctrl + + (带Shift) 或小键盘 NumpadAdd
      const isZoomIn = (
        key === '=' ||
        key === '+' ||
        code === 'Equal' ||
        code === 'NumpadAdd'
      );

      // 2. 缩小：Ctrl + - 或 Ctrl + _ 或小键盘 NumpadSubtract
      const isZoomOut = (
        key === '-' ||
        key === '_' ||
        code === 'Minus' ||
        code === 'NumpadSubtract'
      );

      // 3. 重置缩放：Ctrl + 0 或小键盘 Numpad0
      const isResetZoom = (
        key === '0' ||
        code === 'Digit0' ||
        code === 'Numpad0'
      );

      if (isZoomIn) {
        e.preventDefault();
        e.stopPropagation();
        this.zoomIn();
        return;
      }

      if (isZoomOut) {
        e.preventDefault();
        e.stopPropagation();
        this.zoomOut();
        return;
      }

      if (isResetZoom) {
        e.preventDefault();
        e.stopPropagation();
        this.resetZoom();
        return;
      }
    }, true);
  }

  initWheelListener() {
    // Ctrl + 滚轮缩放支持
    window.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const now = Date.now();
      if (now - this.lastWheelTime < 60) return;
      this.lastWheelTime = now;

      let targetPane = this.getActivePane();
      if (this.app.mode === 'split') {
        const previewPane = this.app.previewPane || document.getElementById('preview-pane');
        if (previewPane && previewPane.contains(e.target)) {
          targetPane = 'preview';
        } else if (this.app.editorContainer && this.app.editorContainer.contains(e.target)) {
          targetPane = 'editor';
        }
      }

      if (e.deltaY < 0) {
        this.zoomIn(targetPane);
      } else if (e.deltaY > 0) {
        this.zoomOut(targetPane);
      }
    }, { passive: false });
  }

  zoomIn(targetPane = null) {
    const pane = targetPane || this.getActivePane();
    if (pane === 'preview') {
      this.stepPreview(1);
    } else {
      this.stepEditor(1);
    }
    this.showScaleToast(pane);
  }

  zoomOut(targetPane = null) {
    const pane = targetPane || this.getActivePane();
    if (pane === 'preview') {
      this.stepPreview(-1);
    } else {
      this.stepEditor(-1);
    }
    this.showScaleToast(pane);
  }

  resetZoom(targetPane = null) {
    const pane = targetPane || this.getActivePane();
    if (pane === 'preview') {
      this.setPreviewScale(100);
    } else if (pane === 'editor') {
      this.setEditorScale(100);
    } else {
      this.setEditorScale(100);
      this.setPreviewScale(100);
    }
    this.showScaleToast(pane, true);
  }

  zoomEditor(delta) {
    this.stepEditor(delta);
    this.showScaleToast('editor');
  }

  zoomPreview(delta) {
    this.stepPreview(delta);
    this.showScaleToast('preview');
  }

  showScaleToast(pane, isReset = false) {
    if (!this.toastEl) return;
    if (this.toastTimer) clearTimeout(this.toastTimer);

    let text = '';
    if (isReset) {
      text = pane === 'preview' ? '右栏预览已恢复 100%' : (pane === 'editor' ? '左栏字号已恢复 100%' : '显示比例已恢复 100%');
    } else if (pane === 'preview') {
      text = `排版预览比例: ${this.previewPercent}%`;
    } else {
      text = `编辑区字号: ${this.editorPercent}%`;
    }

    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');

    // 联动触发对应栏目徽章微动动画
    const badgeSelector = pane === 'preview' ? '#preview-pane .scale-badge' : '#editor-container .scale-badge';
    const badge = document.querySelector(badgeSelector);
    if (badge) {
      badge.classList.remove('pulse');
      void badge.offsetWidth; // 触发 reflow
      badge.classList.add('pulse');
    }

    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('visible');
    }, 900);
  }

  populateSelect(selectEl, currentVal) {
    if (!selectEl) return;
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
    if (this.editorSelect) this.editorSelect.value = p;

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
    if (this.previewSelect) this.previewSelect.value = p;

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
