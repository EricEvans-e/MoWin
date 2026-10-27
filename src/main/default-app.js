/**
 * 墨窗 (MoWin) - Windows 默认应用与文件关联设置
 * 支持将墨窗注册到 Windows 系统“打开方式”以及设为 .md 文件的推荐打开应用
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, dialog } = require('electron');

const DefaultApp = {
  /**
   * 提示用户是否将墨窗设为 Markdown 的默认打开方式
   * @param {BrowserWindow} parentWindow 父窗口
   * @param {boolean} firstLaunch 是否首次启动调用
   */
  async offer(parentWindow, firstLaunch = false) {
    if (firstLaunch) {
      if (!app.isPackaged) return; // 开发调试模式下不弹窗打扰
      const configPath = path.join(app.getPath('userData'), 'settings.json');
      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (config.defaultAppOffered) return;
        }
      } catch (e) {}
    }

    const { response } = await dialog.showMessageBox(parentWindow, {
      type: 'question',
      buttons: ['保留现有设置', '设为默认应用'],
      defaultId: 1,
      cancelId: 0,
      title: '默认打开 Markdown 文件',
      message: '使用“墨窗”默认打开 Markdown 文件？',
      detail: '选择“设为默认应用”后，双击系统中的 .md 文件将默认使用墨窗打开。此操作仅配置当前 Windows 账户，您可以随时在 Windows 设置中修改文件关联。'
    });

    // 记录已经提示过
    const configPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      config.defaultAppOffered = true;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {}

    if (response === 1) {
      this.registerWindowsAssociations(parentWindow);
    }
  },

  /**
   * 注册 Windows 注册表文件关联 (当前用户 HKCU，无需管理员权限)
   */
  registerWindowsAssociations(parentWindow) {
    const exePath = process.execPath;
    const isPackaged = app.isPackaged;

    // 如果未打包为 exe (处于 npm start 开发模式)，生成 .reg 导入文件供打包后或调试使用
    const regContent = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\Classes\\MoWin.Markdown]
@="Markdown Document"

[HKEY_CURRENT_USER\\Software\\Classes\\MoWin.Markdown\\DefaultIcon]
@="${exePath.replace(/\\/g, '\\\\')},0"

[HKEY_CURRENT_USER\\Software\\Classes\\MoWin.Markdown\\shell]

[HKEY_CURRENT_USER\\Software\\Classes\\MoWin.Markdown\\shell\\open]
@="使用 墨窗 打开"

[HKEY_CURRENT_USER\\Software\\Classes\\MoWin.Markdown\\shell\\open\\command]
@="\\"${exePath.replace(/\\/g, '\\\\')}\\" \\"%1\\""

[HKEY_CURRENT_USER\\Software\\Classes\\.md]
@="MoWin.Markdown"
"Content Type"="text/markdown"
"PerceivedType"="text"

[HKEY_CURRENT_USER\\Software\\Classes\\.md\\OpenWithProgids]
"MoWin.Markdown"=""

[HKEY_CURRENT_USER\\Software\\Classes\\.markdown]
@="MoWin.Markdown"

[HKEY_CURRENT_USER\\Software\\Classes\\.markdown\\OpenWithProgids]
"MoWin.Markdown"=""
`;

    const tempRegFile = path.join(os.tmpdir(), 'mowin_association.reg');
    try {
      fs.writeFileSync(tempRegFile, regContent, 'utf8');
      exec(`reg import "${tempRegFile}"`, (error) => {
        try { fs.unlinkSync(tempRegFile); } catch (e) {}

        if (error) {
          dialog.showMessageBox(parentWindow, {
            type: 'warning',
            title: '注册关联',
            message: '无法自动写入注册表。',
            detail: '您可以右键任意 .md 文件，选择“打开方式 -> 选择其他应用 -> 始终使用此应用打开 .md 文件”来设置墨窗。'
          });
        } else {
          dialog.showMessageBox(parentWindow, {
            type: 'info',
            title: '设置成功',
            message: '已将“墨窗”注册为 Markdown 文件的关联应用。',
            detail: '现在您可以在资源管理器中双击 .md 文件或通过右键菜单直接使用墨窗打开。'
          });
        }
      });
    } catch (err) {
      dialog.showMessageBox(parentWindow, {
        type: 'error',
        title: '错误',
        message: '写入临时关联文件失败：' + err.message
      });
    }
  }
};

module.exports = DefaultApp;
