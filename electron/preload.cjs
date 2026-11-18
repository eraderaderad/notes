const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erad', {
  invoke: (name, payload) => ipcRenderer.invoke('api', name, payload),
  native: (action, arg) => ipcRenderer.invoke('native', action, arg),
});
