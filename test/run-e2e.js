/**
 * 墨窗 (MoWin) - 跨平台端到端 (E2E) 测试运行器
 * 自动定位并兼容各类 Electron 运行环境，顺序调度执行全部 GUI 与端到端回归用例
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 探测可用的 electron 二进制
function getElectronBinary() {
  // 1. 优先获取 require('electron') 返回的原生可执行文件路径 (如 electron.exe)
  try {
    const electronPkg = require('electron');
    if (typeof electronPkg === 'string' && fs.existsSync(electronPkg)) {
      return electronPkg;
    }
  } catch (e) {}

  // 2. 本地 node_modules
  const localBinExt = process.platform === 'win32' ? '.cmd' : '';
  const localBin = path.join(__dirname, '../node_modules/.bin/electron' + localBinExt);
  if (fs.existsSync(localBin)) return localBin;

  // 3. 全局 electron
  return 'electron';
}

const testSuites = [
  'test/test-data-integrity.js',
  'test/test-pdf-quality.js',
  'test/test-sidebar-drag.js',
  'test/test-undo-e2e.js',
  'test/test-contextmenu-selection.js',
  'test/test-scale-shortcuts.js',
  'test/test-ux-regressions.js',
  'test/test-optimizations.js',
  'test/ui-interaction-test.js'
];

async function runAll() {
  const electronBin = getElectronBinary();
  console.log(`\n=== 启动 墨窗 E2E 自动化测试调度器 ===`);
  console.log(`Electron 运行引擎: ${electronBin}`);
  console.log(`待执行测试套件数: ${testSuites.length}\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testSuites.length; i++) {
    const suitePath = path.join(__dirname, '..', testSuites[i]);
    const suiteName = path.basename(suitePath);
    console.log(`[${i + 1}/${testSuites.length}] 正在执行: ${suiteName} ...`);

    const code = await new Promise((resolve) => {
      const child = spawn(electronBin, [suitePath], {
        stdio: 'inherit',
        shell: electronBin.endsWith('.cmd') || electronBin.endsWith('.bat'),
        env: Object.assign({}, process.env, { ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' })
      });
      child.on('close', (exitCode) => resolve(exitCode || 0));
      child.on('error', (err) => {
        console.error(`套件启动异常 [${suiteName}]:`, err.message);
        resolve(1);
      });
    });

    if (code === 0) {
      passed++;
      console.log(`\x1b[32m✔ ${suiteName} 执行通过\x1b[0m\n`);
    } else {
      failed++;
      console.error(`\x1b[31m✖ ${suiteName} 执行失败 (退出码: ${code})\x1b[0m\n`);
      process.exit(code);
    }
  }

  console.log(`\n\x1b[32m=== 全部 ${passed}/${testSuites.length} 组 E2E 端到端套件测试全部 PASS 通过！===\x1b[0m\n`);
}

runAll().catch((err) => {
  console.error('E2E Runner 遇到未捕获异常:', err);
  process.exit(1);
});
