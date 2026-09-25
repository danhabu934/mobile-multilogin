const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('node:path');
let window;
let inFlight;
app.whenReady().then(() => {
  ipcMain.handle('host:inspect', async event => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid sender');
    if (!inFlight) inFlight = import('../diagnostics/host.mjs').then(m => m.inspectHost()).finally(() => { inFlight = null; });
    return inFlight;
  });
  function open() {
    window = new BrowserWindow({width: 1050, height: 820, minWidth: 650, backgroundColor: '#0b1018', webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.loadFile(path.join(__dirname, 'index.html'));
  }
  open();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
