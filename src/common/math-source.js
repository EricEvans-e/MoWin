/**
 * 墨窗 (MoWin) - 数学公式源文本保护与恢复
 * 在进行 Markdown 渲染前保护 TeX 源码中的特殊字符 (如 _、* 等)，
 * 避免被 Markdown 解析器破坏，同时保留换行以保证大纲行号精确一致。
 */

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class MathSource {
  constructor(source) {
    this.original = source || '';
    this.formulas = [];

    // 正则优先级：
    // 1. 代码块 ``` 或 ~~~
    // 2. 缩进代码块 (4 空格或 tab)
    // 3. 行内代码 `...`
    // 4. Markdown 链接 [text](url) 或图片 ![alt](url)
    // 5. 转义美元符号 \$
    // 6. $$...$$
    // 7. \[...\]
    // 8. \(...\)
    // 9. $formula$
    // 10. 单字符 $x$
    const pattern = /(?:^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$))|(?:^(?: {4}|\t)[^\n]*(?:\n|$))|(`+)[^`]*?\2|!?\[[^\]\n]*\]\([^\)\n]*\)|\\\$|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|(?<![\\$])\$(?![\s$])([^\n$]*?[^\s\\$])\$(?!\d)|(?<![\\$])\$(?![\s$])([^\s\\$])\$(?!\d)/gm;

    const prefix = 'MOWINMATH' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const formulas = [];
    
    // 使用 replace 回调收集匹配项并替换
    const markdown = this.original.replace(pattern, (match, fence, backticks, d1, d2, i1, i2, i3) => {
      // 检查捕获组是否是数学公式部分
      const tex = d1 || d2 || i1 || i2 || i3;
      if (typeof tex === 'undefined') {
        // 是代码、链接或转义符号，保持原样
        return match;
      }

      const display = Boolean(d1 || d2);
      const token = `${prefix}N${formulas.length}END`;
      formulas.push({ token, tex, display });

      // 保留换行符以确保后续大纲行号不偏移
      const newlines = (match.match(/\n/g) || []).length;
      return token + '\n'.repeat(newlines);
    });

    this.markdown = markdown;
    this.formulas = formulas;
  }

  /**
   * 将 HTML 中的占位符替换为可供 MathJax 处理的标签
   */
  restore(html) {
    let result = html;
    for (const formula of this.formulas) {
      const element = `<span class="mowin-math" data-display="${formula.display ? 'true' : 'false'}">${escapeHtml(formula.tex)}</span>`;
      result = result.split(formula.token).join(element);
    }
    return result;
  }

  /**
   * 恢复大纲标题中的纯文本公式
   */
  restoreTitle(title) {
    let result = title;
    for (const formula of this.formulas) {
      result = result.split(formula.token).join(formula.tex);
    }
    return result;
  }
}

module.exports = MathSource;
module.exports.escapeHtml = escapeHtml;
