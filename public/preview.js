import { connect } from '/shared/ws.js';
import { resolveStyle } from '/shared/style.js';
import { buildTile, updateTile } from '/shared/tile-dom.js';
import { Stat, createLogger, watchIce } from '/shared/log.js';
import { iceDone } from '/shared/rtc.js';

const v = document.getElementById('v');
const root = document.getElementById('root');
let layout = { slots: [], settings: { animate: true } };
const tiles = new Map(); // slotId -> { el, canvas, ctx }
const speaking = new Set();
let pc = null;
let hideTimer = 0;

const ws = connect('preview', onMsg, ok => { if (ok) { ws.send({ type: 'ready' }); log('ws_open', {}); } });
const log = createLogger(ws);
log('session_start', { ua: navigator.userAgent, screen: screen.width + 'x' + screen.height, dpr: devicePixelRatio });
const latStat = new Stat(); // latensi pesan speaking dari halaman kontrol sampai sini (ms)
let drawn = 0, prevDecoded = 0, prevDropped = 0;

function onMsg(msg) {
  if (msg.type === 'layout') { layout = msg.layout; build(); drawAll(); }
  else if (msg.type === 'speaking') {
    if (typeof msg.t === 'number') latStat.add(Date.now() - msg.t);
    if (msg.speaking) speaking.add(msg.slotId); else speaking.delete(msg.slotId);
    applySpeaking();
  } else if (msg.type === 'signal') {
    onSignal(msg.data).catch(e => {
      log('signal_error', { msg: String(e?.message).slice(0, 120) });
      setTimeout(() => ws.send({ type: 'ready' }), 2000); // minta offer baru, jangan macet transparan
    });
  }
}

// Update tile di tempat: saat drag di kontrol, layout datang ~20x/detik. Membuat ulang semua canvas
// membuat tile kosong (berkedip di OBS) sampai frame video berikutnya dan mengulang transisi CSS.
function build() {
  const live = new Set();
  for (const s of layout.slots) {
    if (!s.enabled) continue;
    live.add(s.id);
    const style = resolveStyle(layout.style, s.style);
    let t = tiles.get(s.id);
    if (t) updateTile(t.el, s, style);
    else {
      const { el, canvas } = buildTile(s, style);
      root.append(el);
      t = { el, canvas, ctx: null };
      tiles.set(s.id, t);
    }
    Object.assign(t.el.style, { left: s.place.x + 'px', top: s.place.y + 'px', width: s.place.w + 'px', height: s.place.h + 'px' });
  }
  for (const [id, t] of tiles) if (!live.has(id)) { t.el.remove(); tiles.delete(id); }
  for (const id of speaking) if (!live.has(id)) speaking.delete(id);
  applySpeaking();
}

function applySpeaking() {
  for (const [id, t] of tiles) t.el.classList.toggle('speaking', layout.settings.animate && speaking.has(id));
}

function drawAll() {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return;
  for (const s of layout.slots) {
    const t = tiles.get(s.id);
    if (!t || s.image) continue; // frame virtual: gambar, bukan video
    const w = Math.round(Math.min(s.place.w, s.crop.w));
    const h = Math.round((w * s.crop.h) / s.crop.w);
    if (t.canvas.width !== w || t.canvas.height !== h) { t.canvas.width = w; t.canvas.height = h; }
    t.ctx ??= t.canvas.getContext('2d', { alpha: false });
    // crop yang keluar frame hanya menggambar sebagian: bersihkan sisa piksel lama
    if (s.crop.x + s.crop.w > vw || s.crop.y + s.crop.h > vh) t.ctx.clearRect(0, 0, w, h);
    try { t.ctx.drawImage(v, s.crop.x, s.crop.y, s.crop.w, s.crop.h, 0, 0, w, h); } catch (e) { log('draw_error', { msg: String(e?.message).slice(0, 120) }); }
  }
}

