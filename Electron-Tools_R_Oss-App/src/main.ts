import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

import path from 'node:path';
import started from 'electron-squirrel-startup';
import { startLocalScraperServer } from './localScraperServer';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Flip to true to have DevTools open automatically on startup
const OPEN_DEV_TOOLS = true;

let stopLocalScraperServer: (() => void) | undefined;
let mainWindow: BrowserWindow | null = null;

const PROTOCOL = 'toolsross';
let deeplinkingUrl: string | null = null;

// Capture protocol URL when app is launched via toolsross:// on Windows
if (process.platform === 'win32') {
  const urlArg = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
  if (urlArg) {
    deeplinkingUrl = urlArg;
  }
}

// Expose the current app version to renderer processes via IPC
ipcMain.handle('get-version', () => app.getVersion());

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (OPEN_DEV_TOOLS) {
    mainWindow.webContents.openDevTools();
  }

  // Optionally, block common DevTools shortcuts in production
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isDevToolsShortcut =
      (input.control || input.meta) &&
      (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'j');

    if (isDevToolsShortcut || input.key === 'F12') {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

function handleDeepLink(url: string) {
  // Example URL: toolsross://scrape?url=...
  // For now, focus/restore the main window and log the URL.
  // Later you can parse this and trigger a scrape in your app.
  // eslint-disable-next-line no-console
  console.log('Received deep link URL:', url);

  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
}

// Ensure a single instance so protocol activations reuse the same app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const urlArg = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (urlArg) {
      deeplinkingUrl = urlArg;
      handleDeepLink(urlArg);
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.on('ready', () => {
    // Remove default application menus, keep only native window controls
    Menu.setApplicationMenu(null);

    // Register the custom protocol so toolsross:// links open this app
    if (!app.isDefaultProtocolClient(PROTOCOL)) {
      if (process.defaultApp) {
        app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
      } else {
        app.setAsDefaultProtocolClient(PROTOCOL);
      }
    }

    if (app.isPackaged) {
      setupAutoUpdates();
    }

    // Start the local HTTP API that proxies to your existing
    // scraper logic (DraftKings / OddsChecker, etc.).
    // Clients can call: POST http://localhost:3675/scraper/scrape
    // with the same body your current API expects.
    stopLocalScraperServer = startLocalScraperServer({ port: 3675 });

    createWindow();

    if (deeplinkingUrl) {
      handleDeepLink(deeplinkingUrl);
    }
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (stopLocalScraperServer) {
      stopLocalScraperServer();
      stopLocalScraperServer = undefined;
    }
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
function setupAutoUpdates() {
  // Public GitHub repo, no token needed on clients
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Ablanco1547',
    repo: 'Tools_R_Oss',    // or whatever the real repo name is
  });

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update available',
        message: 'A new version has been downloaded. Restart to install now?',
        buttons: ['Restart', 'Later'],
      })
      .then(result => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.checkForUpdatesAndNotify();
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
