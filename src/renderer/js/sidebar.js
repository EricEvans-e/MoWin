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
    this.expandedFolders = new Set();

    this.initElements();
  }

  initElements() {
    this.tabOutlineBtn = this.sidebar.querySelector('#sidebar-tab-outline');
    this.tabFilesBtn = this.sidebar.querySelector('#sidebar-tab-files');
    this.sectionTitle = this.sidebar.querySelector('#sidebar-section-title');
    this.contentEl = this.sidebar.querySelector('#sidebar-content');

    this.chooseFolderBtn = this.sidebar.querySelector('#btn-choose-folder');
    this.filterRow = this.sidebar.querySelector('#sidebar-filter-row');
    this.filterInput = this.sidebar.querySelector('#sidebar-file-filter');
    this.fileFilterQuery = '';

    this.marginSelect = this.sidebar.querySelector('#select-pdf-margin');
    this.exportPdfBtn = this.sidebar.querySelector('#btn-export-pdf');
    this.exportHtmlBtn = this.sidebar.querySelector('#btn-export-html');

    this.tabOutlineBtn.addEventListener('click', () => this.switchTab('outline'));
    this.tabFilesBtn.addEventListener('click', () => this.switchTab('files'));

    if (this.filterInput) {
      this.filterInput.addEventListener('input', () => {
        this.fileFilterQuery = this.filterInput.value.trim().toLowerCase();
        this.renderFiles();
      });
    }

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
      if (this.filterRow) this.filterRow.style.display = 'none';
      this.renderOutline();
    } else {
      this.tabFilesBtn.classList.add('active');
      this.tabOutlineBtn.classList.remove('active');
      const folderName = this.currentFolder ? window.mowinAPI.path.basename(this.currentFolder) : '请选择 Markdown 文件夹';
      this.sectionTitle.textContent = folderName;
      this.chooseFolderBtn.style.display = 'flex';
      if (this.filterRow) this.filterRow.style.display = this.currentFolder ? 'block' : 'none';
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
      item.dataset.index = idx.toString();
      item.textContent = heading.title || `第 ${heading.line} 行标题`;
      item.title = `${heading.title} (第 ${heading.line} 行)`;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      const selectHeading = () => {
        // 编辑区跳转到该行
        this.app.editor.scrollToLine(heading.line);
        // 预览区平滑滚动到锚点
        this.app.scrollToHeading(idx);
        this.setActiveHeading(idx);
      };

      item.addEventListener('click', selectHeading);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectHeading();
        }
      });

      this.contentEl.appendChild(item);
    });
  }

  setActiveHeading(index) {
    if (this.currentTab !== 'outline') return;
    const items = this.contentEl.querySelectorAll('.outline-item');
    items.forEach((item, idx) => {
      if (idx === index) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
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
    if (this.filterRow) this.filterRow.style.display = this.currentFolder ? 'block' : 'none';

    if (!this.currentFolder) {
      const hint = document.createElement('div');
      hint.className = 'file-item';
      hint.style.color = 'var(--text-secondary)';
      hint.textContent = '点击下方“选择文件夹…”加载文件';
      this.contentEl.appendChild(hint);
      return;
    }

    let list = this.filesList;
    if (this.fileFilterQuery) {
      list = list.filter(filePath => {
        const name = window.mowinAPI.path.basename(filePath).toLowerCase();
        return name.includes(this.fileFilterQuery) || filePath.toLowerCase().includes(this.fileFilterQuery);
      });
    }

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'file-item';
      empty.textContent = this.fileFilterQuery ? '未找到匹配的 Markdown 文件' : '文件夹内无 Markdown 文件';
      this.contentEl.appendChild(empty);
      return;
    }

    const tree = this.buildTree(this.currentFolder, list);
    const currentDoc = this.app.currentFilePath;

    // 当前有活动文档时，自动展开其父级目录
    if (currentDoc) {
      const relDoc = window.mowinAPI.path.relative(this.currentFolder, currentDoc).replace(/\\/g, '/');
      const parts = relDoc.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? (acc + '/' + parts[i]) : parts[i];
        this.expandedFolders.add(acc);
      }
    }

    this.renderTreeNode(tree, 0, Boolean(this.fileFilterQuery));
  }

  buildTree(baseFolder, filePaths) {
    const root = { isDir: true, name: '', relPath: '', subdirs: new Map(), files: [] };
    filePaths.forEach(filePath => {
      const rel = window.mowinAPI.path.relative(baseFolder, filePath);
      const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
      let curr = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const relDir = parts.slice(0, i + 1).join('/');
        if (!curr.subdirs.has(part)) {
          curr.subdirs.set(part, { isDir: true, name: part, relPath: relDir, subdirs: new Map(), files: [] });
        }
        curr = curr.subdirs.get(part);
      }
      const fileName = parts[parts.length - 1];
      curr.files.push({ name: fileName, fullPath: filePath, relPath: rel });
    });
    return root;
  }

  renderTreeNode(node, depth, forceExpandAll) {
    const currentDoc = this.app.currentFilePath;

    // 1. 渲染子目录
    const sortedSubdirs = Array.from(node.subdirs.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    sortedSubdirs.forEach(subdir => {
      const folderKey = subdir.relPath;
      const isExpanded = forceExpandAll || this.expandedFolders.has(folderKey);

      const folderEl = document.createElement('div');
      folderEl.className = 'folder-item' + (isExpanded ? ' expanded' : '');
      folderEl.style.paddingLeft = `${8 + depth * 12}px`;
      folderEl.innerHTML = `
        <span class="folder-arrow">${isExpanded ? '▼' : '▶'}</span>
        <span class="folder-icon">${isExpanded ? '📂' : '📁'}</span>
        <span class="folder-name">${subdir.name}</span>
      `;
      folderEl.title = subdir.relPath;
      folderEl.setAttribute('role', 'button');
      folderEl.setAttribute('tabindex', '0');

      folderEl.addEventListener('click', () => {
        if (this.expandedFolders.has(folderKey)) {
          this.expandedFolders.delete(folderKey);
        } else {
          this.expandedFolders.add(folderKey);
        }
        this.renderFiles();
      });

      this.contentEl.appendChild(folderEl);

      if (isExpanded) {
        this.renderTreeNode(subdir, depth + 1, forceExpandAll);
      }
    });

    // 2. 渲染当前目录下的文件
    const sortedFiles = node.files.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    sortedFiles.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.style.paddingLeft = `${16 + depth * 12}px`;
      if (currentDoc && (currentDoc === file.fullPath || window.mowinAPI.path.resolve(currentDoc) === window.mowinAPI.path.resolve(file.fullPath))) {
        item.classList.add('active');
      }
      item.innerHTML = `<span style="font-size:12px;opacity:0.75;">📄</span><span>${file.name}</span>`;
      item.title = file.fullPath;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      const selectFile = () => {
        this.app.openDocumentPath(file.fullPath);
        this.highlightActiveFile(file.fullPath);
      };

      item.addEventListener('click', selectFile);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectFile();
        }
      });

      this.contentEl.appendChild(item);
    });
  }

  setFolderContext(folderPath) {
    if (!this.currentFolder && folderPath) {
      this.currentFolder = folderPath;
      this.sectionTitle.textContent = window.mowinAPI.path.basename(folderPath);
      this.refreshFiles();
    }
  }

  highlightActiveFile(filePath) {
    if (this.currentTab !== 'files') return;
    const items = this.contentEl.querySelectorAll('.file-item');
    items.forEach(el => {
      if (el.title === filePath) el.classList.add('active');
      else el.classList.remove('active');
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
