const fs = require('fs');
const path = require('path');

/**
 * 检测文件编码、换行符及原始 BOM 并返回标准化内容
 */
function detectAndReadFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  let encoding = 'utf8';
  let hasBOM = false;
  let text = '';

  // 检测 BOM 标记
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    encoding = 'utf16le';
    hasBOM = true;
    text = buf.slice(2).toString('utf16le');
  } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    encoding = 'utf16be';
    hasBOM = true;
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i < buf.length - 1; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    text = swapped.toString('utf16le');
  } else {
    // UTF-8
    let offset = 0;
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      offset = 3; // UTF-8 BOM
      hasBOM = true;
    }
    encoding = 'utf8';
    text = buf.slice(offset).toString('utf8');
  }

  // 检测换行符
  const lineEnding = text.includes('\r\n') ? '\r\n' : (text.includes('\r') ? '\r' : '\n');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return {
    content: normalized,
    encoding,
    hasBOM,
    lineEnding,
    mtime: stat.mtimeMs,
    filePath
  };
}

/**
 * 写入文件（原子化写入，保留编码、换行符与原始 BOM）
 */
function saveFileWithFormat(filePath, content, encoding = 'utf8', lineEnding = '\n', hasBOM = false) {
  const textWithEnding = content.replace(/\n/g, lineEnding);
  let payloadBuf;
  const enc = (encoding || 'utf8').toLowerCase();

  if (enc === 'utf16le' || enc === 'utf-16le' || enc === 'utf-16' || enc === 'utf16') {
    const raw = Buffer.from(textWithEnding, 'utf16le');
    // UTF-16LE 写入必须保留 BOM [0xFF, 0xFE]，否则 Windows 重新打开将误认为 UTF-8 出现 NUL 乱码
    const bom = Buffer.from([0xFF, 0xFE]);
    payloadBuf = Buffer.concat([bom, raw]);
  } else if (enc === 'utf16be' || enc === 'utf-16be') {
    const rawLE = Buffer.from(textWithEnding, 'utf16le');
    const swapped = Buffer.alloc(rawLE.length);
    for (let i = 0; i < rawLE.length - 1; i += 2) {
      swapped[i] = rawLE[i + 1];
      swapped[i + 1] = rawLE[i];
    }
    const bom = Buffer.from([0xFE, 0xFF]);
    payloadBuf = Buffer.concat([bom, swapped]);
  } else {
    // UTF-8
    const raw = Buffer.from(textWithEnding, 'utf8');
    if (hasBOM) {
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      payloadBuf = Buffer.concat([bom, raw]);
    } else {
      payloadBuf = raw;
    }
  }

  // 原子化写入：先写入同目录下的临时文件，然后通过 renameSync 替换目标文件
  const dir = path.dirname(path.resolve(filePath));
  const tmpPath = path.join(dir, `.~mowin-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  fs.writeFileSync(tmpPath, payloadBuf);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    fs.renameSync(tmpPath, filePath);
  }
}

module.exports = {
  detectAndReadFile,
  saveFileWithFormat
};
