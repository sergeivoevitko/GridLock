// Desktop mode: runs the same local server inside an app window.
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { start } = require('./server');

const PORT = 5179; // fixed so saved plans stay in the same place

async function createWindow() {
  try {
    await start({ port: PORT, dataDir: path.join(app.getPath('userData'), 'data') });
  } catch (e) {
    if (e.code !== 'EADDRINUSE') {
      dialog.showErrorBox('GridLock', `Could not start: ${e.message}`);
      app.quit();
      return;
    }
    // Already running in another window of this app: reuse it.
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
