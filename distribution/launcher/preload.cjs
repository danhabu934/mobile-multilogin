const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('nexoDiagnostics', {inspect: () => ipcRenderer.invoke('host:inspect')});
