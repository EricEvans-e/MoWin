/**
 * 墨窗 (MoWin) - 图片路径与 Markdown 引用处理
 * 处理 Windows 平台下的相对路径与绝对路径转换、空格转义及 Markdown 标签生成
 */

const path = require('path');

const ImagePaths = {
  extensions: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'tif', 'tiff', 'bmp', 'svg']),

  isImage(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    return this.extensions.has(ext);
  },

  /**
   * 标准化文件路径（统一使用正斜杠并规范路径）
   */
  normalize(filePath) {
    return path.normalize(filePath).replace(/\\/g, '/');
  },

  /**
   * 计算图片相对于文档目录的相对路径；若不在同级或子目录下，则使用绝对路径
   * @param {string} imagePath 图片路径
   * @param {string|null} documentPath 当前文档路径（未保存则为 null）
   * @returns {string} 用于 Markdown 的引用路径
   */
  reference(imagePath, documentPath) {
    const normImg = this.normalize(imagePath);
    if (!documentPath) {
      return normImg;
    }

    const docDir = this.normalize(path.dirname(documentPath));
    const prefix = docDir.endsWith('/') ? docDir : docDir + '/';

    // 检查是否在文档同目录或子目录
    if (normImg === docDir) {
      return path.basename(normImg);
    }

    // Windows 平台下大小写不敏感处理
    const normImgLower = normImg.toLowerCase();
    const prefixLower = prefix.toLowerCase();

    if (normImgLower.startsWith(prefixLower)) {
      const rel = normImg.slice(prefix.length);
      return rel.length > 0 ? rel : path.basename(normImg);
    }

    return normImg;
  },

  /**
   * 处理带空格或括号的路径目标，使用 <...> 进行 Markdown 规范包裹
   */
  destination(targetPath) {
    const needsBrackets = /[\s()<>]/.test(targetPath);
    if (!needsBrackets) return targetPath;
    const escaped = targetPath
      .replace(/\\/g, '\\\\')
      .replace(/</g, '\\<')
      .replace(/>/g, '\\>');
    return `<${escaped}>`;
  },

  /**
   * 清理并转义图片的 alt 文本
   */
  sanitizedAlt(text, fallback = '图片') {
    const cleaned = (text || '')
      .replace(/[\[\]\n\r]/g, ' ')
      .trim();
    if (!cleaned) {
      const fb = (fallback || '').replace(/[\[\]\n\r]/g, ' ').trim();
      return fb || '图片';
    }
    return cleaned;
  },

  /**
   * 生成 Markdown 图片语法
   */
  markdown(imagePath, documentPath, alt = '') {
    const fileNameWithoutExt = path.basename(imagePath, path.extname(imagePath));
    const label = this.sanitizedAlt(alt, fileNameWithoutExt);
    const ref = this.reference(imagePath, documentPath);
    return `![${label}](${this.destination(ref)})`;
  }
};

module.exports = ImagePaths;
