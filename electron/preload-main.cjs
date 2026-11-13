// Jembatan sempit untuk halaman kontrol di aplikasi Electron (tab Atur: port). Di browser biasa objek ini tidak ada.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wakuApp', {
  info: () => ipcRenderer.invoke('app:info'),
  freePort: () => ipcRenderer.invoke('app:freePort'),
  setPort: port => ipcRenderer.invoke('app:setPort', port),
  lang: ipcRenderer.sendSync('app:getLang'), // bahasa tersimpan di aplikasi (atau bahasa Windows)
  setLang: l => ipcRenderer.send('app:setLang', l),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  installDeck: () => ipcRenderer.invoke('app:installDeck'), // buka file plugin Stream Deck; '' = berhasil
  deckOutdated: () => ipcRenderer.invoke('app:deckOutdated'), // true = plugin terpasang lebih lama dari bawaan Waku
  shortcuts: () => ipcRenderer.invoke('app:shortcuts'), // { list, failed }
  setShortcuts: keys => ipcRenderer.invoke('app:setShortcuts', keys),
  pauseShortcuts: paused => ipcRenderer.invoke('app:shortcutsPause', paused),
  setCapturing: on => ipcRenderer.send('app:capturing', on),
  onCommand: fn => ipcRenderer.on('app:cmd', (_e, cmd) => fn(cmd)), // shortcut global / Stream Deck
  bugReport: () => ipcRenderer.invoke('app:bugReport'), // menyalin ke clipboard, juga mengembalikan teksnya
  update: action => ipcRenderer.invoke('app:update', action), // 'state' | 'check' | 'download' | 'install'
  onUpdate: fn => ipcRenderer.on('app:update', (_e, s) => fn(s)),
});
