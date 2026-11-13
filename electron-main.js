// Desktop mode: runs the same local server inside an app window, and loads
// Instagram profiles in a hidden real browser window.
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { start } = require('./server');
const { profileUrl, IgError, notFound, loginWall } = require('./instagram');

const PORT = 5179; // fixed so saved plans stay in the same place

// Present as the Chromium it is, without the Electron/app tokens.
const browserUA = () => app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ gridlock\/\S+/i, '');

async function getScriptsWithBrowser(username) {
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:instagram', images: false } });
  win.webContents.setUserAgent(browserUA());
  let status = 200;
  win.webContents.on('did-navigate', (_e, _url, code) => {
    if (code) status = code;
  });
  try {
    try {
      await win.loadURL(profileUrl(username));
    } catch (e) {
      if (status === 404) throw notFound(username);
      throw new IgError('Could not reach Instagram. Check your internet connection.', 'offline');
    }
    if (status === 404) throw notFound(username);
    if (status === 429) throw new IgError('Instagram is limiting requests right now. Wait a few minutes and try again.', 'rate_limited');
    if (/\/accounts\/login|\/challenge\//.test(win.webContents.getURL())) throw loginWall();
    return await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('script[type="application/json"]')).map((s) => s.textContent)`
    );
  } finally {
    win.destroy();
  }
}

async function createWindow() {
  try {
    await start({
      port: PORT,
      dataDir: path.join(app.getPath('userData'), 'data'),
      getScripts: getScriptsWithBrowser,
    });
  } catch (e) {
    if (e.code !== 'EADDRINUSE') {
      dialog.showErrorBox('GridLock', `Could not start: ${e.message}`);
      app.quit();
      return;
    }
    // Already running: reuse it.
  }
  const win = new BrowserWindow({
    width: 560,
    height: 900,
    minWidth: 380,
    title: 'GridLock',
    backgroundColor: '#fafafa',
    autoHideMenuBar: true,
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://localhost:${PORT}`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
