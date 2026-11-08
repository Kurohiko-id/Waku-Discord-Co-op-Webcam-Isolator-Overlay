// Jembatan sempit untuk halaman picker: ambil daftar jendela/layar, kirim pilihan. Tidak ada akses Node lain.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  choose: id => ipcRenderer.send('picker:choose', id),
});
