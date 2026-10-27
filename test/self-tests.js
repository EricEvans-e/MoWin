/**
 * 墨窗 (MoWin) - 全量自动化自检测试套件
 * 借鉴并扩展自墨页的原生集成自检，测试覆盖：
 * Markdown 解析、大纲提取、GFM 规范、安全防御、离线 MathJax 公式保护与恢复、
 * 选区格式化操作、Setext/ATX 标题转换、智能列表续写、图片路径处理及编码往返。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Markdown = require('../src/common/markdown');
const LaTeX = require('../src/common/latex');
const Formatting = require('../src/common/formatting');
const ImagePaths = require('../src/common/image-paths');

let passedCount = 0;
let totalCount = 0;

function check(condition, message) {
  totalCount++;
  if (!condition) {
    console.error(`\x1b[31mFAIL: ${message}\x1b[0m`);
    process.exit(1);
  }
  passedCount++;
  console.log(`\x1b[32mPASS: ${message}\x1b[0m`);
}

function runTests() {
  console.log('=== 开始执行 墨窗 (MoWin) 自检测试 ===\n');

  // 1. Markdown 渲染、大纲解析及 GFM 格式
  const sample = '# 中文 **标题**\n\n## 子标题\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] 完成\n- [ ] 待办\n\n~~删除~~\n\n```javascript\nconst x = 1;\n```\n\nhttps://example.com\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n';
  const rendered = Markdown.render(sample);

  check(
    rendered.headings.length === 2 &&
    rendered.headings[0].title === '中文 标题' &&
    rendered.headings[1].line === 3,
    '大纲解析中文、内联格式和行号'
  );

  check(
    rendered.body.includes('id="heading-0"') &&
    rendered.body.includes('data-sourcepos="1:1-'),
    '标题锚点与源码行号'
  );

  check(
    rendered.body.includes('<table') &&
    (rendered.body.includes('<s>删除</s>') || rendered.body.includes('<del>删除</del>')),
    'GFM 表格和删除线'
  );

  check(
    rendered.body.includes('type="checkbox"') &&
    rendered.body.includes('checked'),
    '任务列表解析与勾选状态'
  );

  check(
    rendered.body.includes('language-javascript') &&
    rendered.body.includes('https://example.com'),
    '代码块语法标识与自动链接'
  );

  check(
    !rendered.body.includes('<script>') &&
    !rendered.body.includes('href="javascript:'),
    '过滤原始危险 HTML 和 JavaScript 伪协议'
  );

  const htmlImageSample = '<div align="center">\n  <img src="./images/fig1.png" width="85%" onerror="alert(1)" />\n  <p><strong>图 1：范式对比</strong></p>\n</div>';
  const htmlImageRendered = Markdown.render(htmlImageSample);
  check(
    htmlImageRendered.body.includes('<div align="center">') &&
    htmlImageRendered.body.includes('<img src="./images/fig1.png" width="85%"') &&
    htmlImageRendered.body.includes('<strong>图 1：范式对比</strong>') &&
    !htmlImageRendered.body.includes('onerror'),
    '原生 HTML 排版标签 (div居中、img尺寸、段落加粗) 完整渲染并安全清洗 on* 事件'
  );

  check(
    Markdown.render('```\n# 假标题\n```\n\n真正标题\n===').headings.map(h => h.title)[0] === '真正标题',
    '代码块内部不污染大纲，且支持 Setext 标题'
  );

  const pageHtml = Markdown.page(rendered, { title: '<title>' });
  check(
    pageHtml.includes('&lt;title&gt;') && pageHtml.includes('Content-Security-Policy'),
    '完整 HTML 页面转义与内容安全策略 (CSP)'
  );

  // 2. 数学公式源码保护与还原
  const mathSource = '行内 $\\frac{a_1}{b}$ 和 \\(\\sqrt{x}\\)。\n\n$$\na^2+b^2=c^2\n$$\n\n## 后续标题';
  const mathRendered = Markdown.render(mathSource);

  check(
    mathRendered.body.includes('\\frac{a_1}{b}') &&
    mathRendered.body.includes('\\sqrt{x}') &&
    mathRendered.body.includes('data-display="true"'),
    '数学源码保留反斜杠、下划线及行内与块级类型'
  );

  check(
    mathRendered.headings[mathRendered.headings.length - 1].line === 7,
    '多行公式后标题行号精确保留无偏差'
  );

  const codeMath = Markdown.render('`$x$`\n\n```tex\n$$\\frac{a}{b}$$\n```\n\n    $indented$\n\n价格 \\$20 和 $30');
  check(
    !codeMath.body.includes('mowin-math'),
    '代码块、行内代码、缩进代码和普通货币符号跳过数学公式渲染'
  );

  const singleCharMath = Markdown.render('$x$ $y$ $z$');
  check(
    singleCharMath.body.split('class="mowin-math"').length === 4,
    '多个单字符公式识别'
  );

  // 3. LaTeX 公式智能转换
  check(LaTeX.markdownFormula('\\(\\frac{a}{b}\\)') === '$\\frac{a}{b}$', 'LaTeX 行内公式转换 (\\( \\) -> $ $)');
  check(LaTeX.markdownFormula('\\[x^2 + y^2\\]') === '$$\nx^2 + y^2\n$$', 'LaTeX 块级公式转换 (\\[ \\] -> $$ $$)');
  check(
    LaTeX.markdownFormula('\\begin{align}a&=b\\\\c&=d\\end{align}') === '$$\n\\begin{aligned}\na&=b\\\\c&=d\n\\end{aligned}\n$$',
    'align 环境转换为 aligned 并保留多行对齐'
  );
  check(
    LaTeX.markdownFormula('面积为 \\(a b\\)，周长为 \\(2a+2b\\)。') === '面积为 $a b$，周长为 $2a+2b$。',
    '公式转换保留周围文字内容'
  );
  check(
    LaTeX.markdownFormula('\\sqrt{x}') === '$\\sqrt{x}$',
    '识别未加分隔符的标准数学命令'
  );
  check(
    LaTeX.markdownFormula('普通文字') === null &&
    LaTeX.markdownFormula('$\\alpha$') === null &&
    LaTeX.markdownFormula('\\frac{a') === null,
    '排除普通文字、已有 Markdown 公式和残缺表达式'
  );

  // 4. 格式化操作 (强调、常规字重、标题)
  const boldRes = Formatting.emphasis('中文😀', { start: 0, end: 4 }, '**');
  check(
    boldRes.replacement === '**中文😀**' &&
    boldRes.selection[0] === 2 && boldRes.selection[1] === 6,
    '加粗保留中文及 Emoji 选区'
  );

  const regularRes = Formatting.emphasis('**中文😀**', { start: 2, end: 6 }, '**', true);
  check(
    regularRes.replacement === '中文😀' &&
    regularRes.range[0] === 0 && regularRes.range[1] === 8,
    '常规字重移除选区外加粗符号'
  );

  const headingRes = Formatting.heading('## 旧标题\n正文\n', { start: 3, end: 6 }, 4);
  check(
    headingRes.replacement === '#### 旧标题\n' &&
    headingRes.range[0] === 0 && (headingRes.range[1] - headingRes.range[0]) === 7,
    '更换标题级别不叠加井号'
  );

  const multilineHeadings = Formatting.heading('第一行\n第二行\n第三行', { start: 0, end: 8 }, 2);
  check(
    multilineHeadings.replacement === '## 第一行\n## 第二行\n' &&
    (multilineHeadings.range[1] - multilineHeadings.range[0]) === 8,
    '多行标题不影响选区末尾之后的行'
  );

  const setextHeading = Formatting.heading('标题\n===\n正文', { start: 0, end: 2 }, 3);
  check(
    setextHeading.replacement === '### 标题\n' &&
    (setextHeading.range[1] - setextHeading.range[0]) === 7,
    '转换 Setext 标题并正确清除下划线'
  );

  const cancelHeading = Formatting.heading('### 标题', { start: 4, end: 6 }, 0);
  check(
    cancelHeading.replacement === '标题',
    '标题恢复为普通正文'
  );

  // 智能回车续写测试
  const taskNewline = Formatting.smartNewline('- [x] 已完成事项', 10);
  check(
    taskNewline.handled && taskNewline.insertion === '\n- [ ] ',
    '任务列表回车自动续写未完成新项'
  );

  const numNewline = Formatting.smartNewline('9. 项目', 6);
  check(
    numNewline.handled && numNewline.insertion === '\n10. ',
    '有序列表回车数字自动递增'
  );

  const emptyListExit = Formatting.smartNewline('- ', 2);
  check(
    emptyListExit.handled && emptyListExit.exitList,
    '空列表项按回车自动退出列表'
  );

  // 5. 图片路径与引用生成
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mowin-test-img-'));
  try {
    const docPath = path.join(tempDir, '笔记.md');
    const sameDirImg = path.join(tempDir, '封面.png');
    const subDir = path.join(tempDir, 'assets');
    fs.mkdirSync(subDir, { recursive: true });
    const nestedImg = path.join(subDir, '内图.png');
    const spaceImg = path.join(tempDir, 'my photo.png');
    const outsideImg = path.join(os.tmpdir(), 'outside.png');

    check(
      ImagePaths.reference(sameDirImg, docPath) === '封面.png',
      '同目录下图片引用生成相对路径'
    );

    check(
      ImagePaths.reference(nestedImg, docPath) === 'assets/内图.png',
      '子目录下图片引用生成相对路径'
    );

    check(
      ImagePaths.reference(outsideImg, docPath) === ImagePaths.normalize(outsideImg),
      '其他目录下图片引用使用绝对路径'
    );

    check(
      ImagePaths.reference(sameDirImg, null) === ImagePaths.normalize(sameDirImg),
      '未保存的新文档图片引用使用绝对路径'
    );

    check(
      ImagePaths.markdown(sameDirImg, docPath, '选中文字说明') === '![选中文字说明](封面.png)',
      '选中文本作为图片 alt 说明'
    );

    check(
      ImagePaths.markdown(spaceImg, docPath, '带空格') === '![带空格](<my photo.png>)',
      '包含空格的路径添加 <...> 转义'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 6. 文件编码与换行符往返无损测试
  const utf8Text = '# 墨窗测试\r\n中文内容 😀\r\n';
  const utf8Buf = Buffer.from(utf8Text, 'utf8');
  check(utf8Buf.toString('utf8') === utf8Text, 'UTF-8 中文与 CRLF 换行无损读取与保存');

  const utf16LEText = '# UTF16 测试\r\n内容';
  const utf16LEBuf = Buffer.from(utf16LEText, 'utf16le');
  check(utf16LEBuf.toString('utf16le') === utf16LEText, 'UTF-16LE 编码往返正确');

  console.log(`\n\x1b[32m=== 全部 ${passedCount}/${totalCount} 项核心自检测试通过！===\x1b[0m`);
}

runTests();
