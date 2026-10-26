/**
 * 墨窗 (MoWin) - Markdown 格式操作工具库
 * 包含加粗、常规字重、斜体、标题等级转换 (ATX/Setext)、智能回车续写列表等功能
 */

const Formatting = {
  /**
   * 强调语法转换（加粗 ** 或斜体 *）
   * @param {string} text 完整文本
   * @param {{start: number, end: number}} selection 选区范围
   * @param {string} marker 格式符号（如 "**" 或 "*" 或 "~~"）
   * @param {boolean} removeOnly 是否仅移除标记（用于“常规字重”）
   * @returns {{range: [number, number], replacement: string, selection: [number, number]}}
   */
  emphasis(text, selection, marker, removeOnly = false) {
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const width = marker.length;

    let rangeStart = start;
    let rangeEnd = end;
    let content = text.slice(start, end);

    // 1. 选区内部已包含标记：例如选区就是 "**文字**"
    if (content.startsWith(marker) && content.endsWith(marker) && content.length >= width * 2) {
      const stripped = content.slice(width, content.length - width);
      return {
        range: [start, end],
        replacement: stripped,
        selection: [start, start + stripped.length]
      };
    }

    // 2. 选区外部恰好被标记包裹：例如光标选中文本 "文字"，而上下文是 "**文字**"
    if (start >= width && end + width <= text.length) {
      const before = text.slice(start - width, start);
      const after = text.slice(end, end + width);
      if (before === marker && after === marker) {
        return {
          range: [start - width, end + width],
          replacement: content,
          selection: [start - width, start - width + content.length]
        };
      }
    }

    // 3. 如果只是“常规字重”（只移除不添加）
    if (removeOnly) {
      return {
        range: [start, end],
        replacement: content,
        selection: [start, end]
      };
    }

    // 4. 添加强调标记
    if (!content) {
      content = '文字';
    }
    const replacement = marker + content + marker;
    return {
      range: [rangeStart, rangeEnd],
      replacement: replacement,
      selection: [rangeStart + width, rangeStart + width + content.length]
    };
  },

  /**
   * 设置或转换标题等级 (level: 0 为恢复正文, 1~6 为 1~6 级标题)
   * 完美处理 ATX 标题 (# 标题) 和 Setext 标题 (下划线 === 或 ---)
   */
  heading(text, selection, level) {
    const selStart = Math.min(selection.start, selection.end);
    const selEnd = Math.max(selection.start, selection.end);
    const coveredEnd = selEnd > selStart ? selEnd - 1 : selStart;

    // 计算包含起止行完整范围（包含行尾换行符）
    let lineStart = text.lastIndexOf('\n', selStart - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;

    let lineEnd = text.indexOf('\n', coveredEnd);
    let trailingNewline = false;
    if (lineEnd !== -1) {
      trailingNewline = true;
      lineEnd += 1; // 包含该换行符
    } else {
      lineEnd = text.length;
    }

    let linesBlock = text.slice(lineStart, lineEnd);
    let lines = linesBlock.split('\n');
    if (trailingNewline && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const atxRegex = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
    const setextRegex = /^ {0,3}(?:=+|-+)[ \t]*$/;

    // 检查是否有紧随单行标题下方的 Setext 下划线
    if (lines.length === 1 && lineEnd < text.length) {
      const nextEnd = text.indexOf('\n', lineEnd);
      const nextLineSlice = text.slice(lineEnd, nextEnd === -1 ? text.length : nextEnd);
      if (setextRegex.test(nextLineSlice.trim()) && lines[0].trim().length > 0) {
        lineEnd = nextEnd === -1 ? text.length : nextEnd + 1;
        linesBlock = text.slice(lineStart, lineEnd);
        lines = linesBlock.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
      }
    }

    const prefix = level === 0 ? '' : '#'.repeat(Math.min(6, Math.max(1, level))) + ' ';
    const output = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 如果当前行是前一行的 Setext 下划线，则跳过
      if (i > 0 && setextRegex.test(line) && lines[i - 1].trim().length > 0) {
        continue;
      }
      const clean = line.replace(atxRegex, '');
      if (clean.trim().length === 0) {
        output.push(clean);
      } else {
        output.push(prefix + clean);
      }
    }

    const replacement = output.join('\n') + (trailingNewline ? '\n' : '');
    return {
      range: [lineStart, lineEnd],
      replacement: replacement,
      selection: [lineStart, lineStart + replacement.length]
    };
  },

  /**
   * 智能回车处理：自动续写无序列表、有序列表、任务列表、引用块；
   * 空项回车则退出列表。
   * @param {string} lineText 光标所在行的文本
   * @param {number} col 光标在该行的列位置
   * @returns {{handled: boolean, replacement?: string, newCursorOffset?: number}}
   */
  smartNewline(lineText, col) {
    const before = lineText.slice(0, col);
    const pattern = /^(\s*)(?:([-+*]) (?:\s*\[([ xX])\] )?|(\d+)[.)] |> )(.*)$/;
    const match = pattern.exec(before);

    if (!match) {
      return { handled: false };
    }

    const indent = match[1] || '';
    const bullet = match[2];
    const isTask = typeof match[3] !== 'undefined';
    const num = match[4];
    const rest = match[5] || '';

    // 如果该项内容为空（只包含了标记），则回车退出该列表
    if (rest.trim().length === 0) {
      return {
        handled: true,
        exitList: true,
        deleteCount: before.length,
        insertion: '\n'
      };
    }

    let nextMarker = '';
    if (num) {
      const nextNum = parseInt(num, 10) + 1;
      nextMarker = `${nextNum}. `;
    } else if (bullet) {
      if (isTask) {
        nextMarker = `${bullet} [ ] `;
      } else {
        nextMarker = `${bullet} `;
      }
    } else {
      nextMarker = '> ';
    }

    return {
      handled: true,
      exitList: false,
      insertion: '\n' + indent + nextMarker
    };
  },

  /**
   * 包裹文字（如代码块、链接等）
   */
  wrap(text, selection, left, right, placeholder = '文字') {
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const content = start !== end ? text.slice(start, end) : placeholder;
    const replacement = left + content + right;
    return {
      range: [start, end],
      replacement: replacement,
      selection: [start + left.length, start + left.length + content.length]
    };
  },

  /**
   * 给选中行切换前缀（如引用 `> ` 或列表 `- `）
   */
  togglePrefix(text, selection, prefix) {
    const selStart = Math.min(selection.start, selection.end);
    const selEnd = Math.max(selection.start, selection.end);

    let lineStart = text.lastIndexOf('\n', selStart - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;

    let lineEnd = text.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = text.length;

    const block = text.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allHavePrefix = lines.every(l => l.startsWith(prefix));

    const newLines = lines.map(line => {
      if (allHavePrefix) {
        return line.startsWith(prefix) ? line.slice(prefix.length) : line;
      } else {
        return prefix + line;
      }
    });

    const replacement = newLines.join('\n');
    return {
      range: [lineStart, lineEnd],
      replacement: replacement,
      selection: [lineStart, lineStart + replacement.length]
    };
  }
};

module.exports = Formatting;
