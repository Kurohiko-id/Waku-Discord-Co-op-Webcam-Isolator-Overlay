import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { validateLayout } from './public/shared/layout.js';
import { defaultPresets } from './public/shared/default-presets.js';
import { createDiscord } from './discord.js';
import { jsonFile, encryptedFile } from './secret-store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
// Gambar frame virtual: diunggah dari /control, disimpan di uploads/, dipakai /preview lewat /uploads/<nama>.
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const UPLOAD_NAME = /^[a-f0-9]{16}[.](png|jpg|gif|webp)$/;
const MAX_UPLOAD = 8 * 1024 * 1024;
const pages = { '/control': '/control.html', '/preview': '/preview.html' };

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '?'; } catch { return '?'; } })();

const emptyLayout = () => validateLayout({ slots: [] });
// File yang ada tapi rusak/tidak valid disalin ke .bad dulu: commit berikutnya akan menimpanya.
function readLayout(file, onBad) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return validateLayout({ slots: [], presets: defaultPresets() }); } // belum ada (instalasi baru): mulai dengan preset bawaan
  let v = null;
  try { v = validateLayout(JSON.parse(raw)); } catch { /* JSON rusak */ }
  if (v) return v;
  try { fs.copyFileSync(file, file + '.bad'); } catch { /* best-effort */ }
  onBad?.();
  return emptyLayout();
}

// Statistik anonim: fitur apa saja yang dipakai layout ini (hanya nama fitur, tanpa nama/akun/isi layout).
export function featureList(l) {
  const act = l.slots.filter(s => s.enabled), n = act.length, on = l.settings.detectEnabled;
  const f = [n <= 2 ? 'f_frames_1-2' : n <= 4 ? 'f_frames_3-4' : n <= 6 ? 'f_frames_5-6' : 'f_frames_7plus'];
  if (!on) f.push('f_detect_off');
  if (on && act.some(s => s.discordId)) f.push('f_official');
  if (on && act.some(s => s.detect && !s.discordId && !s.image)) f.push('f_manual');
  if (act.some(s => s.image)) f.push('f_virtual');
  if (l.settings.transitionMs === 0) f.push('f_transition_off');
  if (l.style?.label?.show) f.push('f_label');
  if (l.guides?.x?.length || l.guides?.y?.length) f.push('f_guides');
  for (const e of l.style?.speak?.effects ?? []) if (/^[a-z]{1,20}$/.test(e)) f.push('f_fx_' + e);
  return f;
}

// Preview tidak memakai preset dan garis bantu; jangan kirim ulang semuanya tiap drag.
const forPreview = ({ presets: _p, temp: _t, guides: _g, library: _l, ...rest }) => rest;

