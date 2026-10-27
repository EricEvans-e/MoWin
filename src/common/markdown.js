/**
 * 墨窗 (MoWin) - Markdown 解析与 HTML 生成器
 * 基于 GFM 标准，支持表格、任务列表、删除线、自动链接、行号注入 (data-sourcepos)、
 * 标题 ID 注入、数学公式保护及离线 MathJax SVG 样式排版。
 */

const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const taskLists = require('markdown-it-task-lists');
const MathSource = require('./math-source');

// 加载离线 MathJax 脚本
let cachedMathJaxScript = null;
function getMathJaxScript() {
  if (cachedMathJaxScript === null) {
    try {
      const vendorPath = path.join(__dirname, '../../vendor/MathJax/tex-svg-full.js');
      if (fs.existsSync(vendorPath)) {
        cachedMathJaxScript = fs.readFileSync(vendorPath, 'utf8').replace(/<\/script/gi, '<\\/script');
      } else {
        cachedMathJaxScript = '';
      }
    } catch (e) {
      cachedMathJaxScript = '';
    }
  }
  return cachedMathJaxScript;
}

const Markdown = {
  escape(text) {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  /**
   * 清洗危险脚本与事件，同时保留正常排版标签与样式属性 (div, img, span, style, width, align 等)
   */
  sanitize(html) {
    if (!html) return '';
    return html
      // 移除 <script> 及其内容
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // 移除内联 on* 危险事件 (如 onerror=, onload=, onclick= 等)
      .replace(/\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
      // 移除 javascript: 伪协议
      .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1=$2#$2')
      .replace(/(href|src)\s*=\s*javascript:[^\s>]*/gi, '$1="#"');
  },

  /**
   * 渲染 Markdown 文本
   * @param {string} text Markdown 源码
   * @returns {{body: string, headings: Array<{title: string, level: number, line: number}>}}
   */
  render(text) {
    const math = new MathSource(text);
    const protectedMarkdown = math.markdown;

    const md = new MarkdownIt({
      html: true, // 允许排版级原生 HTML 标签 (居中对齐 div、带尺寸样式的 img、span、kbd 等)
      xhtmlOut: true,
      breaks: false,
      langPrefix: 'language-',
      linkify: true,
      typographer: false
    }).use(taskLists, { enabled: false, label: true });

    // 核心插件：为所有块级元素注入 data-sourcepos="startLine:1-endLine:1"
    md.core.ruler.push('mowin_sourcepos', state => {
      for (const token of state.tokens) {
        if (token.map && token.nesting >= 0) {
          const startLine = token.map[0] + 1;
          const endLine = token.map[1];
          token.attrSet('data-sourcepos', `${startLine}:1-${endLine}:1`);
        }
      }
    });

    const parsedTokens = md.parse(protectedMarkdown, {});
    const headings = [];
    let headingIndex = 0;

    function getPlainText(children) {
      if (!children) return '';
      return children.map(c => {
        if (c.type === 'text' || c.type === 'code_inline') return c.content;
        if (c.children) return getPlainText(c.children);
        return '';
      }).join('');
    }

    // 收集大纲标题
    for (let i = 0; i < parsedTokens.length; i++) {
      const token = parsedTokens[i];
      if (token.type === 'heading_open') {
        const level = parseInt(token.tag.slice(1), 10);
        const line = token.map ? token.map[0] + 1 : 1;
        const inlineToken = parsedTokens[i + 1];
        let rawTitle = inlineToken && inlineToken.type === 'inline' ? getPlainText(inlineToken.children) : '';
        // 恢复标题中可能包含的数学公式
        const title = math.restoreTitle(rawTitle);
        headings.push({ title, level, line });

        // 为该标题注入 id 锚点属性
        token.attrSet('id', `heading-${headingIndex}`);
        headingIndex++;
      }
    }

    let renderedHTML = md.renderer.render(parsedTokens, md.options, {});

    // 过滤危险脚本与伪协议，保留安全排版标签
    renderedHTML = this.sanitize(renderedHTML);

    // 恢复数学公式为 DOM 容器
    const body = math.restore(renderedHTML);

    return { body, headings };
  },

  /**
   * 生成完整的 HTML 页面（供预览 WebView、导出 HTML 或打印 PDF 使用）
   */
  page(rendered, options = {}) {
    const {
      title = '未命名',
      base = null,
      interactive = false,
      typeset = true,
      mathStyles = '',
      inlineScript = true
    } = options;

    const baseTag = base ? `<base href="${this.escape(base)}">` : '';
    const policy = "default-src 'none'; img-src mowin-resource: file: https: http: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri mowin-resource: file:;";

    const mathScriptContent = typeset ? `
      <script>
      window.MathJax = {
        loader: { load: [] },
        tex: {
          packages: ['base', 'ams', 'newcommand', 'noundefined', 'configmacros', 'boldsymbol', 'mathtools', 'cancel', 'color'],
          maxBuffer: 100000
        },
        svg: { fontCache: 'none' },
        options: { enableMenu: false, enableAssistiveMml: false },
        startup: { typeset: false }
      };
      </script>
      <script>${getMathJaxScript()}</script>
      <script>
      window.mowinMathReady = (async () => {
        const nodes = Array.from(document.querySelectorAll('.mowin-math'));
        if (!nodes.length) return true;
        if (!window.MathJax || !window.MathJax.startup || !window.MathJax.startup.promise) {
          throw new Error('离线数学公式组件未加载');
        }
        await window.MathJax.startup.promise;
        if (!document.getElementById('MJX-offline-styles')) {
          const style = window.MathJax.startup.document.outputJax.styleSheet(window.MathJax.startup.document);
          style.id = 'MJX-offline-styles';
          document.head.appendChild(style);
        }
        for (const node of nodes) {
          const tex = node.textContent;
          try {
            const isDisplay = node.dataset.display === 'true';
            const output = await window.MathJax.tex2svgPromise(tex, { display: isDisplay });
            output.querySelectorAll('mjx-assistive-mml').forEach(n => n.remove());
            node.replaceChildren(output);
          } catch (err) {
            node.classList.add('math-error');
            node.textContent = tex;
            node.title = '公式解析失败：' + err.message;
          }
        }
        return true;
      })();
      </script>
    ` : '';

    const scrollSyncScript = interactive ? `
      <script>
      function scrollToHeading(index) {
        const el = document.getElementById('heading-' + index);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      let mowinProgrammaticY = null;
      let mowinScrollTimer = null;
      let mowinBlocks = null;

      function invalidateSourceBlocks() {
        mowinBlocks = null;
      }

      function rebuildSourceBlocks() {
        const elements = Array.from(document.querySelectorAll('[data-sourcepos]'));
        mowinBlocks = [];
        for (const el of elements) {
          const attr = el.getAttribute('data-sourcepos');
          const m = /^(\\d+):\\d+-(\\d+):\\d+/.exec(attr || '');
          if (!m) continue;
          const rect = el.getBoundingClientRect();
          const top = rect.top + window.scrollY;
          mowinBlocks.push({
            start: parseInt(m[1], 10),
            end: parseInt(m[2], 10),
            top: top,
            bottom: top + rect.height
          });
        }
      }

      function sourceBlocks() {
        if (!mowinBlocks) rebuildSourceBlocks();
        return mowinBlocks;
      }

      window.addEventListener('resize', invalidateSourceBlocks);

      function blockSpan(item) {
        return item.end === item.start ? 1 : (item.end - item.start);
      }

      function lineAtScroll(y) {
        const items = sourceBlocks();
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
            const prevPos = prev.start + blockSpan(prev);
            return prevPos + frac * (next.start - prevPos);
          }
          if (next) return next.start;
          return prev ? prev.start + blockSpan(prev) : 1;
        }
        if (chosen.bottom <= chosen.top) return chosen.start;
        const frac = Math.min(1, Math.max(0, (y - chosen.top) / (chosen.bottom - chosen.top)));
        return chosen.start + frac * blockSpan(chosen);
      }

      function lineAtTop() {
        return lineAtScroll(window.scrollY);
      }

      function scrollToLine(line) {
        const items = sourceBlocks();
        let y = 0;
        if (line > 1 && items.length) {
          let chosen = null;
          for (const item of items) {
            const limit = item.start + blockSpan(item);
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
            const frac = Math.min(1, Math.max(0, (line - chosen.start) / blockSpan(chosen)));
            y = chosen.top + frac * (chosen.bottom - chosen.top);
          }
        }
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        mowinProgrammaticY = Math.max(0, Math.min(maxScroll, y));
        window.scrollTo(0, mowinProgrammaticY);
        mowinProgrammaticY = window.scrollY;
      }

      function setScrollRatio(ratio) {
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        mowinProgrammaticY = Math.round(Math.max(0, Math.min(1, ratio)) * maxScroll);
        window.scrollTo(0, mowinProgrammaticY);
        mowinProgrammaticY = window.scrollY;
      }

      window.addEventListener('scroll', () => {
        if (mowinScrollTimer !== null) return;
        mowinScrollTimer = setTimeout(() => {
          mowinScrollTimer = null;
          if (mowinProgrammaticY !== null && Math.abs(window.scrollY - mowinProgrammaticY) < 1.5) return;
          mowinProgrammaticY = null;
          if (window.onMowinScroll) {
            window.onMowinScroll(lineAtScroll(window.scrollY));
          }
        }, 16);
      }, { passive: true });
      </script>
    ` : '';

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${policy}">
  ${baseTag}
  <title>${this.escape(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #fcfbf8;
      --ink: #303331;
      --muted: #777e77;
      --line: #e4e6df;
      --accent: #2e7d32;
      --code: #f0f2ed;
      --selection: rgba(46, 125, 50, 0.22);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1e2220;
        --ink: #e0e5df;
        --muted: #9ba79d;
        --line: #38423b;
        --accent: #66bb6a;
        --code: #28302b;
        --selection: rgba(102, 187, 106, 0.28);
      }
    }
    body.light-theme {
      --bg: #fcfbf8;
      --ink: #303331;
      --muted: #777e77;
      --line: #e4e6df;
      --accent: #2e7d32;
      --code: #f0f2ed;
      --selection: rgba(46, 125, 50, 0.22);
    }
    body.dark-theme {
      --bg: #1e2220;
      --ink: #e0e5df;
      --muted: #9ba79d;
      --line: #38423b;
      --accent: #66bb6a;
      --code: #28302b;
      --selection: rgba(102, 187, 106, 0.28);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 16px;
      line-height: 1.85;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    main {
      max-width: 820px;
      padding: 40px 48px 120px;
      margin: auto;
      overflow-wrap: anywhere;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.38;
      scroll-margin-top: 36px;
      font-weight: 650;
      margin: 1.7em 0 .65em;
      color: var(--ink);
    }
    h1 {
      font-size: 2em;
      border-bottom: 1px solid var(--line);
      padding-bottom: .45em;
    }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1.1em; }
    h5 { font-size: 1.0em; }
    h6 { font-size: 0.9em; }
    p { margin: 1em 0; }
    a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    blockquote {
      border-left: 3.5px solid var(--accent);
      color: var(--muted);
      margin: 1.5em 0;
      padding: 0.2em 1.2em;
      background: var(--code);
      border-radius: 0 4px 4px 0;
    }
    pre {
      padding: 18px 22px;
      border-radius: 8px;
      background: var(--code);
      overflow: auto;
      line-height: 1.6;
    }
    code {
      font-family: "Cascadia Code", "Consolas", Menlo, monospace;
      font-size: .88em;
      background: var(--code);
      border-radius: 4px;
      padding: 2px 5px;
    }
    pre code {
      padding: 0;
      background: none;
      font-size: .92em;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
    }
    table {
      border-collapse: collapse;
      display: block;
      overflow-x: auto;
      margin: 1.5em 0;
      width: 100%;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px 16px;
      text-align: left;
    }
    th {
      background: var(--code);
      font-weight: 600;
    }
    hr {
      border: 0;
      border-top: 1px solid var(--line);
      margin: 2.5em 0;
    }
    li { margin: .28em 0; }
    input[type=checkbox] {
      accent-color: var(--accent);
      cursor: pointer;
      margin-right: 6px;
    }
    ::selection {
      background: var(--selection);
    }
    .mowin-math[data-display=true] {
      display: block;
      text-align: center;
      margin: 1.25em 0;
      overflow-x: auto;
      overflow-y: hidden;
      padding: .25em 0;
    }
    mjx-container { max-width: 100%; }
    mjx-container svg { max-width: none; }
    mjx-container svg path { fill: currentColor; }
    .math-error {
      color: #d32f2f;
      background: rgba(211, 47, 47, 0.08);
      padding: 2px 4px;
      border-radius: 3px;
    }
    @media (max-width: 600px) {
      main { padding: 24px 20px 80px; }
    }
    @media print {
      :root {
        color-scheme: light;
        --bg: white;
        --ink: #111;
        --muted: #555;
        --line: #ddd;
        --code: #f6f6f6;
      }
      body { font-size: 11pt; }
      main { max-width: none; padding: 0; }
      pre, blockquote, tr, img { break-inside: avoid; }
      h1, h2, h3 { break-after: avoid; }
      a { color: inherit; text-decoration: none; }
      pre { white-space: pre-wrap; }
      .mowin-math { break-inside: avoid; }
      .mowin-math[data-display=true] { overflow: visible; }
      mjx-container svg { max-width: 100%; height: auto; }
    }
  </style>
  ${mathStyles}
</head>
<body>
  <main>${rendered.body}</main>
  ${mathScriptContent}
  ${scrollSyncScript}
</body>
</html>`;
  }
};

module.exports = Markdown;
