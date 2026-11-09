'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  on: (ch, fn) => ipcRenderer.on(ch, (_e, data) => fn(data)),
  send: (ch, data) => ipcRenderer.send(ch, data),
  invoke: (ch, data) => ipcRenderer.invoke(ch, data),
});
