'use strict';
const {app, BrowserWindow, dialog, Menu, protocol, session, shell} = require('electron');
const path = require('node:path');
const {mkdirSync} = require('node:fs');
const {startBackend} = require('./backend.cjs');
const {ORIGIN, isAppURL, proxyRequest} = require('./protocol.cjs');

app.setName('AFTERHOURS');
const override = process.argv.find(value => value.startsWith('--data-dir='))?.slice('--data-dir='.length);
const dataDir = override ? path.resolve(override) : path.join(app.getPath('appData'), 'AFTERHOURS');
mkdirSync(dataDir, {recursive: true});
app.setPath('userData', dataDir);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'afterhours',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let backend,
  window,
  quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !backend) return;
    event.preventDefault();
    quitting = true;
    backend.stop().finally(() => app.quit());
  });
  app
    .whenReady()
    .then(async () => {
      backend = await startBackend({
        publicContent: process.argv.includes('--public-content'),
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        dataDir,
        onExit: () => {
          if (!quitting) {
            dialog.showErrorBox('AFTERHOURS', 'The local audio server stopped. Reopen AFTERHOURS to continue.');
            app.quit();
          }
        },
      });
      protocol.handle('afterhours', request => proxyRequest(request, backend));
      const ses = session.defaultSession;
      // Chromium requests midiSysex permission even for sysex:false. Grant MIDI only
      // to our own main frame; performance-midi.js requests access without SysEx.
      const midiAllowed = (contents, permission, details) =>
        ['midi', 'midiSysex'].includes(permission) &&
        !!contents &&
        isAppURL(contents.getURL()) &&
        details.isMainFrame === true &&
        isAppURL(details.requestingUrl);
      ses.setPermissionRequestHandler((contents, permission, callback, details) =>
        callback(midiAllowed(contents, permission, details)),
      );
      ses.setPermissionCheckHandler(
        (contents, permission, origin, details) => isAppURL(origin) && midiAllowed(contents, permission, details),
      );
      ses.webRequest.onBeforeRequest((details, callback) =>
        callback({cancel: !isAppURL(details.url) && !details.url.startsWith('blob:' + ORIGIN + '/')}),
      );
      window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 760,
        minHeight: 600,
        title: 'AFTERHOURS',
        backgroundColor: '#07090e',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== ORIGIN + '/') event.preventDefault();
      });
      window.webContents.on('will-redirect', event => event.preventDefault());
      window.once('ready-to-show', () => window.show());
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              {role: 'about'},
              {type: 'separator'},
              {role: 'hide'},
              {role: 'hideOthers'},
              {role: 'unhide'},
              {type: 'separator'},
              {role: 'quit'},
            ],
          },
          {
            label: 'File',
            submenu: [
              {label: 'Open Data Folder', click: () => shell.openPath(dataDir)},
              {type: 'separator'},
              {role: 'close'},
            ],
          },
          {
            label: 'Edit',
            submenu: [
              {role: 'undo'},
              {role: 'redo'},
              {type: 'separator'},
              {role: 'cut'},
              {role: 'copy'},
              {role: 'paste'},
              {role: 'selectAll'},
            ],
          },
          {
            label: 'View',
            submenu: [
              {role: 'reload'},
              {type: 'separator'},
              {role: 'resetZoom'},
              {role: 'zoomIn'},
              {role: 'zoomOut'},
              {type: 'separator'},
              {role: 'togglefullscreen'},
            ],
          },
          {label: 'Window', submenu: [{role: 'minimize'}, {role: 'zoom'}, {role: 'front'}]},
        ]),
      );
      await window.loadURL(ORIGIN + '/');
    })
    .catch(async () => {
      if (backend) await backend.stop();
      dialog.showErrorBox(
        'AFTERHOURS could not start',
        'The bundled audio server could not start. Reopen the app. For a development checkout, install the Python environment described in README.',
      );
      app.quit();
    });
}
