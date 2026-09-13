// Simulate Electron's environment by stubbing 'electron' and required globals,
// then require the main entry point. Surfaces the exact throw point.
const Module = require('module');
const path = require('path');
const asar = require('@electron/asar');

const asarPath = '/Users/louloulin/multica/apps/desktop/dist/mac-arm64/Multica.app/Contents/Resources/app.asar';

// Patch require to read from asar
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (typeof request === 'string' && !request.startsWith('.') && !request.startsWith('/') && !request.startsWith('node:')) {
    const asarModulePath = path.join(asarPath, 'node_modules', request);
    try {
      return origResolve.call(this, asarModulePath, parent, ...args);
    } catch {}
  }
  return origResolve.call(this, request, parent, ...args);
};

// Stub electron module
const electronStub = {
  app: {
    setName: () => {},
    setAppUserModelId: () => {},
    setAsDefaultProtocolClient: () => {},
    getPath: () => '/tmp/multica-stub',
    getAppPath: () => '/tmp/multica-stub',
    on: () => {},
    whenReady: () => Promise.resolve(),
    quit: () => {},
    requestSingleInstanceLock: () => true,
    getVersion: () => '0.0.0-test',
    name: 'Multica',
    dock: null,
    isReady: () => true,
  },
  BrowserWindow: class {
    constructor() { console.log('BrowserWindow created'); }
    static fromWebContents() { return null; }
    static getAllWindows() { return []; }
    on() {}
    once() {}
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return false; }
    webContents = { send: () => {}, on: () => {}, isDestroyed: () => false, openDevTools: () => {} };
  },
  ipcMain: { handle: () => {}, on: () => {} },
  Menu: { buildFromTemplate: () => ({}) },
  Tray: class { constructor() {} },
  shell: { openExternal: () => {} },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  dialog: {},
  Notification: class { constructor() {} show() {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { send: () => {}, on: () => {}, invoke: () => Promise.resolve() },
  screen: { getAllDisplays: () => [{ bounds: { width: 1920, height: 1080 } }] },
};
require.cache[require.resolve('electron')] = { exports: electronStub, loaded: true, id: 'electron', filename: 'electron' };

console.log('Starting main module load...');
try {
  require('/Users/louloulin/multica/apps/desktop/out/main/index.js');
  console.log('Main loaded without throw');
} catch (err) {
  console.error('THROW at:', err.stack);
}