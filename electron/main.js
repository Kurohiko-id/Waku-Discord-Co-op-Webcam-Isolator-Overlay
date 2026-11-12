// Proses utama Electron: menjalankan server Waku di utilityProcess (data di userData) dan membuka /control.
// `electron . --encoder-check` hanya mengecek encoder video (H264/hardware) lalu keluar.
import { app, BrowserWindow, utilityProcess, shell, session, desktopCapturer, dialog, ipcMain, Tray, Menu, clipboard, safeStorage, crashReporter, globalShortcut, screen } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logDir, mainLog, errMsg, readSettings, saveSettings } from './settings.js';
import { createShortcuts } from './shortcuts.js';
import { bugReport } from './bug-report.js';
import { createUpdater } from './updater.js';
import { centerIn } from './placement.js';
import { createStats } from './stats.js';
import updaterPkg from 'electron-updater';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = !app.isPackaged && process.argv.includes('--encoder-check'); // alat developer, tidak ada di installer

// Port di settings.json tidak pernah berubah sendiri: hanya lewat pilihan pengguna.
const DEFAULT_PORT = 6966;
const validPort = p => Number.isInteger(p) && p >= 1024 && p <= 65535;
const portFree = p => new Promise(res => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
});
async function freePort() { // dekat port bawaan dulu supaya mudah diingat, kalau penuh biarkan OS memilih
  for (let p = DEFAULT_PORT + 1; p < DEFAULT_PORT + 40; p++) if (await portFree(p)) return p;
  return new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); }); });
}
let PORT = validPort(Number(process.env.PORT)) ? Number(process.env.PORT) : validPort(readSettings().port) ? readSettings().port : DEFAULT_PORT;

// Jendela Waku boleh tertutup jendela lain/game: Chromium tidak boleh memperlambat timer, capture, dan encoder.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!CHECK && !app.requestSingleInstanceLock()) app.quit();
// Chromium menyembunyikan nama encoder kecuali halaman punya izin kamera: mode cek memakai kamera palsu.
if (CHECK) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }

// Sekali saja: data dari folder aplikasi lama (versi `node server.js`) disalin ke userData. Yang lama tidak dihapus.
function migrate(data) {
  if (fs.existsSync(path.join(data, 'layout.json')) || !fs.existsSync(path.join(root, 'layout.json'))) return;
  fs.mkdirSync(data, { recursive: true });
  for (const f of ['layout.json', 'discord.json', 'discord-token.json', 'uploads']) {
    const from = path.join(root, f);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(data, f), { recursive: true });
  }
}

let win = null, server = null, quitting = false, tray = null, origin = '', stats = null;
// Bandingkan origin utuh: startsWith('http://localhost:1500') juga lolos untuk localhost:15000 atau localhost:1500.evil.com.
const isOwn = url => { try { return new URL(url).origin === origin; } catch { return false; } };
const ICON = path.join(root, 'build', 'icon.ico'); // .ico berisi 16-256 px: Windows tidak mengecilkan sendiri (hasilnya bergerigi)
// Bahasa aplikasi (tombol ID/EN di kontrol) disimpan di settings.json. Belum dipilih: bahasa yang dipilih
// di installer (berkas install-lang di folder aplikasi, ditulis build/installer.nsh), lalu bahasa Windows.
const sysLang = () => (app.getPreferredSystemLanguages()[0] ?? '').toLowerCase().startsWith('id') ? 'id' : 'en';
const installLang = () => { try { return fs.readFileSync(path.join(path.dirname(app.getPath('exe')), 'install-lang'), 'utf8').trim(); } catch { return ''; } };
const appLang = () => {
  for (const l of [readSettings().lang, installLang()]) if (l === 'id' || l === 'en') return l;
  return sysLang();
};
let port = 0;
// jendela bisa hilang (window.close() dari halaman, renderer crash): buat lagi, server tetap jalan
const showWin = () => { if (!win) { if (port) createWindow(port); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); };

