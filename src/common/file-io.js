const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 检测文件编码、换行符及原始 BOM 并返回标准化内容及元数据
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
  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  return {
    content: normalized,
    encoding,
    hasBOM,
    lineEnding,
    mtime: stat.mtimeMs,
    hash,
    filePath
  };
}

/**
 * 检测磁盘文件是否发生外部修改冲突
 */
function checkFileConflict(filePath, expectedMtime, expectedHash) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { conflict: false, exists: false };
  }
  try {
    const stat = fs.statSync(filePath);
    if (!expectedMtime) {
      return { conflict: false, exists: true, mtime: stat.mtimeMs };
    }
    // 允许 10ms 以内的文件系统时间精度误差
    if (Math.abs(stat.mtimeMs - expectedMtime) > 10) {
      if (expectedHash) {
        const currentBuf = fs.readFileSync(filePath);
        const currentHash = crypto.createHash('sha256').update(currentBuf).digest('hex');
        if (currentHash === expectedHash) {
          // 仅时间戳改变但内容无差异（如外部属性变更），非实质冲突
          return { conflict: false, exists: true, mtime: stat.mtimeMs, hash: currentHash };
        }
        return { conflict: true, exists: true, diskMtime: stat.mtimeMs, hash: currentHash };
      }
      return { conflict: true, exists: true, diskMtime: stat.mtimeMs };
    }
    return { conflict: false, exists: true, mtime: stat.mtimeMs };
  } catch (err) {
    return { conflict: false, error: err.message };
  }
}

/**
 * 安全的原子化文件写入，支持依赖注入与异常回滚保护原文件
 */
function safeAtomicWrite(filePath, payloadBuf, fsOverride = fs) {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);
  const rand = Math.random().toString(36).slice(2, 8);
  const tmpPath = path.join(dir, `.~mowin-tmp-${Date.now()}-${rand}.tmp`);

  // 1. 先写临时文件
  try {
    fsOverride.writeFileSync(tmpPath, payloadBuf);
  } catch (writeErr) {
    if (fsOverride.existsSync(tmpPath)) {
      try { fsOverride.unlinkSync(tmpPath); } catch (_) {}
    }
    throw writeErr;
  }

  const fileExists = fsOverride.existsSync(resolvedPath);
  if (!fileExists) {
    try {
      fsOverride.renameSync(tmpPath, resolvedPath);
      return;
    } catch (renameErr) {
      if (fsOverride.existsSync(tmpPath)) {
        try { fsOverride.unlinkSync(tmpPath); } catch (_) {}
      }
      throw renameErr;
    }
  }

  // 2. 目标文件已存在：尝试直接原子替换
  try {
    fsOverride.renameSync(tmpPath, resolvedPath);
    return;
  } catch (firstErr) {
    // 首次 rename 失败（如 Windows EPERM/EEXIST/EBUSY 冲突）
    // 严禁直接 unlink 原文件！必须采用备份安全迁移策略
    const bakPath = path.join(dir, `.~mowin-bak-${Date.now()}-${rand}.bak`);
    try {
      fsOverride.renameSync(resolvedPath, bakPath);
    } catch (bakErr) {
      // 无法移走原文件（例如被独占占用），原文件绝不损坏，清理临时文件并报错
      if (fsOverride.existsSync(tmpPath)) {
        try { fsOverride.unlinkSync(tmpPath); } catch (_) {}
      }
      throw new Error(`无法替换目标文件，原文件未被修改: ${bakErr.message}`);
    }

    // 原文件已在 bakPath 安全封存，现在将 tmpPath 替换为 resolvedPath
    try {
      fsOverride.renameSync(tmpPath, resolvedPath);
      // 替换成功，安全清理临时备份
      try { fsOverride.unlinkSync(bakPath); } catch (_) {}
    } catch (secondErr) {
      // 替换失败，立即回滚原文件！
      try {
        fsOverride.renameSync(bakPath, resolvedPath);
      } catch (restoreErr) {
        throw new Error(`写入失败且回滚异常，原文件安全备份保留在: ${bakPath}，错误: ${secondErr.message}`);
      }
      if (fsOverride.existsSync(tmpPath)) {
        try { fsOverride.unlinkSync(tmpPath); } catch (_) {}
      }
      throw secondErr;
    }
  }
}

/**
 * 写入文件（原子化写入，保留编码、换行符与原始 BOM，支持自定义 fs 注入测试）
 */
function saveFileWithFormat(filePath, content, encoding = 'utf8', lineEnding = '\n', hasBOM = false, options = {}) {
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

  const fsImpl = options.fs || fs;
  safeAtomicWrite(filePath, payloadBuf, fsImpl);
  const stat = fsImpl.statSync(path.resolve(filePath));
  const newHash = crypto.createHash('sha256').update(payloadBuf).digest('hex');

  return {
    mtime: stat.mtimeMs,
    hash: newHash
  };
}

module.exports = {
  detectAndReadFile,
  checkFileConflict,
  saveFileWithFormat,
  safeAtomicWrite
};
