// Shortcut global (juga untuk tombol Hotkey Stream Deck), diatur sendiri oleh pengguna; awalnya kosong.
// Setiap baris: { key: accelerator Electron, action: { type: 'preset', id } | { type: 'template', key? } | { type: 'detect' } }.
// Aksinya dijalankan oleh halaman kontrol, walau jendelanya disembunyikan.
// Tanpa import electron: globalShortcut dan penyimpanan diberikan pemanggil, jadi validasinya bisa dites di Node.

const KEY_RE = /^(?:(?:Control|Alt|Shift|Super)\+){0,4}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|num[0-9])$/;
const ID_RE = /^[\w-]{1,64}$/;

// Baris shortcut yang bersih (hanya bidang yang dikenal), atau null bila tidak valid.
export function cleanShortcut(s) {
  const a = s?.action;
  if (typeof s?.key !== 'string' || !KEY_RE.test(s.key) || !a) return null;
  if (a.type === 'preset' && ID_RE.test(a.id)) return { key: s.key, action: { type: 'preset', id: a.id } };
  if (a.type === 'template') return { key: s.key, action: ID_RE.test(a.key) ? { type: 'template', key: a.key } : { type: 'template' } };
  if (a.type === 'detect') return { key: s.key, action: { type: 'detect' } };
  return null;
}

// send(action): kirim aksi ke halaman kontrol. log(event, data): catat kombinasi yang gagal didaftarkan.
export function createShortcuts({ globalShortcut, readSettings, saveSettings, send, log }) {
  let fails = []; // kombinasi yang gagal didaftarkan (dipakai program lain)
  const list = () => { const l = readSettings().shortcuts; return Array.isArray(l) ? l.map(cleanShortcut).filter(Boolean) : []; };
  const state = () => ({ list: list(), failed: fails });
  function register() {
    globalShortcut.unregisterAll();
    fails = list().filter(({ key, action }) => {
      try { return !globalShortcut.register(key, () => send(action)); } catch { return true; }
    }).map(s => s.key);
    if (fails.length) log('shortcut_fail', { keys: fails });
  }
  return {
    register,
    state,
    // Saat popup pengaturan terbuka, shortcut dilepas supaya menekan kombinasi tidak langsung menjalankan aksinya.
    pause(paused) { if (paused) globalShortcut.unregisterAll(); else register(); return state(); },
    set(input) {
      if (!Array.isArray(input) || input.length > 50) return null;
      const clean = input.map(cleanShortcut);
      if (clean.includes(null)) return { ...state(), error: 'invalid' };
      if (new Set(clean.map(s => s.key)).size !== clean.length) return { ...state(), error: 'duplicate' };
      saveSettings({ shortcuts: clean });
      register();
      return state();
    },
    clear: () => globalShortcut.unregisterAll(),
  };
}
