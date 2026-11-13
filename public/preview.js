import { connect } from '/shared/ws.js';
import { resolveStyle } from '/shared/style.js';
import { buildTile, updateTile } from '/shared/tile-dom.js';
import { Stat, createLogger, watchIce } from '/shared/log.js';
import { iceDone } from '/shared/rtc.js';
import { matchSlots, sameView } from '/shared/transition.js';

const v = document.getElementById('v');
const root = document.getElementById('root');
let layout = { slots: [], settings: { animate: true } };
const tiles = new Map(); // slotId -> { el, canvas, ctx, crop (crop yang sedang tampil), move (animasi crop) }
const ghosts = new Set(); // tile lama yang sedang keluar atau memudar saat pindah preset: { el, canvas, ctx, slot }
const speaking = new Set();
let pc = null;
let hideTimer = 0;

const ws = connect('preview', onMsg, ok => { if (ok) { ws.send({ type: 'ready' }); log('ws_open', {}); } });
const log = createLogger(ws);
log('session_start', { ua: navigator.userAgent, screen: screen.width + 'x' + screen.height, dpr: devicePixelRatio });
const latStat = new Stat(); // latensi pesan speaking dari halaman kontrol sampai sini (ms)
let drawn = 0, prevDecoded = 0, prevDropped = 0, tLoop = 0;

function onMsg(msg) {
  if (msg.type === 'layout') {
    const old = layout.slots;
    layout = msg.layout;
    const ms = msg.transition ? layout.settings.transitionMs : 0;
    const plan = ms ? rekey(old, ms) : null;
    build();
    if (plan) for (const p of plan) animateTile(p, ms);
    drawAll();
    // capture Discord yang diam bisa hanya ~1 fps: selama transisi gambar tiap frame layar, jangan tunggu frame video
    if (plan) { cancelAnimationFrame(tLoop); const end = performance.now() + ms + 50; const loop = () => { drawAll(); if (performance.now() < end) tLoop = requestAnimationFrame(loop); }; tLoop = requestAnimationFrame(loop); }
  }
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

// ---- animasi pindah preset ----
// Sebelum build(): tile lama dipasangkan ke slot baru (matchSlots). Orang yang sama memakai elemen lamanya
// (geser + crop ikut bergerak); pasangan "terdekat" crossfade (tile lama memudar di lintasan yang sama);
// sisa lama mengecil keluar; sisa baru muncul membesar. Hasil: rencana animasi setelah build() menaruh posisi akhir.
const EASE = 'cubic-bezier(.65, 0, .35, 1)'; // = easeInOutCubic, sama dengan crop di drawAll
const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const lerpRect = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });
const boxOf = el => { const c = getComputedStyle(el); return { left: c.left, top: c.top, width: c.width, height: c.height }; }; // ikut posisi di tengah animasi
const boxPx = p => ({ left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });

function rekey(old, ms) {
  for (const g of ghosts) g.el.remove();
  ghosts.clear();
  const prev = new Map(tiles), from = new Map();
  for (const [id, t] of prev) { from.set(id, boxOf(t.el)); for (const a of t.el.getAnimations()) a.cancel(); }
  tiles.clear();
  const plan = [];
  for (const { a, b, kind } of matchSlots(old.filter(s => s.enabled && prev.has(s.id)), layout.slots.filter(s => s.enabled))) {
    if (kind === 'baru') { plan.push({ id: b.id }); continue; }
    const t = prev.get(a.id), box = from.get(a.id);
    prev.delete(a.id);
    // isi beda (pasangan terdekat, atau nama/id sama tapi crop/gambar lain): crossfade di lintasan yang sama
    if (kind === 'keluar' || kind === 'dekat' || !sameView({ ...a, crop: t.crop ?? a.crop }, b)) {
      leave(t, a, box, b && boxPx(b.place), ms);
      if (b) plan.push({ id: b.id, box, fade: true });
    } else {
      tiles.set(b.id, t); // orang yang sama: elemen lama dipakai slot baru
      plan.push({ id: b.id, box, crop: t.crop ?? a.crop });
    }
  }
  for (const t of prev.values()) t.el.remove();
  return plan;
}

function leave(t, slot, box, to, ms) {
  const g = { ...t, slot: { ...slot, crop: t.crop ?? slot.crop } };
  ghosts.add(g);
  Object.assign(t.el.style, box);
  t.el.classList.remove('speaking');
  const frames = to ? [{ ...box, opacity: 1 }, { ...to, opacity: 0 }] : [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }];
  t.el.animate(frames, { duration: ms, easing: EASE, fill: 'forwards' }).finished.then(() => { t.el.remove(); ghosts.delete(g); }, () => {});
}

function animateTile(p, ms) {
  const t = tiles.get(p.id), s = layout.slots.find(x => x.id === p.id);
  if (!t || !s) return;
  if (!p.box) { t.el.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: ms, easing: EASE }); return; }
  const to = boxPx(s.place);
  t.el.animate(p.fade ? [{ ...p.box, opacity: 0 }, { ...to, opacity: 1 }] : [p.box, to], { duration: ms, easing: EASE });
  // elemen dipakai ulang hanya bila crop tumpang tindih (sameView): crop ikut bergeser (orang yang sama, zoom beda)
  if (p.crop && !s.image) t.move = { crop: p.crop, start: performance.now(), ms };
}

function applySpeaking() {
  for (const [id, t] of tiles) t.el.classList.toggle('speaking', layout.settings.animate && speaking.has(id));
}

function drawAll() {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return;
  const now = performance.now();
  for (const s of layout.slots) {
    const t = tiles.get(s.id);
    if (!t || s.image) continue; // frame virtual: gambar, bukan video
    let c = s.crop;
    if (t.move) {
      const k = Math.min(1, (now - t.move.start) / t.move.ms);
      c = lerpRect(t.move.crop, s.crop, ease(k));
      if (k >= 1) t.move = null;
    }
    t.crop = c;
    paint(t, s.place, s.crop, c, vw, vh);
  }
  for (const g of ghosts) if (!g.slot.image) paint(g, g.slot.place, g.slot.crop, g.slot.crop, vw, vh);
}
// Ukuran canvas mengikuti crop akhir (tidak dialokasikan ulang tiap frame animasi); c = crop yang digambar.
function paint(t, place, size, c, vw, vh) {
  const w = Math.round(Math.min(place.w, size.w));
  const h = Math.round((w * size.h) / size.w);
  if (t.canvas.width !== w || t.canvas.height !== h) { t.canvas.width = w; t.canvas.height = h; }
  t.ctx ??= t.canvas.getContext('2d', { alpha: false });
  // crop yang keluar frame hanya menggambar sebagian: bersihkan sisa piksel lama
  if (c.x + c.w > vw || c.y + c.h > vh) t.ctx.clearRect(0, 0, w, h);
  try { t.ctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, w, h); } catch (e) { log('draw_error', { msg: String(e?.message).slice(0, 120) }); }
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
