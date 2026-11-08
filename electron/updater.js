// Cek & pasang update dari GitHub Releases (electron-updater). Tidak pernah mengunduh atau restart sendiri:
// pengguna yang klik Unduh lalu Restart & pasang, supaya live tidak terputus.
// Tanpa import electron: updater (autoUpdater) diberikan pemanggil, jadi alur statusnya bisa dites di Node.
//
// status: dev (bukan installer) | idle | checking | none (sudah terbaru) | available | downloading | ready | error
// manual = cek dari tombol: hanya cek manual yang menampilkan error (cek saat start yang gagal, mis. offline, diam saja).

export function createUpdater({ updater, packaged, send, log = () => {} }) {
  let state = { status: packaged ? 'idle' : 'dev' };
  let manual = false, lastErr = null;
  const set = s => { state = s; send(state); };
  // electron-updater melaporkan error yang sama lewat event 'error' dan lewat promise yang ditolak: proses sekali saja
  const fail = e => {
    if (e && e === lastErr) return;
    lastErr = e;
    const raw = String(e?.message ?? e).split('\n')[0].slice(0, 160);
    log('update_error', { msg: raw, manual });
    const msg = /\b404\b/.test(raw) ? 'Belum ada rilis yang bisa diunduh.'
      : /net::|ENOTFOUND|ETIMEDOUT|ECONNRE|EAI_AGAIN/i.test(raw) ? 'Tidak bisa terhubung ke GitHub. Cek koneksi internet.'
      : raw;
    // error saat mengunduh selalu ditampilkan (pengguna sedang menunggu); error cek otomatis tidak
    set(manual || state.status === 'downloading' ? { status: 'error', msg } : { status: 'idle' });
  };

  if (packaged) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.logger = null;
    updater.on('checking-for-update', () => set({ status: 'checking' }));
    updater.on('update-available', info => { log('update_available', { version: info?.version }); set({ status: 'available', version: info?.version }); });
    updater.on('update-not-available', () => set({ status: 'none' }));
    updater.on('download-progress', p => set({ status: 'downloading', version: state.version, percent: Math.floor(p?.percent ?? 0) }));
    updater.on('update-downloaded', info => { log('update_ready', { version: info?.version }); set({ status: 'ready', version: info?.version ?? state.version }); });
    updater.on('error', fail);
  }

  return {
    state: () => state,
    check(isManual = false) {
      if (!packaged || ['checking', 'downloading', 'ready'].includes(state.status)) return state;
      manual = isManual;
      updater.checkForUpdates().catch(fail);
      return state;
    },
    download() {
      if (state.status !== 'available') return state;
      set({ status: 'downloading', version: state.version, percent: 0 });
      updater.downloadUpdate().catch(fail);
      return state;
    },
    install() {
      if (state.status !== 'ready') return false;
      log('update_install', { version: state.version });
      updater.quitAndInstall(true, true); // tanpa jendela installer, lalu buka Waku lagi
      return true;
    },
  };
}