// Daftar ulang dulu: satu exception saat menggambar tidak boleh membekukan tile sampai OBS di-refresh.
let frameReq = 0;
function draw() {
  frameReq = v.requestVideoFrameCallback(draw);
  drawn++;
  drawAll();
}
function restartLoop() {
  v.cancelVideoFrameCallback(frameReq);
  frameReq = v.requestVideoFrameCallback(draw);
}

function setVisible(on, delayMs = 0) {
  clearTimeout(hideTimer);
  // Hanya tile video yang disembunyikan tanpa capture; frame virtual (gambar) tetap tampil.
  if (on) root.classList.remove('nocam');
  else hideTimer = setTimeout(() => root.classList.add('nocam'), delayMs);
}

v.onplaying = () => { setVisible(true); restartLoop(); };

async function onSignal(d) {
  if (d.stop) {
    pc?.close();
    pc = null;
    v.srcObject = null; // lepas decoder; transparan, bukan frame beku
    setVisible(false);
  } else if (d.sdp) {
    pc?.close();
    const mine = (pc = new RTCPeerConnection({ iceServers: [] }));
    watchIce(mine, log, 'preview');
    mine.ontrack = e => {
      if (pc !== mine) return;
      // jitterBufferTarget sengaja dibiarkan bawaan: nilai 0 (tanpa penyangga) membuat ~6% frame terbuang di OBS.
      // Cek "frame terbuang" di `npm run log` sebelum mengubahnya.
      v.srcObject = e.streams[0];
      prevDecoded = prevDropped = 0; // penghitung frame mulai dari nol untuk stream baru
      v.play().catch(err => log('play_error', { msg: String(err?.message).slice(0, 120) }));
    };
    mine.onconnectionstatechange = () => {
      if (pc !== mine) return;
      const st = mine.connectionState;
      log('pc_state', { state: st });
      if (st === 'connected') setVisible(true);
      else if (st === 'disconnected') setVisible(false, 3000); // sering pulih sendiri: jangan langsung kedip
      else if (st === 'closed') setVisible(false);
      else if (st === 'failed') { setVisible(false); ws.send({ type: 'ready' }); } // minta offer baru
    };
    await mine.setRemoteDescription(d.sdp);
    if (pc !== mine) return; // offer yang lebih baru datang selagi menunggu
    await mine.setLocalDescription();
    await iceDone(mine);
    if (pc !== mine) return;
    ws.send({ type: 'signal', data: { sdp: mine.localDescription, id: d.id } });
    sendVisible(); // koneksi baru: kontrol mulai dari anggapan "terlihat"
  }
}

// OBS menandai halaman tersembunyi saat source tidak tampil (scene lain). Kontrol lalu menjeda encoder:
// frame yang tetap dikirim hanya di-decode lalu dibuang. Saat tampil lagi, encoder lanjut (frame kunci baru).
const sendVisible = () => ws.send({ type: 'visible', on: !document.hidden });
document.addEventListener('visibilitychange', sendVisible);

// ---- metrik berkala (tiap 10 detik): RAM, frame video, latensi bicara ----
setInterval(() => {
  const mem = performance.memory;
  const q = v.getVideoPlaybackQuality?.();
  if (q && q.totalVideoFrames < prevDecoded) prevDecoded = prevDropped = 0; // penghitung direset (stream baru)
  const decoded = q ? q.totalVideoFrames - prevDecoded : undefined;
  const dropped = q ? q.droppedVideoFrames - prevDropped : undefined;
  if (q) { prevDecoded = q.totalVideoFrames; prevDropped = q.droppedVideoFrames; }
  log('metrics', {
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
    drawFps: Math.round(drawn / 10), decoded, dropped,
    latency: latStat.snapshot(), hidden: document.hidden,
    slots: tiles.size, pc: pc?.connectionState, video: v.videoWidth ? v.videoWidth + 'x' + v.videoHeight : undefined,
  });
  drawn = 0;
  latStat.reset();
}, 10000);
