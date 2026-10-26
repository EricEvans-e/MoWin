/**
 * 墨窗 (MoWin) - 侧栏控制器 (大纲树、文件目录与导出面板)
 */

class SidebarController {
  constructor(sidebarEl, app) {
    this.sidebar = sidebarEl;
    this.app = app;
    this.currentTab = 'outline'; // 'outline' | 'files'
    this.currentFolder = null;
    this.filesList = [];

    this.initElements();
  }

  initElements() {
    this.tabOutlineBtn = this.sidebar.querySelector('#sidebar-tab-outline');
    this.tabFilesBtn = this.sidebar.querySelector('#sidebar-tab-files');
    this.sectionTitle = this.sidebar.querySelector('#sidebar-section-title');
    this.contentEl = this.sidebar.querySelector('#sidebar-content');

    this.chooseFolderBtn = this.sidebar.querySelector('#btn-choose-folder');
    this.marginSelect = this.sidebar.querySelector('#select-pdf-margin');
    this.exportPdfBtn = this.sidebar.querySelector('#btn-export-pdf');
    this.exportHtmlBtn = this.sidebar.querySelector('#btn-export-html');

    this.tabOutlineBtn.addEventListener('click', () => this.switchTab('outline'));
    this.tabFilesBtn.addEventListener('click', () => this.switchTab('files'));

    this.chooseFolderBtn.addEventListener('click', () => this.chooseFolder());
    this.exportPdfBtn.addEventListener('click', () => this.app.exportPDF());
    this.exportHtmlBtn.addEventListener('click', () => this.app.exportHTML());
  }

  toggle() {
    this.sidebar.classList.toggle('hidden');
  }

  switchTab(tab) {
    this.currentTab = tab;
    if (tab === 'outline') {
      this.tabOutlineBtn.classList.add('active');
      this.tabFilesBtn.classList.remove('active');
      this.sectionTitle.textContent = '当前文档大纲';
      this.chooseFolderBtn.style.display = 'none';
      this.renderOutline();
    } else {
      this.tabFilesBtn.classList.add('active');
      this.tabOutlineBtn.classList.remove('active');
      const folderName = this.currentFolder ? window.mowinAPI.path.basename(this.currentFolder) : '请选择 Markdown 文件夹';
      this.sectionTitle.textContent = folderName;
      this.chooseFolderBtn.style.display = 'flex';
      this.renderFiles();
    }
  }

  updateHeadings(headings) {
    this.headings = headings || [];
    if (this.currentTab === 'outline') {
      this.renderOutline();
    }
  }

  renderOutline() {
    this.contentEl.innerHTML = '';
    if (!this.headings || !this.headings.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-item';
      empty.style.color = 'var(--text-secondary)';
      empty.textContent = '暂无标题大纲';
      this.contentEl.appendChild(empty);
      return;
    }

    this.headings.forEach((heading, idx) => {
      const item = document.createElement('div');
      item.className = `outline-item level-${heading.level}`;
      item.textContent = heading.title || `第 ${heading.line} 行标题`;
      item.title = `${heading.title} (第 ${heading.line} 行)`;

      item.addEventListener('click', () => {
        // 编辑区跳转到该行
        this.app.editor.scrollToLine(heading.line);
        // 预览区平滑滚动到锚点
        this.app.scrollToHeading(idx);
      });

      this.contentEl.appendChild(item);
    });
  }

  async chooseFolder() {
    const folder = await window.mowinAPI.chooseFolderDialog();
    if (!folder) return;
    this.currentFolder = folder;
    this.sectionTitle.textContent = window.mowinAPI.path.basename(folder);
    await this.refreshFiles();
  }

  async refreshFiles() {
    if (!this.currentFolder) return;
    const res = await window.mowinAPI.listFiles(this.currentFolder);
    if (res.success) {
      this.filesList = res.files;
      if (this.currentTab === 'files') {
        this.renderFiles();
      }
    }
  }

  renderFiles() {
    this.contentEl.innerHTML = '';
    if (!this.currentFolder) {
      const hint = document.createElement('div');
      hint.className = 'file-item';
      hint.style.color = 'var(--text-secondary)';
      hint.textContent = '点击下方“选择文件夹…”加载文件';
      this.contentEl.appendChild(hint);
      return;
    }

    if (!this.filesList.length) {
      const empty = document.createElement('div');
      empty.className = 'file-item';
      empty.textContent = '文件夹内无 Markdown 文件';
      this.contentEl.appendChild(empty);
      return;
    }

    this.filesList.forEach(filePath => {
      const item = document.createElement('div');
      item.className = 'file-item';
      const relPath = window.mowinAPI.path.relative(this.currentFolder, filePath);
      item.textContent = relPath;
      item.title = filePath;

      item.addEventListener('click', () => {
        this.app.openDocumentPath(filePath);
      });

      this.contentEl.appendChild(item);
    });
  }

  setPdfEnabled(enabled) {
    this.exportPdfBtn.disabled = !enabled;
    if (enabled) {
      this.exportPdfBtn.title = '打印或存储为 PDF 文件';
    } else {
      this.exportPdfBtn.title = '等待离线公式排版完成…';
    }
  }

  getPdfMarginOption() {
    return parseInt(this.marginSelect.value, 10);
  }
}

window.SidebarController = SidebarController;