// Close = sembunyi ke tray: capture, deteksi bicara, dan video ke OBS tetap jalan. Keluar lewat menu tray.
const TRAY_T = {
  id: { open: 'Buka Waku', copy: 'Salin link OBS', stop: 'Hentikan capture', quit: 'Keluar', hidden: 'Waku masih berjalan di sini. Capture dan video ke OBS tetap jalan; keluar lewat menu ikon ini.' },
  en: { open: 'Open Waku', copy: 'Copy OBS link', stop: 'Stop capture', quit: 'Quit', hidden: 'Waku is still running here. Capture and video to OBS keep going; quit from this icon’s menu.' },
};
let hintShown = false, capturing = false; // capturing: dilaporkan halaman kontrol
function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip('Waku');
  tray.on('click', showWin);
  tray.on('right-click', async () => {
    const t = TRAY_T[appLang()];
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: t.open, click: showWin },
      { label: t.copy, click: () => clipboard.writeText(origin + '/preview') },
      ...(capturing && win ? [{ label: t.stop, click: () => win?.webContents.send('app:cmd', { type: 'capture' }) }] : []),
      { type: 'separator' },
      { label: t.quit, click: () => app.quit() },
    ]));
  });
}

const PORT_T = {
  id: {
    busy: p => `Port ${p} sudah dipakai program lain.`,
    busyDetail: 'Mungkin Waku lain masih jalan, atau program lain memakai port ini. Waku bisa pindah ke port kosong; alamat Browser Source di OBS perlu diganti setelahnya.',
    useFree: 'Pakai port kosong lain', retry: 'Coba lagi', quit: 'Keluar',
    moved: p => `Waku sekarang memakai port ${p}.`, obs: p => `Ganti alamat Browser Source di OBS menjadi:\nhttp://localhost:${p}/preview\n\nPort bisa diubah lagi di tab Atur.`,
    failed: 'Server Waku gagal berjalan: ',
  },
  en: {
    busy: p => `Port ${p} is already in use by another program.`,
    busyDetail: 'Another Waku may still be running, or another program uses this port. Waku can move to a free port; you’ll need to update the Browser Source address in OBS afterwards.',
    useFree: 'Use another free port', retry: 'Try again', quit: 'Quit',
    moved: p => `Waku now uses port ${p}.`, obs: p => `Change the Browser Source address in OBS to:\nhttp://localhost:${p}/preview\n\nYou can change the port again in the Settings tab.`,
    failed: 'The Waku server failed to start: ',
  },
};

// Kunci data (32 byte acak) untuk kredensial & token Discord. Kunci itu sendiri disimpan terenkripsi oleh
// safeStorage (DPAPI, terikat akun Windows) di key.bin; server memakai AES-GCM (secret-store.js).
// Tidak bisa dibuka (mis. data dipindah ke PC lain): buat kunci baru; server meminta isi ulang kredensial.
// safeStorage tidak tersedia: tanpa kunci, server memakai berkas JSON biasa seperti versi browser.
let keyCache;
function dataKey() {
  if (keyCache !== undefined) return keyCache;
  keyCache = null;
  if (!safeStorage.isEncryptionAvailable()) { console.error('safeStorage tidak tersedia: kredensial Discord tidak dienkripsi'); return null; }
  const file = path.join(app.getPath('userData'), 'key.bin');
  try { keyCache = safeStorage.decryptString(fs.readFileSync(file)); } catch { /* belum ada / tidak bisa dibuka */ }
  if (!keyCache || Buffer.from(keyCache, 'base64').length !== 32) {
    keyCache = crypto.randomBytes(32).toString('base64');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage.encryptString(keyCache));
  }
  return keyCache;
}

let expectExit = false; // server dimatikan sengaja (pindah port / gagal start): jangan dihidupkan ulang otomatis
function startServer(onReady) {
  expectExit = false;
  const child = utilityProcess.fork(path.join(root, 'server.js'), [], {
    env: { ...process.env, WAKU_DATA: app.getPath('userData'), PORT: String(PORT), ...(dataKey() ? { WAKU_KEY: dataKey() } : {}) },
    serviceName: 'Waku server',
  });
  server = child;
  child.on('message', m => {
    if (m?.type === 'ready') onReady(m.port);
    else if (m?.type === 'error') { expectExit = true; onStartError(m.code, onReady); }
    else if (m?.type === 'features' && Array.isArray(m.list)) stats?.features([...m.list, ...(readSettings().shortcuts?.length ? ['f_shortcuts'] : [])]);
  });
  // Server mati tak terduga: hidupkan lagi; halaman kontrol menyambung ulang sendiri.
  child.on('exit', code => {
    if (server === child) server = null;
    if (quitting || expectExit) return;
    console.error('server berhenti, kode', code);
    mainLog('server_exit', { code });
    setTimeout(() => startServer(() => {}), 1000);
  });
}

