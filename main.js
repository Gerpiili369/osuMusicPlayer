const
    { app, BrowserWindow } = require('electron'),
    path = require('path');
let win;

function createWindow() {
    win = new BrowserWindow({
        width: 920,
        minWidth: 940,
        height: 600,
        minHeight: 500,
        transparent: true,
        frame: false,
        menu: null,
        icon: path.join(__dirname, 'osuPlayer.png'),
        webPreferences: {
           nodeIntegration: true
        }
    });
    // win.webContents.openDevTools();
    win.loadFile('index.html');
    win.on('closed', () => win = null);
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (!win) createWindow();
});
