/**
 * 墨窗 (MoWin) - LaTeX 数学公式识别与转换
 * 能够智能识别选中的 LaTeX 代码并转换为 Markdown 规范的公式格式 ($...$ 或 $$...$$)
 */

const LaTeX = {
  /**
   * 将选中的 LaTeX 转换为 Markdown 公式写法
   * @param {string} source 输入的原始字符串
   * @returns {string|null} 转换后的字符串；如果不是 LaTeX 公式或已符合规范则返回 null
   */
  markdownFormula(source) {
    if (!source || typeof source !== 'string') return null;
    const trimmed = source.trim();
    if (!trimmed) return null;

    // 已经是 $...$ 或 $$...$$ 格式的内容无需重复转换
    if (trimmed.startsWith('$') && trimmed.endsWith('$')) {
      return null;
    }

    let result = source;
    let converted = false;

    // 1. 匹配常见 LaTeX 隔离环境
    // \[ ... \] => $$ ... $$
    // \( ... \) => $ ... $
    // \begin{equation} ... \end{equation} 等
    const delimiters = [
      { pattern: /\\\[([\s\S]+?)\\\]/g, display: true, hasEnv: false },
      { pattern: /\\\(([\s\S]+?)\\\)/g, display: false, hasEnv: false },
      { pattern: /\\begin\{(equation\*?|displaymath|math|align\*?|gather\*?)\}([\s\S]+?)\\end\{\1\}/g, display: true, hasEnv: true }
    ];

    for (const { pattern, display, hasEnv } of delimiters) {
      result = result.replace(pattern, (match, ...args) => {
        converted = true;
        let env = '';
        let body = '';
        if (hasEnv) {
          env = args[0] || '';
          body = (args[1] || '').trim();
        } else {
          body = (args[0] || '').trim();
        }

        if (env.startsWith('align')) {
          body = `\\begin{aligned}\n${body}\n\\end{aligned}`;
        } else if (env.startsWith('gather')) {
          body = `\\begin{gathered}\n${body}\n\\end{gathered}`;
        }

        const block = display && env !== 'math';
        return block ? `$$\n${body}\n$$` : `$${body}$`;
      });
    }

    if (converted) return result;

    // 2. 识别未加公式分隔符的裸数学命令 (例如 \frac{a}{b}, \sqrt{x}, \int 等)
    // 排除包含 $ 的普通混合内容
    if (trimmed.includes('$')) return null;

    const mathCommandRegex = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|iint|iiint|oint|lim|sin|cos|tan|cot|sec|csc|log|ln|exp|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|infty|partial|nabla|pm|mp|times|div|cdot|leq|geq|neq|approx|equiv|forall|exists|in|notin|subset|subseteq|cup|cap|vec|mathbf|mathrm|mathit|mathbb|mathcal|left|right|begin\{(?:matrix|pmatrix|bmatrix|vmatrix|Vmatrix|aligned|cases)\})(?![A-Za-z])/;

    if (!mathCommandRegex.test(trimmed)) {
      return null;
    }

    // 检查括号匹配，确保是合法的数学表达式片段而不是残缺命令
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth < 0) return null;
      }
    }
    if (depth !== 0) return null;

    // 若包含换行则采用多行块级公式，否则采用行内公式
    return trimmed.includes('\n') ? `$$\n${trimmed}\n$$` : `$${trimmed}$`;
  }
};

module.exports = LaTeX;