async function onStartError(code, onReady) {
  const t = PORT_T[appLang()];
  if (code !== 'EADDRINUSE') { dialog.showErrorBox('Waku', t.failed + code); quitting = true; return app.quit(); }
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'Waku', message: t.busy(PORT), detail: t.busyDetail,
    buttons: [t.useFree, t.retry, t.quit], defaultId: 0, cancelId: 2, noLink: true,
  });
  if (response === 2) { quitting = true; return app.quit(); }
  if (response === 0) {
    PORT = await freePort();
    saveSettings({ port: PORT });
    await dialog.showMessageBox({ type: 'info', title: 'Waku', message: t.moved(PORT), detail: t.obs(PORT), noLink: true });
  }
  startServer(onReady);
}

// Ganti port dari tab Atur: server dihidupkan ulang di port baru, halaman kontrol pindah origin.
// localStorage terikat origin, jadi pengaturan per-browser (bahasa, safe zone) dibawa pindah.
async function switchPort(p) {
  const keep = (await win?.webContents.executeJavaScript('JSON.stringify(Object.entries(localStorage))').catch(() => null)) ?? '[]';
  PORT = p;
  saveSettings({ port: p });
  expectExit = true;
  const old = server;
  if (old) await new Promise(r => { old.once('exit', r); old.kill(); });
  startServer(newPort => {
    port = newPort;
    if (!win) return createWindow(newPort);
    origin = `http://localhost:${newPort}`;
    win.webContents.once('did-finish-load', async () => {
      const restored = await win.webContents.executeJavaScript(
        `(() => { let n = 0; for (const [k, v] of ${keep}) if (localStorage.getItem(k) !== v) { localStorage.setItem(k, v); n++; } return n; })()`,
      ).catch(() => 0);
      if (restored) win.webContents.reload();
    });
    win.loadURL(origin + '/control');
  });
}

// API kecil untuk tab Atur (lewat preload-main.cjs). Hanya jendela kontrol yang boleh memanggil.
const fromMain = e => !!win && e.sender === win.webContents;
ipcMain.handle('app:info', e => (fromMain(e) ? { port, defaultPort: DEFAULT_PORT } : null));
// sinkron: i18n di halaman butuh bahasa sebelum menerjemahkan apa pun
ipcMain.on('app:getLang', e => { e.returnValue = fromMain(e) ? appLang() : null; });
ipcMain.on('app:capturing', (e, on) => { if (fromMain(e)) capturing = !!on; });
ipcMain.on('app:setLang', (e, l) => { if (fromMain(e) && (l === 'id' || l === 'en')) saveSettings({ lang: l }); });
ipcMain.handle('app:openLogs', e => (fromMain(e) ? shell.openPath(logDir()) : null));
// Plugin Stream Deck: file .streamDeckPlugin ikut di installer (extraResources); membukanya = aplikasi Stream Deck memasangnya.
// Saat dev (npm run app) dipakai hasil npm run deck. Hasil: '' = berhasil dibuka, selain itu pesan error.
ipcMain.handle('app:installDeck', async e => {
  if (!fromMain(e)) return null;
  const name = 'id.kurohiko.waku.streamDeckPlugin';
  const file = app.isPackaged ? path.join(process.resourcesPath, name) : path.join(root, 'dist', 'deck', name);
  if (!fs.existsSync(file)) return 'missing';
  const err = await shell.openPath(file);
  mainLog('deck_install', { ok: !err, err: err || undefined });
  return err;
});
ipcMain.handle('app:bugReport', async e => {
  if (!fromMain(e)) return null;
  const text = await bugReport({ port, lang: appLang() });
  clipboard.writeText(text);
  return text;
});

