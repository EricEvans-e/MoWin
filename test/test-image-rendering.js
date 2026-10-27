const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mowin-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
]);

ipcMain.handle('app:get-initial-file', () => null);
ipcMain.handle('app:set-title', () => {});
ipcMain.handle('app:read-file', (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      success: true,
      content,
      encoding: 'utf8',
      lineEnding: '\n',
      filePath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  protocol.handle('mowin-resource', (request) => {
    try {
      const url = new URL(request.url);
      let rawPath = decodeURIComponent(url.pathname);
      if (process.platform === 'win32' && rawPath.startsWith('/') && rawPath.length > 2 && rawPath[2] === ':') {
        rawPath = rawPath.slice(1);
      }
      return net.fetch(pathToFileURL(rawPath).toString());
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  });

  const testDir = path.join(__dirname, 'test-doc-env');
  const imgDir = path.join(testDir, 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGFwAASvgH8WwAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(imgDir, 'figure1_paradigm_comparison.png'), png1x1);

  const testMd = path.join(testDir, 'paper.md');
  const mdContent = `# 论文分析

<div align="center">
  <img src="./images/figure1_paradigm_comparison.png" width="85%" alt="图 1：存在图片" />
</div>

![图 2：不存在的图片](./images/non_existent_figure2.png)
`;
  fs.writeFileSync(testMd, mdContent, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../src/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      await window.mowinApp.openDocumentPath(${JSON.stringify(testMd)});
      await new Promise(r => setTimeout(r, 600));

      const imgs = Array.from(document.querySelectorAll('#preview-viewport img'));
      return imgs.map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.naturalWidth,
        height: img.naturalHeight,
        broken: img.classList.contains('broken-image'),
        title: img.title
      }));
    })()
  `);

  console.log('[DIAGNOSTIC TEST RESULT]:', JSON.stringify(result, null, 2));

  fs.unlinkSync(path.join(imgDir, 'figure1_paradigm_comparison.png'));
  fs.unlinkSync(testMd);
  fs.rmdirSync(imgDir);
  fs.rmdirSync(testDir);

  app.quit();
});