export function createServer({
  port = 1500,
  layoutFile = path.join(root, 'layout.json'),
  logFile = path.join(root, 'logs', 'waku.log'),
  logMaxBytes = 2 * 1024 * 1024,
  logKeep = 5, // jumlah berkas log yang disimpan (termasuk yang sedang ditulis)
  statsEveryMs = 30000,
  persistDelayMs = 300,
  // { clientId, clientSecret } milik pengguna sendiri, diisi dari tab Atur. Tanpa file ini hanya kotak hijau.
  // Mode `node server.js`: teks biasa. Aplikasi Electron mengenkripsinya (lihat secretKey).
  discordFile = null, // null = Discord mati (tes); server sungguhan memberi path-nya
  tokenFile = path.join(root, 'discord-token.json'),
  discordPipes, // hanya untuk tes; bawaan = pipe Discord sungguhan
  secretKey = null, // base64 32 byte dari aplikasi Electron (safeStorage); null = berkas JSON biasa
  uploadDir = path.join(root, 'uploads'),
  onFeatures = null, // Electron: daftar fitur dikirim ke proses utama untuk statistik anonim
} = {}) {
  const clients = new Map(); // ws -> 'control' | 'preview'
  const speakingNow = new Set(); // slotId yang sedang bicara: dikirim ulang ke preview yang baru connect/refresh
  let boundPort = port;
  let lastBusyLog = 0;

  // Log JSON-lines (satu peristiwa per baris) untuk diagnosis: delay deteksi, RAM, error, koneksi.
  // Dirotasi saat melebihi logMaxBytes: .1 paling baru ... .(logKeep-1) paling lama (bawaan 5 x 2 MB, kira-kira seminggu
  // pemakaian) supaya masalah lama masih bisa dianalisis. Gagal menulis tidak boleh mengganggu relay.
  let logBytes = 0;
  try { logBytes = fs.statSync(logFile).size; } catch { /* belum ada */ }
  const rotate = () => {
    for (let i = logKeep - 2; i >= 1; i--) { try { fs.renameSync(`${logFile}.${i}`, `${logFile}.${i + 1}`); } catch { /* belum ada */ } }
    try { fs.renameSync(logFile, logFile + '.1'); } catch {
      // .1 sedang dibuka program lain (EPERM/EBUSY di Windows): kosongkan saja supaya log tidak macet selamanya
      try { fs.truncateSync(logFile, 0); } catch { /* best-effort */ }
    }
    logBytes = 0;
  };
  const writeLog = (src, event, data = {}) => {
    try {
      if (!logBytes) fs.mkdirSync(path.dirname(logFile), { recursive: true }); // cukup sekali (dan setelah rotasi)
      if (logBytes > logMaxBytes) rotate();
      const { t: _t, src: _s, event: _e, ...rest } = data;
      const line = JSON.stringify({ t: new Date().toISOString(), src, event, ...rest }) + '\n';
      fs.appendFileSync(logFile, line);
      logBytes += Buffer.byteLength(line);
    } catch { /* best-effort */ }
  };
  const LOG_EVENT = /^[a-z_]{1,40}$/;
  const logOk = msg => LOG_EVENT.test(msg.event) && msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) && JSON.stringify(msg.data).length <= 2000;

  // Peringatan yang harus terlihat di /control (bukan hanya di log): layout rusak saat start, gagal menyimpan.
  let badNotice = '', saveNotice = '', credNotice = '';
  const notice = () => ({ type: 'notice', msg: [badNotice, saveNotice, credNotice].filter(Boolean).join(' ') });
  let layout = readLayout(layoutFile, () => {
    const backup = path.basename(layoutFile) + '.bad';
    writeLog('server', 'layout_invalid', { backup });
    badNotice = `${path.basename(layoutFile)} rusak dan tidak bisa dibaca, jadi editor mulai kosong. Isi lamanya disalin ke ${backup}.`;
  });

  // Tulis atomik (tmp + rename); gagal menulis tidak boleh mematikan relay.
  // Saat drag, layout datang ~20x/detik: cukup tulis sekali setelah tenang.
  let persistTimer = null;
  const writeNow = () => {
    clearTimeout(persistTimer);
    persistTimer = null;
    const tmp = layoutFile + '.tmp';
    const was = saveNotice;
    try {
      fs.writeFileSync(tmp, JSON.stringify(layout, null, 2));
      fs.renameSync(tmp, layoutFile);
      saveNotice = '';
    } catch (e) { // layout tetap di memori; dicoba lagi pada perubahan berikutnya
      writeLog('server', 'layout_save_error', { msg: String(e?.message).slice(0, 200) });
      saveNotice = 'Layout gagal disimpan ke disk (' + (e?.code || 'error') + '): perubahan hilang saat Waku ditutup.';
    }
    if (saveNotice !== was) sendTo('control', notice());
  };
  let deckSeen = false, lastFeat = '';
  const reportFeatures = (extra = []) => {
    if (!onFeatures) return;
    const list = [...featureList(layout), ...(deckSeen ? ['f_streamdeck'] : []), ...extra], k = list.join();
    if (k !== lastFeat) { lastFeat = k; onFeatures(list); }
  };
  reportFeatures();
  const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => { writeNow(); reportFeatures(); }, persistDelayMs); };

  // Browser selalu mengirim Origin pada WebSocket; hanya halaman kita sendiri yang boleh.
  const originOk = origin => {
    if (!origin) return true; // klien non-browser (tes, curl)
    try {
      const u = new URL(origin);
      return ['localhost', '127.0.0.1'].includes(u.hostname) && Number(u.port) === boundPort;
    } catch {
      return false;
    }
  };
  // DNS rebinding: domain asing yang diarahkan ke 127.0.0.1 tetap membawa Host-nya sendiri. Tolak semua kecuali alamat kita.
  const hostOk = host => {
    try {
      const u = new URL('http://' + host);
      return ['localhost', '127.0.0.1'].includes(u.hostname) && Number(u.port || 80) === boundPort;
    } catch {
      return false;
    }
  };
  // CSP: hanya kode dari server ini. Gaya inline dipakai editor; Worker detak deteksi dibuat dari blob.
  const csp = () => [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", "font-src 'self'", "worker-src blob:", `connect-src 'self' ws://localhost:${boundPort} ws://127.0.0.1:${boundPort}`,
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');

  // Origin wajib halaman kita sendiri (situs lain tidak boleh mengisi disk); ukuran dibatasi saat menerima.
  function upload(req, res) {
    const ext = IMAGE_EXT[String(req.headers['content-type']).split(';')[0]];
    // Body tetap dibaca habis sebelum menjawab: memutus di tengah upload membuat browser melihat koneksi putus, bukan pesan error.
    const fail = code => { req.resume(); req.on('end', () => res.writeHead(code).end()); };
    if (!originOk(req.headers.origin)) return fail(403);
    if (!ext) return fail(415);
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size <= MAX_UPLOAD) chunks.push(c); });
    req.on('end', () => {
      if (size > MAX_UPLOAD) return res.writeHead(413).end();
      const name = randomBytes(8).toString('hex') + ext;
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, name), Buffer.concat(chunks));
      } catch (e) {
        writeLog('server', 'upload_error', { msg: String(e?.message).slice(0, 200) });
        return res.writeHead(500).end();
      }
      writeLog('server', 'upload', { name, bytes: size });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ url: '/uploads/' + name }));
    });
  }

  const httpServer = http.createServer((req, res) => {
    let pathname;
    try { ({ pathname } = new URL(req.url, 'http://x')); } catch { return res.writeHead(400).end(); } // mis. GET //
    if (!hostOk(req.headers.host)) return res.writeHead(403).end();
    res.setHeader('x-content-type-options', 'nosniff'); // unggahan dengan MIME palsu tidak ditafsirkan sebagai skrip
    if (pathname === '/upload' && req.method === 'POST') return upload(req, res);
    if (pathname.startsWith('/uploads/')) {
      const name = path.basename(pathname);
      if (!UPLOAD_NAME.test(name)) return res.writeHead(404).end();
      return fs.readFile(path.join(uploadDir, name), (err, data) => {
        if (err) return res.writeHead(404).end();
        res.writeHead(200, { 'content-type': mime[path.extname(name)], 'cache-control': 'max-age=31536000, immutable' }).end(data); // nama acak: isi tidak pernah berubah
      });
    }
    const file = path.normalize(path.join(pub, pages[pathname] ?? pathname));
    if (!file.startsWith(pub + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      const ext = path.extname(file);
      res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream', ...(ext === '.html' && { 'content-security-policy': csp() }) }).end(data);
    });
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 1024 * 1024, // 16 slot + 50 preset bisa ~230 KB
    verifyClient: info => originOk(info.origin) && hostOk(info.req.headers.host),
  });
  // ws meneruskan error httpServer (mis. EADDRINUSE) ke wss; tanpa listener ini error dilempar sebagai uncaught
  // sebelum reject() di start() sempat jalan, sehingga start() menggantung. start() yang melaporkannya.
  wss.on('error', () => {});
  const sendTo = (role, msg) => {
    const data = JSON.stringify(msg);
    for (const [ws, r] of clients) if (r === role && ws.readyState === 1) ws.send(data);
  };
  const sendWs = (ws, msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
  // Status untuk plugin Stream Deck: dilaporkan halaman kontrol (preset, template, deteksi), diteruskan apa adanya setelah dirapikan.
  let deckState = null;
  const deckMsg = () => ({ type: 'state', control: !!latest('control'), state: deckState });
  const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
  const cleanDeckState = s => ({
    presets: (Array.isArray(s?.presets) ? s.presets : []).slice(0, 50).map(p => ({ id: str(p?.id), name: str(p?.name, 80) })),
    templates: (Array.isArray(s?.templates) ? s.templates : []).slice(0, 20).map(t => ({ key: str(t?.key), name: str(t?.name, 80) })),
    template: str(s?.template),
    detect: !!s?.detect,
  });
  const ID = /^[\w-]{1,64}$/;
  const cleanDeckAction = a => {
    if (a?.type === 'preset' && ID.test(a.id)) return { type: 'preset', id: a.id };
    if (a?.type === 'template') return ID.test(a.key) ? { type: 'template', key: a.key } : { type: 'template' };
    if (a?.type === 'detect') return ['on', 'off'].includes(a.set) ? { type: 'detect', set: a.set } : { type: 'detect' };
    return null;
  };
  // Signaling WebRTC hanya untuk koneksi terbaru per role (satu peer connection aktif).
  const latest = role => {
    let last;
    for (const [ws, r] of clients) if (r === role && ws.readyState === 1) last = ws;
    return last;
  };
  // Gambar unggahan: dipakai bila dirujuk frame virtual di layout, di preset mana pun, atau di daftar virtual frame tersimpan. Yang tidak dipakai boleh dihapus.
  function uploads(clean) {
    const used = new Set([...layout.slots, ...layout.presets.flatMap(p => p.slots), ...layout.library].map(x => x.image && path.basename(x.image)).filter(Boolean));
    const out = { count: 0, bytes: 0, unusedCount: 0, unusedBytes: 0, removed: 0 };
    let names = [];
    try { names = fs.readdirSync(uploadDir).filter(n => UPLOAD_NAME.test(n)); } catch { /* belum ada unggahan */ }
    for (const n of names) {
      let size = 0;
      try { size = fs.statSync(path.join(uploadDir, n)).size; } catch { continue; }
      if (!used.has(n) && clean) {
        try { fs.unlinkSync(path.join(uploadDir, n)); out.removed++; continue; } catch { /* dipakai program lain: biarkan */ }
      }
      out.count++; out.bytes += size;
      if (!used.has(n)) { out.unusedCount++; out.unusedBytes += size; }
    }
    if (clean) writeLog('server', 'uploads_clean', { removed: out.removed });
    return out;
  }

  const clearSpeaking = () => {
    for (const slotId of speakingNow) sendTo('preview', { type: 'speaking', slotId, speaking: false });
    speakingNow.clear();
  };

  // Status bicara langsung dari aplikasi Discord. Diteruskan ke /control, yang memetakan user ke slot
  // lewat jalur speaking yang sama dengan deteksi kotak hijau (log, glow editor, preview).
  // Secret tidak pernah dikirim ke halaman; control hanya tahu clientId (untuk mengisi form).
  const DC_ID = /^\d{15,25}$/, DC_SECRET = /^[\w-]{8,128}$/;
  // secretKey (aplikasi Electron): kredensial & token terenkripsi (.enc); berkas .json lama dienkripsi lalu dihapus.
  const store = f => (secretKey ? encryptedFile(f.replace(/\.json$/, '') + '.enc', secretKey, f) : jsonFile(f));
  const credStore = discordFile ? store(discordFile) : null;
  const tokenStore = store(tokenFile);
  if (secretKey) tokenStore.read(); // migrasi token teks biasa sekarang juga, jangan tunggu Discord login
  const readCreds = () => {
    const c = credStore?.read();
    if (credStore?.unreadable) { // kunci beda (data dipindah ke PC/akun lain): minta isi ulang, jangan error
      credNotice = 'Pengaturan Discord tidak bisa dibuka di PC ini (data dipindah?). Isi ulang Client ID dan Client Secret di tab Atur.';
      writeLog('server', 'discord_creds_unreadable', {});
    }
    if (!c) return null;
    if (DC_ID.test(c.clientId) && typeof c.clientSecret === 'string' && c.clientSecret) return { clientId: c.clientId, clientSecret: c.clientSecret };
    console.error('discord.json harus berisi clientId dan clientSecret');
    return null;
  };
  let creds = readCreds();
  let dc = null, listening = false;
  let discordState = { status: 'unset' };
  const dcMsg = () => ({ type: 'discord', ...discordState, clientId: creds?.clientId ?? '' });
  const startDiscord = () => {
    dc?.stop();
    dc = null;
    discordState = { status: 'unset' };
    if (creds) {
      const mine = createDiscord({
        ...creds, tokenStore, pipes: discordPipes, log: (e, d) => writeLog('server', e, d),
        onState: st => { if (dc !== mine) return; discordState = st; sendTo('control', dcMsg()); }, // dc lama yang sedang ditutup diam saja
        onSpeaking: (userId, speaking) => sendTo('control', { type: 'dspeak', userId, speaking }),
      });
      dc = mine;
      if (listening) dc.start();
    }
    sendTo('control', dcMsg());
  };
  const clearCredNotice = () => { if (credNotice) { credNotice = ''; sendTo('control', notice()); } };
  const setCreds = msg => {
    if (msg.clear === true) {
      creds = null;
      for (const s of [credStore, tokenStore]) try { s?.remove(); } catch { /* best-effort */ }
      // berkas teks biasa lama juga (kalau migrasi belum sempat terjadi)
      if (secretKey) for (const f of [discordFile, tokenFile]) try { if (f) fs.rmSync(f, { force: true }); } catch { /* best-effort */ }
      clearCredNotice();
      writeLog('server', 'discord_creds_cleared', {});
      return startDiscord();
    }
    const clientId = typeof msg.clientId === 'string' ? msg.clientId.trim() : '';
    let clientSecret = typeof msg.clientSecret === 'string' ? msg.clientSecret.trim() : '';
    if (!clientSecret && clientId === creds?.clientId) clientSecret = creds.clientSecret; // kosong = tetap pakai yang tersimpan
    if (!DC_ID.test(clientId) || !DC_SECRET.test(clientSecret)) return writeLog('server', 'discord_creds_rejected', {});
    const idChanged = clientId !== creds?.clientId;
    try {
      if (!credStore) throw new Error('penyimpanan Discord tidak diatur');
      credStore.write({ clientId, clientSecret });
    } catch (e) {
      return sendTo('control', { type: 'notice', msg: 'Gagal menyimpan pengaturan Discord: ' + String(e?.message).slice(0, 120) });
    }
    if (idChanged) try { tokenStore.remove(); } catch { /* token milik aplikasi lama, izin diminta ulang */ }
    creds = { clientId, clientSecret };
    clearCredNotice();
    writeLog('server', 'discord_creds_set', { idChanged });
    startDiscord();
  };
  startDiscord();

  wss.on('connection', (ws, req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const role = { control: 'control', deck: 'deck' }[q.get('role')] ?? 'preview';
    const peer = role === 'control' ? 'preview' : 'control';
    ws.on('error', err => writeLog('server', 'ws_error', { role, msg: String(err?.message).slice(0, 200) }));

    // Plugin Stream Deck: hanya boleh mengirim perintah (dijalankan halaman kontrol) dan menerima status.
    // Browser selalu membawa Origin, jadi website lain sudah ditolak verifyClient.
    if (role === 'deck') {
      clients.set(ws, role);
      writeLog('server', 'conn_open', { role });
      sendWs(ws, deckMsg());
      deckSeen = true; reportFeatures();
      ws.on('close', () => { clients.delete(ws); writeLog('server', 'conn_close', { role }); });
      ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const a = msg?.type === 'cmd' ? cleanDeckAction(msg.action) : null;
        if (!a) return;
        writeLog('server', 'deck_cmd', a);
        const c = latest('control');
        if (c) sendWs(c, { type: 'cmd', action: a });
        else sendWs(ws, { type: 'error', error: 'no_control' });
      });
      return;
    }

    // Satu control aktif: tab kedua bisa menimpa layout dan merebut signaling dari tab yang sedang capture.
    // Tab yang sudah ada menang; tab baru hanya masuk bila diminta mengambil alih.
    if (role === 'control') {
      const others = [...clients].filter(([o, r]) => r === 'control' && o.readyState === 1).map(([o]) => o);
      if (others.length && q.get('takeover') !== '1') {
        // tab lama dengan kode lama bisa terus mencoba tiap 1-2 detik: catat paling sering sekali per 30 detik
        if (Date.now() - lastBusyLog > 30000) { lastBusyLog = Date.now(); writeLog('server', 'control_busy', {}); }
        sendWs(ws, { type: 'busy' });
        ws.close(4001, 'busy');
        return;
      }
      if (others.length) {
        writeLog('server', 'control_takeover', { replaced: others.length });
        for (const o of others) { clients.delete(o); o.close(4000, 'replaced'); }
        clearSpeaking(); // status bicara milik tab lama
      }
    }

    clients.set(ws, role);
    writeLog('server', 'conn_open', { role });
    let budget = 60; // batas laju log per koneksi: isi ulang 20/detik, maksimal 60
    let lastLog = Date.now();
    sendWs(ws, { type: 'layout', layout: role === 'preview' ? forPreview(layout) : layout });
    if (role === 'control') sendWs(ws, { type: 'info', version: VERSION });
    if (role === 'control' && (badNotice || saveNotice || credNotice)) sendWs(ws, notice());
    if (role === 'preview') for (const slotId of speakingNow) sendWs(ws, { type: 'speaking', slotId, speaking: true });
    if (role === 'control') sendWs(ws, dcMsg());

    ws.on('close', () => {
      if (!clients.has(ws)) return; // sudah digantikan (takeover)
      // readyState sudah CLOSED di sini, jadi latest() tidak bisa dipakai untuk diri sendiri.
      const wasLatestPreview = role === 'preview' && [...clients].filter(([, r]) => r === 'preview').at(-1)?.[0] === ws;
      clients.delete(ws);
      writeLog('server', 'conn_close', { role });
      if (role === 'control') sendTo('deck', deckMsg()); // tombol Stream Deck tahu Waku sedang tidak bisa menjalankan perintah
      if (role === 'control' && !latest('control')) clearSpeaking(); // tidak ada lagi yang akan mengirim speaking:false
      else if (wasLatestPreview && latest('preview')) sendWs(latest('control'), { type: 'ready' }); // preview sebelumnya aktif lagi
    });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'log') {
        const now = Date.now();
        budget = Math.min(60, budget + (now - lastLog) * 0.02);
        lastLog = now;
        if (budget >= 1 && logOk(msg)) { budget--; writeLog(role, msg.event, msg.data); }
      } else if (msg.type === 'layout' && role === 'control') {
        const v = validateLayout(msg.layout);
        if (!v) { writeLog('server', 'layout_rejected', {}); return; }
        layout = v;
        persist();
        if (msg.transition === true) reportFeatures(['f_preset_switch']);
        sendTo('preview', { type: 'layout', layout: forPreview(layout), transition: msg.transition === true }); // true = pindah preset, dianimasikan
      } else if (msg.type === 'speaking' && role === 'control') {
        if (typeof msg.slotId === 'string' && typeof msg.speaking === 'boolean') {
          if (msg.speaking) speakingNow.add(msg.slotId); else speakingNow.delete(msg.slotId);
          // t = stempel waktu pengirim; preview memakainya untuk mengukur latensi (kedua halaman satu PC, jam sama)
          sendTo('preview', { type: 'speaking', slotId: msg.slotId, speaking: msg.speaking, t: typeof msg.t === 'number' ? msg.t : undefined });
        }
      } else if ((msg.type === 'uploads_info' || msg.type === 'uploads_clean') && role === 'control') {
        sendWs(ws, { type: 'uploads', ...uploads(msg.type === 'uploads_clean') });
      } else if (msg.type === 'deck_state' && role === 'control') {
        deckState = cleanDeckState(msg.state);
        sendTo('deck', deckMsg());
      } else if (msg.type === 'discord_retry' && role === 'control') {
        dc?.retry();
      } else if (msg.type === 'discord_creds' && role === 'control') {
        setCreds(msg);
      } else if (msg.type === 'signal') {
        const to = latest(peer);
        if (to) sendWs(to, { type: 'signal', data: msg.data });
        else if (role === 'control') sendWs(ws, { type: 'no_preview' }); // control berhenti mengulang offer sampai preview kirim 'ready'
      } else if (msg.type === 'ready' && role === 'preview' && ws === latest('preview')) {
        sendWs(latest('control'), { type: 'ready' });
      } else if (msg.type === 'visible' && role === 'preview' && ws === latest('preview')) {
        sendWs(latest('control'), { type: 'visible', on: msg.on !== false }); // hanya preview yang menerima video
      }
    });
  });

  let statsTimer;
  const stats = () => {
    const m = process.memoryUsage();
    const count = role => [...clients.values()].filter(r => r === role).length;
    writeLog('server', 'server_stats', {
      rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), uptimeS: Math.round(process.uptime()),
      clients: { control: count('control'), preview: count('preview') },
    });
  };

  return {
    log: writeLog,
    start: () =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject); // mis. EADDRINUSE: port sudah dipakai server lain
        httpServer.listen(port, '127.0.0.1', () => {
          httpServer.off('error', reject);
          boundPort = httpServer.address().port;
          // version: laporan bug dari pengguna harus bisa dicocokkan dengan kode versi itu
          writeLog('server', 'server_start', { version: VERSION, port: boundPort, node: process.version, pid: process.pid, platform: process.platform });
          if (statsEveryMs > 0) { statsTimer = setInterval(stats, statsEveryMs); statsTimer.unref(); }
          listening = true;
          dc?.start();
          resolve(boundPort);
        });
      }),
    close: () =>
      new Promise(resolve => {
        clearInterval(statsTimer);
        dc?.stop();
        if (persistTimer) writeNow();
        for (const ws of clients.keys()) ws.terminate();
        wss.close(() => httpServer.close(() => resolve()));
      }),
  };
}