const shortcuts = createShortcuts({ globalShortcut, readSettings, saveSettings, log: mainLog, send: action => win?.webContents.send('app:cmd', action) });
ipcMain.handle('app:shortcuts', e => (fromMain(e) ? shortcuts.state() : null));
ipcMain.handle('app:shortcutsPause', (e, paused) => (fromMain(e) ? shortcuts.pause(paused) : null));
ipcMain.handle('app:setShortcuts', (e, list) => (fromMain(e) ? shortcuts.set(list) : null));
app.on('will-quit', shortcuts.clear);

// Update dari GitHub Releases: dicek sekali saat Waku dibuka; unduh dan pasang hanya lewat tombol di halaman kontrol.
const updates = createUpdater({
  updater: app.isPackaged ? updaterPkg.autoUpdater : null, packaged: app.isPackaged,
  log: mainLog, send: s => win?.webContents.send('app:update', { ...s, current: app.getVersion() }),
  store: (() => { // pilihan popup update (versi yang dilewati, hari terakhir popup muncul)
    const file = path.join(app.getPath('userData'), 'update-prefs.json');
    return {
      get: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } },
      set: v => { try { fs.writeFileSync(file, JSON.stringify(v)); } catch { /* popup bisa muncul lagi besok, tidak apa-apa */ } },
    };
  })(),
});
ipcMain.handle('app:update', (e, action) => {
  if (!fromMain(e)) return null;
  if (action === 'check') return updates.check(true);
  if (action === 'download') return updates.download();
  if (action === 'skip') return updates.skip();
  if (action === 'seen') return { ...updates.seen(), current: app.getVersion() };
  if (action === 'install') { if (updates.state().status === 'ready') quitting = true; return updates.install(); } // jendela tidak sembunyi ke tray
  return { ...updates.state(), current: app.getVersion() };
});
ipcMain.handle('app:freePort', e => (fromMain(e) ? freePort() : null));
ipcMain.handle('app:setPort', async (e, value) => {
  if (!fromMain(e)) return { ok: false, error: 'denied' };
  const p = Number(value);
  if (!validPort(p)) return { ok: false, error: 'invalid' };
  if (p === port) return { ok: true, same: true };
  if (!(await portFree(p))) return { ok: false, error: 'busy' };
  setTimeout(() => switchPort(p), 150); // balas dulu sebelum halaman dimuat ulang
  return { ok: true };
});

function createWindow(port) {
  origin = `http://localhost:${port}`;
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700, icon: ICON,
    backgroundColor: '#111111', title: 'Waku', autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload-main.cjs'),
    },
  });
  win.on('close', async e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!hintShown && tray) { hintShown = true; tray.displayBalloon({ iconType: 'info', title: 'Waku', content: TRAY_T[appLang()].hidden }); }
  });
  // Link luar (Saweria, Developer Portal) dibuka di browser biasa; jendela ini hanya memuat Waku.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isOwn(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isOwn(url)) e.preventDefault(); });
  win.on('closed', () => { win = null; capturing = false; });
  win.loadURL(origin + '/control');
}

// Picker capture sendiri (Electron tidak punya picker bawaan di Windows). Pilihan terakhir diingat selama app jalan.
let pickerWin = null, lastPick = null;
const here = path.dirname(fileURLToPath(import.meta.url));
// Jendela aplikasi Discord berjudul "Discord" atau "... - Discord"; tab browser ("Discord Developer Portal - Chrome") bukan.
const isDiscordWindow = name => /(^|\s-\s)Discord$/i.test(name.trim());

ipcMain.handle('picker:sources', async e => {
  if (e.sender !== pickerWin?.webContents) return { sources: [], last: null };
  const own = new Set([win, pickerWin].filter(Boolean).map(w => w.getMediaSourceId()));
  const list = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
  const sources = list
    .filter(s => s.name && !own.has(s.id))
    .map(s => ({
      id: s.id, name: s.name, screen: s.id.startsWith('screen:'), discord: !s.id.startsWith('screen:') && isDiscordWindow(s.name),
      thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(), icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }))
    .sort((a, b) => b.discord - a.discord); // Discord paling depan; urutan lain dari OS
  return { sources, last: lastPick };
});