// Dijalankan langsung (node server.js) atau oleh Electron lewat utilityProcess (process.parentPort ada).
// WAKU_DATA = folder data (Electron: userData); tanpa itu data di folder aplikasi seperti dulu.
if (process.argv[1] === fileURLToPath(import.meta.url) || process.parentPort) {
  const data = process.env.WAKU_DATA || root;
  // kunci data dari aplikasi Electron: dipakai lalu dibuang dari env supaya tidak ikut ke proses lain/laporan
  const secretKey = process.env.WAKU_KEY || null;
  delete process.env.WAKU_KEY;
  const srv = createServer({
    port: Number(process.env.PORT) || 1500,
    layoutFile: path.join(data, 'layout.json'),
    logFile: path.join(data, 'logs', 'waku.log'),
    uploadDir: path.join(data, 'uploads'),
    discordFile: path.join(data, 'discord.json'),
    tokenFile: path.join(data, 'discord-token.json'),
    secretKey,
    onFeatures: list => process.parentPort?.postMessage({ type: 'features', list }),
  });
  // Jaring pengaman: satu bug di handler tidak boleh mematikan overlay saat live.
  process.on('uncaughtException', e => { console.error(e); srv.log('server', 'uncaught', { msg: String(e?.stack ?? e).slice(0, 500) }); });
  let port;
  try {
    port = await srv.start();
  } catch (e) {
    console.error(e.code === 'EADDRINUSE' ? `Port ${e.port} sudah dipakai (server Waku lain masih jalan?).` : e);
    process.parentPort?.postMessage({ type: 'error', code: e.code ?? 'error', port: e.port });
    process.exit(1);
  }
  process.parentPort?.postMessage({ type: 'ready', port });
  console.log(`Kontrol : http://localhost:${port}/control`);
  console.log(`Preview : http://localhost:${port}/preview  (Browser Source OBS 1920x1080)`);
}