// Posisi popup: di tengah jendela Waku dan di monitor yang sama (tanpa ini Windows menaruhnya di tengah monitor utama).
// Tetap di dalam area kerja monitor itu. Jendela Waku tersembunyi di tray: monitor tempat kursor berada.
function centeredOn(parent, width, height) {
  const shown = parent && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized();
  const b = shown ? parent.getBounds() : null;
  const area = (b ? screen.getDisplayMatching(b) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
  return centerIn(b ?? area, area, width, height);
}

function pickSource() {
  return new Promise(resolve => {
    pickerWin?.close(); // permintaan capture baru menggantikan picker yang masih terbuka
    const w = new BrowserWindow({
      parent: win ?? undefined, modal: !!win, show: false, ...centeredOn(win, 860, 620), minWidth: 520, minHeight: 400,
      minimizable: false, maximizable: false, autoHideMenuBar: true, backgroundColor: '#111111', title: 'Waku',
      webPreferences: { preload: path.join(here, 'preload-picker.cjs'), sandbox: true, contextIsolation: true },
    });
    pickerWin = w;
    let result = null;
    const onChoose = (e, id) => { if (e.sender === w.webContents) { result = typeof id === 'string' ? id : null; w.close(); } };
    ipcMain.on('picker:choose', onChoose);
    w.on('closed', () => { ipcMain.off('picker:choose', onChoose); if (pickerWin === w) pickerWin = null; resolve(result); });
    w.webContents.on('will-navigate', e => e.preventDefault());
    w.once('ready-to-show', () => w.show());
    w.loadFile(path.join(here, 'picker.html'), { query: { lang: appLang() } });
  });
}

// Izin browser: hanya yang dipakai halaman Waku sendiri (capture, salin teks). Selain itu ditolak.
const ALLOWED = new Set(['media', 'display-capture', 'clipboard-sanitized-write']);
const allowed = (permission, url) => ALLOWED.has(permission) && isOwn(url);

function captureHandler() {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed(permission, wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed(permission, requestingOrigin));
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const id = await pickSource();
    // null = tolak (getDisplayMedia di halaman gagal dengan AbortError = "Capture dibatalkan").
    // cb({}) juga menolak, tapi Electron melempar "Video was requested..." yang tercatat sebagai error di main.log.
    if (!id) return cb(null);
    // ambil ulang tanpa thumbnail: jendela bisa saja sudah ditutup selama picker terbuka
    const src = (await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } })).find(s => s.id === id);
    if (!src) return cb(null);
    lastPick = { id: src.id, name: src.name };
    cb({ video: src });
  });
}

// Crash lokal saja: minidump di folder Crashpad (userData), tidak pernah dikirim ke mana pun.
if (!CHECK) crashReporter.start({ uploadToServer: false });
process.on('uncaughtException', e => { console.error(e); mainLog('uncaught', { msg: errMsg(e) }); stats?.error(e); });
process.on('unhandledRejection', e => { console.error(e); mainLog('unhandled_rejection', { msg: errMsg(e) }); stats?.error(e); });
app.on('render-process-gone', (_e, _wc, d) => mainLog('render_gone', { reason: d.reason, code: d.exitCode }));
app.on('child-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') mainLog('child_gone', { type: d.type, reason: d.reason, code: d.exitCode, name: d.name }); });

app.whenReady().then(() => {
  if (CHECK) return import('./encoder-check.js').then(m => m.encoderCheck());
  mainLog('app_start', { version: app.getVersion(), electron: process.versions.electron });
  const data = app.getPath('userData');
  migrate(data);
  stats = createStats({ version: app.getVersion(), dir: data, enabled: app.isPackaged });
  stats.start();
  captureHandler();
  startServer(p => { if (!port) { port = p; createWindow(p); createTray(); shortcuts.register(); setTimeout(() => updates.check(), 8000); } });
});

app.on('second-instance', showWin); // membuka Waku lagi saat sudah jalan: tampilkan jendela yang ada
app.on('before-quit', () => { quitting = true; server?.kill(); });
app.on('window-all-closed', () => {}); // tetap jalan di tray; keluar hanya lewat menu tray (app.quit)
