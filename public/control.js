import { connect } from '/shared/ws.js';
import { newSlot, newSlotFrom, nextSlotName, presetOrder, mergeDraft, presetSlots, shownSlots, applyPresetSlots, virtualLibrary, rememberVirtual, forgetVirtual, withVirtualSources, rescaleSlots, MAX_PRESETS, MAX_TEMP } from '/shared/layout.js';
import { snapRect, snapSpacing, alignedLines, ratioHeight, clampRect, resizeCorner, cropFromTile, overlaps } from '/shared/geometry.js';
import { attachDrag } from '/shared/drag.js';
import { place, showGuides, showMatch, showGaps, addCorners } from '/editor-dom.js';
import { createCropDialog } from '/crop-dialog.js';
import { createVirtualDialog } from '/virtual-dialog.js';
import { greenFraction, createDebouncer } from '/shared/speaking.js';
import { resolveStyle, defaultStyle, TEMPLATES, validatePartialStyle, mergeStyle } from '/shared/style.js';
import { createStyleForm } from '/style-form.js';
import { SAFE_ZONES } from '/shared/safezones.js';
import { sameSize, sameRatio, toGrid, autoLayout } from '/shared/bulk.js';
import { alignRects, axisOf, distribute, spaceRects, tidy, unionRect } from '/shared/align.js';
import { buildTile, updateTile } from '/shared/tile-dom.js';
import { Stat, createLogger, watchIce } from '/shared/log.js';
import { iceDone } from '/shared/rtc.js';
import { createPresetIoDialogs } from '/preset-io-dialog.js';
import { initUpdates } from '/update-dialog.js';
import { fuzzyMatch } from '/shared/fuzzy.js';
import { startI18n, setLang, getLang, original, tr } from '/shared/i18n.js';

const $ = id => document.getElementById(id);
const video = $('src');
const CANVAS = { w: 1920, h: 1080 };
const SNAP = 16;

let layout = { slots: [], settings: { animate: true, greenMin: 0.02, detectEnabled: true }, style: defaultStyle(), template: 'sticker-night', guides: { x: [], y: [] }, presets: [], library: [] };
let selected = null;
const group = new Set(); // pilih banyak (Ctrl+klik / tarik kotak): >= 2 id, digeser bersama; selected = yang terakhir diklik
let stream = null;
let pc = null;
const boxes = new Map(); // slotId -> { tile, canvas, ctx }
const speaking = new Map(); // slotId -> boolean
let deckSent = ''; // status terakhir yang dikirim ke plugin Stream Deck (dikirim ulang hanya bila berubah)

let lostAt = 0;
const ws = connect('control', onMsg, (ok, reason) => {
  const st = $('wsState');
  // busy: tab control lain sedang aktif (mungkin sedang capture); replaced: tab lain mengambil alih tab ini
  st.textContent = ok ? 'terhubung' : reason === 'busy' ? 'tab lain aktif · klik untuk ambil alih' : reason === 'replaced' ? 'diambil alih tab lain · klik untuk ambil alih' : 'terputus';
  st.className = ok ? 'on' : 'off';
  st.style.cursor = reason ? 'pointer' : '';
  st.onclick = reason ? () => ws.takeover() : null;
  if (reason === 'replaced') stopCapture(); // tab ini tidak lagi mengirim ke OBS: jangan tetap encode di belakang
  // Tab yang ditolak tidak pernah menerima layout: editornya kosong dan menyesatkan. Tutup dengan pesan yang jelas.
  if (reason) {
    $('busyMsg').textContent = reason === 'busy'
      ? 'Tab ini tidak tersambung, jadi layout tidak dimuat dan perubahan tidak tersimpan. Tutup tab lain, atau pakai tab ini (capture di tab lain akan berhenti).'
      : 'Tab lain mengambil alih dan capture di tab ini dihentikan. Pakai tab ini lagi bila perlu.';
    if (!$('busyDlg').open) $('busyDlg').showModal();
  } else if (ok && $('busyDlg').open) $('busyDlg').close();
  if (ok) deckSent = ''; // server baru (restart): kirim ulang status ke plugin Stream Deck
  if (ok) { log('ws_open', { downMs: lostAt ? Date.now() - lostAt : 0 }); lostAt = 0; if (stream) offer(); } else lostAt = Date.now(); // server restart: kirim offer ulang (sinyal 'ready' preview bisa terlewat)
  // Server mematikan semua glow saat kontrol putus; yang masih bicara harus dinyalakan lagi, bukan menunggu ia diam lalu bicara.
  if (ok) for (const [id, on] of speaking) if (on) ws.send({ type: 'speaking', slotId: id, speaking: true, t: Date.now() });
});
// Tab ditutup/di-reload saat capture: OBS langsung menyembunyikan tile, bukan menahan frame terakhir sampai ICE habis.
addEventListener('pagehide', () => { if (stream) ws.send({ type: 'signal', data: { stop: true } }); });
// Log diagnosis (ditulis server ke logs/waku.log; ringkasannya: npm run log)
const log = createLogger(ws);
log('session_start', { ua: navigator.userAgent, screen: screen.width + 'x' + screen.height, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory });
document.addEventListener('visibilitychange', () => log('visibility', { hidden: document.hidden }));

// Link preview untuk Browser Source OBS (mengikuti alamat halaman ini, jadi port selalu benar).
const previewUrl = location.origin + '/preview';
$('previewUrl').textContent = previewUrl;
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* lanjut ke cara cadangan */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}
$('copyUrl').onclick = async () => {
  const note = $('copyNote');
  note.textContent = (await copyText(previewUrl)) ? 'Tersalin' : 'Gagal menyalin, salin manual';
  setTimeout(() => { note.textContent = ''; }, 1800);
};

function onMsg(msg) {
  if (msg.type === 'layout') { layout = msg.layout; layout.guides ??= { x: [], y: [] }; layout.presets ??= []; layout.temp ??= []; layout.library ??= []; savedJson = JSON.stringify(layout); render(); reclamp(); } // titik awal riwayat
  else if (msg.type === 'ready') { previewVisible = true; noPreview = false; offer(); } // preview (baru) melapor sendiri bila tersembunyi
  else if (msg.type === 'no_preview') noPreview = true; // OBS belum/tidak terbuka: offer menunggu 'ready', tidak diulang tiap 10 detik
  else if (msg.type === 'visible') setPreviewVisible(msg.on);
  else if (msg.type === 'discord') onDiscord(msg);
  else if (msg.type === 'info') $('oVersion').textContent = 'v' + msg.version;
  else if (msg.type === 'uploads') showUploads(msg);
  else if (msg.type === 'notice') $('notice').textContent = msg.msg;
  else if (msg.type === 'dspeak') onDiscordSpeak(msg.userId, msg.speaking);
  else if (msg.type === 'signal') onSignal(msg.data);
  else if (msg.type === 'cmd') { log('deck_cmd', msg.action); runCommand(msg.action); } // dari plugin Stream Deck
}

const frame = () => (video.videoWidth ? { w: video.videoWidth, h: video.videoHeight } : { w: 1920, h: 1080 });
const layoutScale = () => $('layoutStage').clientWidth / CANVAS.w;
const selectedSlot = () => layout.slots.find(s => s.id === selected);

// Panel Layout dirender di kanvas asli 1920x1080 (#layoutInner) lalu diskalakan lewat --k.
function applyScale() { $('layoutStage').style.setProperty('--k', layoutScale()); }
const slotStyle = s => resolveStyle(layout.style, s.style);
function restyleAll() {
  for (const s of layout.slots) {
    const b = boxes.get(s.id);
    if (b) updateTile(b.tile, s, slotStyle(s));
  }
}

// ---- pengaturan umum ----
for (const [key, t] of Object.entries(TEMPLATES)) $('gTemplate').append(new Option(t.name, key));
function onGeneralStyle(group, patch) {
  const next = group === 'radius' ? { radius: patch } : { [group]: patch };
  layout.style = mergeStyle(layout.style, validatePartialStyle(next));
  restyleAll(); // dropdown template tetap menampilkan template terakhir yang dipilih
  fillSlotStyle();
  commitSoon();
}
const generalForm = createStyleForm($('generalHost'), { onChange: onGeneralStyle });
$('gTemplate').onchange = e => {
  const t = TEMPLATES[e.target.value];
  if (!t) return;
  layout.style = structuredClone(t.style);
  layout.template = e.target.value;
  reportDeck();
  generalForm.update(layout.style);
  restyleAll();
  fillSlotStyle();
  commit();
};
// Coba efek bicara: slot terpilih berpura-pura bicara 2 detik (memisahkan masalah tampilan dari masalah deteksi).
const fxTimers = new Map(); // per slot: timer global membatalkan "off" slot lain sehingga efeknya nyangkut di OBS
$('fxTest').onclick = () => {
  const s = selectedSlot() ?? layout.slots.find(x => x.enabled);
  if (!s) return setStatus('Tambah frame dulu untuk mencoba efek');
  clearTimeout(fxTimers.get(s.id));
  boxes.get(s.id)?.tile.classList.add('speaking');
  ws.send({ type: 'speaking', slotId: s.id, speaking: true });
  fxTimers.set(s.id, setTimeout(() => {
    fxTimers.delete(s.id);
    if (speaking.get(s.id)) return; // deteksi sungguhan sedang menandai slot ini bicara
    boxes.get(s.id)?.tile.classList.remove('speaking');
    ws.send({ type: 'speaking', slotId: s.id, speaking: false });
  }, 2000));
};

function fillGeneral() {
  generalForm.update(layout.style);
  $('gTemplate').value = layout.template || '';
}

// ---- gaya per slot (penimpaan) ----
const OVERRIDE_KEYS = ['radius', 'border', 'shadow', 'label', 'speak'];
const overridden = s => Object.fromEntries(OVERRIDE_KEYS.map(k => [k, k === 'radius' ? s.style.radius !== undefined : !!s.style[k]]));
const slotForm = createStyleForm($('slotStyleHost'), {
  withOverride: true,
  onChange(group, patch) {
    const s = selectedSlot();
    if (!s) return;
    if (patch === null) delete s.style[group];
    else if (patch === '__override__') {
      s.style[group] = group === 'radius' ? layout.style.radius : structuredClone(layout.style[group]);
    } else if (group === 'radius') s.style.radius = patch;
    else s.style[group] = { ...(s.style[group] ?? {}), ...patch };
    s.style = validatePartialStyle(s.style);
    restyleAll();
    fillSlotStyle();
    commitSoon();
  },
});
function fillSlotStyle() {
  const s = selectedSlot();
  if (s) slotForm.update(slotStyle(s), overridden(s));
}
// ---- aksi massal: slider langsung berlaku; selalu dihitung dari kondisi sebelum sesi, jadi bisa diurungkan ----
const bulk = { snapshot: null, width: false, ratio: null, grid: false, auto: null, preset: false }; // auto = { kind, gap }; preset = snapshot milik Urungkan preset
let bulkTimer, bulkAnim = false;
function resetBulk() {
  bulk.snapshot = null; bulk.width = false; bulk.ratio = null; bulk.grid = false; bulk.auto = null; bulk.preset = false;
  $('aKind').value = '';
  setUndo(false);
  drawKinds();
}
// Template otomatis sebagai gambar: tiap tombol menggambar hasil autoLayout untuk frame aktif sekarang
// (jumlah, urutan, rasio crop, jarak), jadi terlihat tanpa membaca. Dropdown aslinya tetap jadi sumber nilai.
// Pilih template otomatis (gambar di panel, shortcut, Stream Deck): lewat dropdown supaya alurnya satu.
function applyKind(kind) { $('aKind').value = kind; $('aKind').dispatchEvent(new Event('change')); syncQuick(); }
function drawKinds() {
  const act = layout.slots.filter(s => s.enabled), gap = Number($('aGap').value);
  const key = act.map(s => s.id + ':' + (s.crop.w / s.crop.h).toFixed(3) + ':' + !!s.image).join() + '|' + gap;
  if (key !== drawKinds.key) {
    drawKinds.key = key;
    const kinds = [...$('aKind').options].filter(o => o.value);
    for (const host of [$('aKinds'), $('qKinds')]) host.replaceChildren(...kinds.map(o => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'kind'; b.dataset.kind = o.value; b.title = o.text; b.setAttribute('aria-label', o.text);
      const rects = autoLayout(act, o.value, gap, CANVAS).map(s => `<rect class="${s.image ? 'v' : 't'}" x="${s.place.x}" y="${s.place.y}" width="${s.place.w}" height="${s.place.h}" rx="24"/>`).join('');
      b.innerHTML = `<svg viewBox="0 0 1920 1080" aria-hidden="true"><rect class="c" width="1920" height="1080" rx="40"/>${rects}</svg>`;
      b.onclick = () => applyKind(o.value);
      return b;
    }));
  }
  for (const b of document.querySelectorAll('.kind')) b.setAttribute('aria-pressed', String(b.dataset.kind === $('aKind').value));
}
const setUndo = on => { for (const id of ['bUndo', 'pUndo', 'aUndo']) $(id).disabled = !on; };
function runBulk(transition = false) {
  // setelah preset diterapkan, snapshot masih layout sebelum preset (untuk Urungkan): aksi massal harus mulai dari layout sekarang
  if (!bulk.snapshot || bulk.preset) { bulk.snapshot = structuredClone(layout.slots); bulk.preset = false; setUndo(true); }
  let slots = structuredClone(bulk.snapshot);
  if (bulk.ratio) slots = sameRatio(slots, bulk.ratio, frame(), CANVAS);
  if (bulk.auto) slots = autoLayout(slots, bulk.auto.kind, bulk.auto.gap, CANVAS);
  else {
    if (bulk.width) slots = sameSize(slots, Number($('bWidth').value), CANVAS);
    if (bulk.grid) slots = toGrid(slots, Number($('bCols').value), Number($('bGap').value), CANVAS);
  }
  layout.slots = slots;
  renderSoon(); // slider mengirim input ~60x/detik: bangun ulang editor paling sering sekali per frame
  clearTimeout(bulkTimer);
  bulkAnim ||= transition; // true = template otomatis dipilih: dianimasikan di OBS, walau slider menyusul dalam 60 ms
  bulkTimer = setTimeout(() => { sendLayout(bulkAnim); bulkAnim = false; }, 60);
}
for (const id of ['bWidth', 'bCols', 'bGap']) {
  $(id).oninput = e => {
    $(id + 'Val').textContent = e.target.value;
    if (id === 'bWidth') bulk.width = true; else bulk.grid = true;
    bulk.auto = null;
    $('aKind').value = '';
    runBulk();
  };
}
$('bRatio').onchange = e => { bulk.ratio = Number(e.target.value) || null; runBulk(); };
const undoBulk = () => {
  if (!bulk.snapshot) return;
  layout.slots = bulk.snapshot;
  resetBulk();
  $('bRatio').value = '';
  render();
  sendLayout();
};
$('bUndo').onclick = undoBulk;
$('pUndo').onclick = undoBulk;
$('aUndo').onclick = undoBulk;
// template otomatis: langsung berlaku (dari kondisi sebelum sesi), jadi bisa diganti-ganti dan diurungkan
$('aKind').onchange = e => {
  if (!e.target.value) return;
  if (!bulk.snapshot || bulk.preset) pushTemp('template ' + e.target.selectedOptions[0].text); // awal sesi template: susunan sebelumnya ke Temp
  bulk.width = false; bulk.grid = false;
  bulk.auto = { kind: e.target.value, gap: Number($('aGap').value) };
  runBulk(true);
  drawKinds();
};
$('aGap').oninput = e => {
  $('aGapVal').textContent = e.target.value;
  if (!bulk.auto) return drawKinds(); // template aktif: render() per frame yang menggambar ulang
  bulk.auto.gap = Number(e.target.value);
  runBulk();
};

// Jadikan ukuran utama: semua tile aktif persis seukuran tile terpilih. Lebar saja tidak cukup (tinggi ikut rasio crop
// masing-masing), jadi rasio crop juga disamakan dengan slot utama. Sesi baru supaya Urungkan kembali ke sebelum tombol ini.
$('mainSize').onclick = () => {
  const s = selectedSlot();
  if (!s) return;
  resetBulk();
  $('bRatio').value = '';
  bulk.ratio = s.crop.w / s.crop.h;
  const w = Math.round(s.place.w);
  $('bWidth').value = w;
  $('bWidthVal').textContent = w;
  bulk.width = true;
  runBulk();
};

// ---- preset layout: susunan lengkap slot (crop, deteksi, tile, gaya) yang bisa dipanggil lagi ----
let appShortcuts = []; // shortcut global aplikasi Electron: [{ key: 'Control+Alt+P', action: { type: 'preset', id } }, ...]
const keyLabel = k => k.replace('Control', 'Ctrl').replace('Super', 'Win').replace(/num(\d)/, 'Num $1');
let pTab = 'saved'; // tab daftar preset: 'saved' (preset bernama) atau 'temp' (susunan yang tertimpa)
const SVG_NS = 'http://www.w3.org/2000/svg';
// Gambar mini susunan: posisi tile di kanvas 1920x1080, supaya preset dikenali dari bentuknya, bukan cuma nama.
function presetThumb(slots) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pthumb');
  svg.setAttribute('viewBox', '0 0 ' + CANVAS.w + ' ' + CANVAS.h);
  svg.setAttribute('aria-hidden', 'true');
  for (const { place: r } of shownSlots(slots)) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of [['x', r.x], ['y', r.y], ['width', Math.max(30, r.w)], ['height', Math.max(30, r.h)]]) rect.setAttribute(k, Math.round(v));
    svg.append(rect);
  }
  return svg;
}
// Nama orang di preset (frame kamera yang sudah dinamai; DC 1, DC 2, ... dan virtual frame tidak dihitung).
const presetPeople = p => (p.full ? p.slots.filter(s => !s.image && s.name && !/^DC \d+$/.test(s.name)).map(s => s.name) : []);
const presetInfo = p => { const who = presetPeople(p); return shownSlots(p.slots).length + ' frame · ' + (who.length ? who.join(', ') : p.full ? 'dengan akun' : 'susunan saja'); };
const tempTime = t => {
  const d = new Date(t), hm = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString(getLang() === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short' }) + ' ' + hm;
};
function presetRow(p, temp) {
  const row = document.createElement('div');
  row.className = 'preset';
  row.tabIndex = 0;
  row.title = temp ? 'Klik untuk kembali ke susunan ini' : 'Klik untuk menerapkan. Tarik untuk mengubah urutan';
  if (!temp && !$('pSearch').value) sortablePreset(row, p);
  const info = document.createElement('div');
  info.className = 'pinfo';
  const title = document.createElement('b');
  title.className = 'pname';
  const name = document.createElement('span');
  name.textContent = temp ? 'Sebelum ' + (p.name || 'Tanpa nama') : p.name || 'Tanpa nama';
  name.title = name.textContent; // nama panjang terpotong: lengkapnya saat disorot
  if (!temp && p.pinned) title.insertAdjacentHTML('beforeend', PIN_SVG);
  title.append(name);
  const meta = document.createElement('small');
  meta.className = 'pmeta';
  if (temp) { const t = document.createElement('span'); t.className = 'ptime'; t.textContent = tempTime(p.t); meta.append(t); }
  const what = document.createElement('span');
  what.textContent = presetInfo(p);
  what.title = what.textContent;
  meta.append(what);
  const key = !temp && appShortcuts.find(s => s.action.type === 'preset' && s.action.id === p.id)?.key;
  if (key) { const k = document.createElement('kbd'); k.textContent = keyLabel(key); k.title = 'Shortcut'; meta.append(k); }
  info.append(title, meta);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'pmore';
  more.textContent = '⋯';
  more.title = 'Aksi lain';
  more.setAttribute('aria-label', 'Aksi lain');
  more.onclick = e => { e.stopPropagation(); presetMenu(more, p, temp); };
  row.append(presetThumb(p.slots), info, more);
  const go = () => applyPreset(p, temp);
  row.onclick = go;
  row.onkeydown = e => { if (e.key === 'Enter' && e.target === row) go(); };
  return row;
}
let shownLists = []; // daftar preset/Temp yang sedang tampil: render() tidak membangunnya ulang bila sama
// Preset cocok dengan pencarian (nama preset atau nama orang di dalamnya), boleh typo.
const presetHit = (p, q) => !q || [p.name, ...presetPeople(p)].some(x => fuzzyMatch(q, x));
function renderPresets() {
  shownLists = [layout.presets, layout.temp];
  reportDeck();
  const temp = pTab === 'temp';
  for (const b of $('pTabs').children) b.setAttribute('aria-pressed', String(b.dataset.tab === pTab));
  const q = $('pSearch').value.trim().toLowerCase();
  const list = (temp ? layout.temp : layout.presets).filter(p => presetHit(p, q));
  const rows = list.map(p => presetRow(p, temp));
  if (!rows.length) {
    const e = document.createElement('p');
    e.className = 'hint';
    e.textContent = q ? 'Tidak ada yang cocok.' : temp ? 'Temp masih kosong. Susunan yang tertimpa saat preset atau template diterapkan muncul di sini.' : 'Belum ada preset.';
    rows.push(e);
  }
  $('pList').replaceChildren(...rows);
  // Bawah kanvas: preset yang disematkan jadi tombol (urutan tetap, bisa ditarik); sisanya di menu Lainnya.
  const order = presetOrder(layout.presets);
  const pinned = order.filter(p => p.pinned), rest = order.filter(p => !p.pinned);
  const none = document.createElement('span');
  none.className = 'none';
  none.textContent = 'Belum ada preset';
  const qq = $('qSearch').value.trim(), shown = qq ? order.filter(p => presetHit(p, qq)) : pinned; // mencari: semua preset yang cocok, disematkan atau tidak
  if (qq && !shown.length) none.textContent = 'Tidak ada yang cocok.';
  $('quickPresets').replaceChildren(...(shown.length ? shown.map(quickPreset) : layout.presets.length && !qq ? [] : [none])); // Lainnya di kanan judul: tetap terlihat walau daftar di-scroll
  $('moreBtn').hidden = !rest.length;
  $('moreBtn').textContent = pinned.length ? 'Lainnya ▾' : 'Pilih preset ▾';
  $('moreList').replaceChildren(...rest.map(quickPreset));
}
// Menu ⋯ satu baris: aksi yang jarang dipakai saat live (supaya tidak salah klik).
function presetMenu(anchor, p, temp) {
  const items = temp ? [
    presetBtn('Simpan jadi preset', () => { $('pMenu').hidePopover(); openSaveDlg(anchor, { from: p }); }),
    presetBtn('Hapus', b => armed(b, 'Hapus', 'Klik lagi', () => { layout.temp = layout.temp.filter(x => x !== p); $('pMenu').hidePopover(); commit(); renderPresets(); }), 'del'),
  ] : [
    presetBtn('Timpa dengan susunan sekarang', b => {
      if (!layout.slots.length) return setStatus('Belum ada frame untuk disimpan');
      armed(b, 'Timpa dengan susunan sekarang', 'Klik lagi untuk menimpa', () => {
        p.slots = presetSlots(layout.slots, p.full);
        Object.assign(p, capturedSize());
        $('pMenu').hidePopover();
        commit();
        renderPresets();
        setStatus('Preset diperbarui');
      });
    }, 'over'),
    presetBtn('Ganti nama', () => { $('pMenu').hidePopover(); openSaveDlg(anchor, { rename: p }); }),
    presetBtn(p.pinned ? 'Lepas sematan' : 'Sematkan di bawah kanvas', () => { p.pinned = !p.pinned; $('pMenu').hidePopover(); commit(); renderPresets(); }),
    presetBtn('Hapus', b => armed(b, 'Hapus', 'Klik lagi', () => { layout.presets = layout.presets.filter(x => x !== p); $('pMenu').hidePopover(); commit(); renderPresets(); }), 'del'),
  ];
  $('pMenu').replaceChildren(...items);
  popoverAt($('pMenu'), anchor);
}
// Popover di bawah tombolnya (naik ke atas bila tidak muat di layar).
function popoverAt(pop, anchor) {
  pop.showPopover();
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
  Object.assign(pop.style, { left: Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px', top: top + 'px', bottom: 'auto' });
}
const presetBtn = (text, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = cls; b.onclick = () => fn(b); return b; };
// Aksi yang tidak bisa dibatalkan: klik pertama mempersenjatai tombol, klik kedua dalam 3 detik menjalankan.
// Klik dua kali untuk aksi berbahaya. label null: tombol ikon, teksnya tidak diganti.
function armed(b, label, armedLabel, fn) {
  const text = t => { if (label != null) b.textContent = t; };
  if (!b.classList.contains('armed')) {
    b.classList.add('armed');
    text(armedLabel);
    setTimeout(() => { b.classList.remove('armed'); text(label); }, 3000);
    return;
  }
  b.classList.remove('armed');
  text(label);
  fn();
}
// Tombol preset di bawah kanvas dan di menu Lainnya: terapkan + pin.
function quickPreset(p) {
  const wrap = document.createElement('span');
  wrap.className = 'qp';
  sortablePreset(wrap, p);
  const b = document.createElement('button');
  b.type = 'button';
  const n = document.createElement('small');
  n.textContent = shownSlots(p.slots).length + ' frame';
  const name = document.createElement('span');
  name.className = 'nm';
  name.textContent = p.name || 'Tanpa nama';
  const txt = document.createElement('span');
  txt.className = 'tx';
  txt.append(name, n);
  b.append(presetThumb(p.slots), txt); // bentuk susunannya terlihat tanpa membaca nama
  b.title = 'Terapkan preset (' + n.textContent + ')';
  b.onclick = () => { $('morePresets').hidePopover(); applyPreset(p); };
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'pin' + (p.pinned ? ' on' : '');
  pin.title = p.pinned ? 'Lepas sematan: pindah ke menu Lainnya' : 'Sematkan: tampil sebagai tombol di bawah kanvas';
  pin.setAttribute('aria-label', pin.title);
  pin.setAttribute('aria-pressed', String(p.pinned));
  pin.innerHTML = PIN_SVG;
  pin.onclick = () => { p.pinned = !p.pinned; commit(); renderPresets(); };
  wrap.append(b, pin);
  return wrap;
}
// Drag & drop urutan preset (daftar di tab Preset, tombol di bawah kanvas, menu Lainnya): satu urutan yang sama.
let dragPreset = null;
function sortablePreset(el, p) {
  el.draggable = true;
  el.addEventListener('dragstart', e => { dragPreset = p.id; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => { dragPreset = null; el.classList.remove('dragging'); });
  el.addEventListener('dragover', e => { if (dragPreset && dragPreset !== p.id) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drop'); movePreset(dragPreset, p.id); });
}
function movePreset(from, to) {
  const list = layout.presets, i = list.findIndex(x => x.id === from), j = list.findIndex(x => x.id === to);
  if (i < 0 || j < 0 || i === j) return;
  list.splice(j, 0, ...list.splice(i, 1)); // ke posisi preset tujuan
  commit();
  renderPresets();
}
// Selama mencari, tinggi bar dikunci: hasil sedikit atau kosong tidak boleh membuat kanvas di atasnya ikut membesar.
function searchPresets() {
  const bar = $('quickPresets'), on = !!$('qSearch').value.trim();
  if (on && !bar.style.minHeight) bar.style.minHeight = Math.max(bar.getBoundingClientRect().height, 114) + 'px'; // pecahan persis; 114 = tinggi satu kartu
  if (!on) bar.style.minHeight = '';
  renderPresets();
  bar.scrollLeft = 0;
}
$('qSearch').oninput = searchPresets;
$('qSearch').onkeydown = e => { if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.target.value = ''; searchPresets(); } }; // Esc cukup mengosongkan pencarian, pilihan frame tetap
// Roda mouse biasa (naik/turun) menggulir daftar preset ke samping; di ujung daftar halaman tetap bergulir.
$('quickPresets').addEventListener('wheel', e => {
  const el = e.currentTarget, d = e.deltaY;
  if (!d || e.shiftKey || Math.abs(e.deltaX) > Math.abs(d)) return; // touchpad geser samping / Shift+roda: bawaan browser
  const max = el.scrollWidth - el.clientWidth;
  if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
  e.preventDefault();
  el.scrollLeft += d;
}, { passive: false });
// Menu Lainnya muncul di atas tombolnya (kanan judul bar preset, di bawah layar).
$('morePresets').addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  const r = $('moreBtn').getBoundingClientRect(), w = parseFloat(getComputedStyle($('morePresets')).width) || 300; // belum tampil: lebar dari CSS
  Object.assign($('morePresets').style, { left: Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px', bottom: innerHeight - r.top + 6 + 'px' }); // rata kanan dengan tombolnya, tidak keluar jendela
});
// Gambar unggahan yang filenya sudah tidak ada di server (mis. folder data dihapus manual). Gagal menghubungi server = anggap ada.
async function missingImages(slots) {
  const urls = [...new Set(slots.filter(s => s.image).map(s => s.image))];
  const ok = await Promise.all(urls.map(u => fetch(u, { method: 'HEAD' }).then(r => r.ok, () => true)));
  return new Set(urls.filter((_, i) => !ok[i]));
}
// Ukuran capture yang dipakai crop sekarang (untuk preset); tanpa capture: ukuran terakhir yang diketahui.
const capturedSize = () => (video.videoWidth ? { frameW: video.videoWidth, frameH: video.videoHeight } : { frameW: layout.settings.frameW, frameH: layout.settings.frameH });
// Temp: susunan sekarang dicatat sebelum ditimpa preset atau template, supaya bisa kembali. Tidak dicatat bila
// kosong, sama persis dengan preset tersimpan, atau sama dengan catatan Temp terakhir.
function pushTemp(name) {
  if (!layout.slots.length) return;
  const slots = presetSlots(layout.slots, true), json = JSON.stringify(slots), part = JSON.stringify(presetSlots(layout.slots, false));
  if (layout.temp[0] && JSON.stringify(layout.temp[0].slots) === json) return;
  if (layout.presets.some(p => (p.full ? json : part) === JSON.stringify(p.slots))) return;
  layout.temp = [{ id: 't' + Date.now().toString(36), name: String(name).slice(0, 40), slots, pinned: false, full: true, ...capturedSize(), t: Date.now() }, ...layout.temp].slice(0, MAX_TEMP);
  renderPresets();
}
// exact: kembali ke catatan Temp apa adanya (tanpa membawa frame Discord dari susunan sekarang).
let presetSeq = 0;
async function applyPreset(p, exact = false) {
  const seq = ++presetSeq;
  pushTemp(exact ? 'Temp ' + tempTime(p.t) : p.name || 'Tanpa nama');
  for (const s of layout.slots) if (s.image) layout.library = rememberVirtual(layout.library, s); // virtual frame yang hilang dari kanvas tetap tersimpan
  // crop preset dibuat untuk ukuran capture saat disimpan: skalakan dulu ke capture sekarang (hanya slot dari preset)
  const scaled = p.frameW && video.videoWidth ? { ...p, slots: rescaleSlots(p.slots, { w: p.frameW, h: p.frameH }, frame()) } : p;
  let next = withVirtualSources(exact ? structuredClone(scaled.slots) : applyPresetSlots(scaled, layout.slots), layout.library)
    .map(s => ({ ...s, crop: s.image ? s.crop : clampRect(s.crop, frame()), probe: clampRect(s.probe, frame()), place: clampRect(s.place, CANVAS) }));
  const gone = next.some(s => s.image) ? await missingImages(next) : new Set(); // frame tanpa gambar dilewati, bukan jadi kotak kosong di OBS
  if (seq !== presetSeq) return; // preset lain sudah ditekan selagi menunggu
  if (gone.size) next = next.filter(s => !gone.has(s.image));
  resetBulk();
  bulk.snapshot = structuredClone(layout.slots); // supaya bisa diurungkan
  bulk.preset = true;
  setUndo(true);
  for (const [id, on] of speaking) if (on) ws.send({ type: 'speaking', slotId: id, speaking: false });
  speaking.clear(); debouncers.clear(); lastRatio.clear();
  layout.slots = next;
  if (!layout.slots.some(s => s.id === selected)) selected = null;
  render();
  sendLayout(true);
  const name = p.name || 'Tanpa nama';
  setStatus(gone.size ? 'Preset "' + name + '" diterapkan · ' + gone.size + ' virtual frame gambarnya hilang' : 'Preset "' + name + '" diterapkan');
}
// Popup simpan: preset baru dari susunan sekarang, ganti nama ({ rename: p }), atau simpan dari Temp ({ from: t }).
let saveMode = {};
function openSaveDlg(anchor, mode = {}) {
  saveMode = mode;
  const src = mode.from?.slots ?? layout.slots;
  $('pSaveTitle').textContent = mode.rename ? 'Ganti nama preset' : 'Simpan preset';
  $('pSaveOk').textContent = mode.rename ? 'Ganti nama' : 'Simpan';
  $('pFullRow').hidden = !!mode.rename;
  // saran nama: P + jumlah frame kamera, terpilih supaya bisa langsung ditimpa atau dilanjutkan ("P5 Freetalk")
  $('pName').value = mode.rename ? mode.rename.name : 'P' + src.filter(s => !s.image).length;
  popoverAt($('pSaveDlg'), anchor);
  $('pName').select();
}
$('pSave').onclick = () => {
  if (!layout.slots.length) return setStatus('Belum ada frame untuk disimpan');
  if (layout.presets.length >= MAX_PRESETS) return setStatus('Maksimal 50 preset');
  openSaveDlg($('pSave'));
};
$('pSaveDlg').onsubmit = e => {
  e.preventDefault();
  const name = $('pName').value.trim();
  if (!name) return $('pName').focus();
  if (saveMode.rename) {
    saveMode.rename.name = name;
    setStatus('Nama preset diganti');
  } else {
    if (layout.presets.length >= MAX_PRESETS) return setStatus('Maksimal 50 preset');
    const full = $('pFull').checked, from = saveMode.from;
    if (!from && !layout.slots.length) return setStatus('Belum ada frame untuk disimpan');
    layout.presets.push({ id: 'p' + Date.now().toString(36), name, slots: presetSlots(from ? from.slots : layout.slots, full), pinned: false, full, ...(from ? { frameW: from.frameW, frameH: from.frameH } : capturedSize()) });
    setStatus('Preset disimpan');
  }
  $('pSaveDlg').hidePopover();
  commit();
  renderPresets();
};
$('pTabs').onclick = e => { const t = e.target.closest('button')?.dataset.tab; if (t && t !== pTab) { pTab = t; renderPresets(); } };
$('pSearch').oninput = () => renderPresets();

$('slotStyleReset').onclick = () => {
  const s = selectedSlot();
  if (!s) return;
  s.style = {};
  restyleAll();
  fillSlotStyle();
  commit();
};
let statusTimer = 0;
function setStatus(t, sticky = false) {
  clearTimeout(statusTimer);
  $('status').textContent = t;
  if (t && !sticky) statusTimer = setTimeout(() => { $('status').textContent = ''; }, 5000);
}
function chips() { // status Capture dan Deteksi di bar atas
  const set = (id, on, yes, no) => { $(id).textContent = on ? yes : no; $(id).className = on ? 'on' : 'off'; };
  if (!$('capture').classList.contains('busy')) set('capState', !!stream, 'aktif', 'mati'); // sedang disiapkan: tetap "menyiapkan..."
  window.wakuApp?.setCapturing(!!stream); // menu tray menampilkan "Hentikan capture"
  set('detState', layout.settings.detectEnabled, 'nyala', 'mati');
  reportDeck();
}
$('detChip').onclick = () => $('sDetect').click();
$('capChip').onclick = () => (stream ? stopCapture(true) : $('capture').click()); // aktif: hentikan; mati: capture

// transition = true: pindah preset, OBS menganimasikan perpindahannya
const sendLayout = (transition = false) => { record(); ws.send({ type: 'layout', layout, transition: transition === true }); };

// ---- urungkan / ulangi (Ctrl+Z, Ctrl+Y atau Ctrl+Shift+Z) ----
// Tiap layout yang dikirim dicatat. Perubahan beruntun (drag mengirim ~20x/detik) yang jaraknya < 500 ms
// digabung jadi satu langkah, jadi satu kali geser = satu kali urungkan.
const undoStack = [], redoStack = [];
let savedJson = null, lastPush = 0;
function record() {
  const now = JSON.stringify(layout);
  if (savedJson !== null && now !== savedJson) {
    if (Date.now() - lastPush > 500) { undoStack.push(savedJson); if (undoStack.length > 100) undoStack.shift(); }
    lastPush = Date.now();
    redoStack.length = 0;
  }
  savedJson = now;
}
function stepHistory(from, to) {
  if (!from.length || cropDlg.isOpen()) return;
  to.push(JSON.stringify(layout));
  layout = JSON.parse(from.pop());
  if (video.videoWidth) fitCrops(); // riwayat menyimpan crop di ukuran capture saat itu
  savedJson = JSON.stringify(layout); lastPush = 0;
  resetBulk();
  ws.send({ type: 'layout', layout });
  render();
}
// Alt ditahan: tandai body supaya sisi tile bisa ditarik untuk memotong (dan tampil beda).
const altMode = e => document.body.classList.toggle('alt', e.altKey);
addEventListener('keydown', altMode);
addEventListener('keyup', e => { if (e.key === 'Alt') e.preventDefault(); altMode(e); }); // Alt dilepas jangan memindah fokus ke menu browser
addEventListener('blur', () => document.body.classList.remove('alt'));
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || cropDlg.isOpen()) return;
  if (e.target.matches?.('input:not([type]), input[type=text], input[type=search], input[type=number], textarea, [contenteditable]')) return; // undo teks bawaan (juga kotak cari preset)
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(undoStack, redoStack); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); stepHistory(redoStack, undoStack); }
});
// perubahan manual apa pun mengakhiri sesi aksi massal (tombol Urungkan tidak lagi berlaku)
let pendingTimer = 0;
const commit = () => { clearTimeout(pendingTimer); pendingTimer = 0; resetBulk(); sendLayout(); }; // batalkan commitSoon yang tertunda: isinya sama
function commitSoon() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(commit, 50);
}

// ---- capture + WebRTC sender ----
let trackMuted = false; // jendela Discord di-minimize/beku: tidak ada frame baru, deteksi jangan membaca frame lama
// byUser: chip Capture di bar atas / menu tray. OBS diberi tahu supaya tile langsung disembunyikan.
function stopCapture(byUser = false) {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  pc?.close();
  pc = null;
  if (byUser) { ws.send({ type: 'signal', data: { stop: true } }); log('capture_stop', {}); setStatus('Capture dihentikan'); }
  chips();
}
// Capture sedang disiapkan (picker terbuka, lalu menunggu frame pertama): tombol Capture jadi penanda proses.
function captureBusy(text) {
  for (const b of [$('capture'), $('dlgCapture')]) { b.disabled = !!text; b.classList.toggle('busy', !!text); b.setAttribute('aria-busy', String(!!text)); }
  if (!text) return chips();
  setStatus(text, true); // proses capture: tetap tampil sampai selesai
  $('capState').textContent = 'menyiapkan...';
  $('capState').className = 'wait';
}
// Frame pertama dari capture baru sudah sampai (atau batas tunggu habis: jendela yang diam bisa lama tidak mengirim frame).
const firstFrame = (ms = 4000) => new Promise(r => { const t = setTimeout(r, ms); video.requestVideoFrameCallback(() => { clearTimeout(t); r(); }); });
$('capture').onclick = async () => {
  let next;
  captureBusy('Pilih jendela Discord...');
  try {
    // Petunjuk ke picker Chromium (diabaikan bila tidak didukung): utamakan Window, sembunyikan Entire Screen dan tab ini.
    next = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { max: layout.settings.fps }, displaySurface: 'window' },
      audio: false,
      monitorTypeSurfaces: 'exclude',
      selfBrowserSurface: 'exclude',
    });
  } catch (e) {
    const canceled = e?.name === 'NotAllowedError' || e?.name === 'AbortError'; // Chrome / picker Electron
    if (!canceled) log('capture_error', { name: e?.name, msg: String(e?.message).slice(0, 120) });
    captureBusy('');
    return setStatus(canceled ? 'Capture dibatalkan' : 'Capture gagal: ' + (e?.name ?? 'error'));
  }
  captureBusy('Menyiapkan capture...');
  const old = stream;
  stream = next;
  old?.getTracks().forEach(t => t.stop()); // capture lama tidak boleh terus encode di belakang
  const mine = stream;
  const track = mine.getVideoTracks()[0];
  track.contentHint = 'detail';
  trackMuted = false;
  track.onmute = () => { if (stream === mine) { trackMuted = true; log('capture_mute', {}); } };
  track.onunmute = () => { if (stream === mine) trackMuted = false; };
  track.onended = () => {
    log('capture_end', {});
    if (stream !== mine) return; // capture lama berakhir setelah diganti capture baru
    stream = null;
    video.srcObject = null;
    pc?.close();
    pc = null;
    ws.send({ type: 'signal', data: { stop: true } });
    setStatus('Capture berhenti, klik Capture lagi');
    chips();
  };
  video.srcObject = mine;
  try { await video.play(); } catch (e) { log('play_error', { msg: String(e?.message).slice(0, 120) }); }
  log('capture_start', { w: video.videoWidth, h: video.videoHeight, fps: track.getSettings?.().frameRate, label: String(track.label).slice(0, 60) });
  restartTick();
  offer();
  render();
  await firstFrame();
  captureBusy('');
  setStatus(stream === mine ? 'Capture aktif' : 'Capture berhenti, klik Capture lagi');
};

let offerId = 0;
let noPreview = false;
async function offer() {
  if (!stream) return;
  pc?.close();
  const mine = (pc = new RTCPeerConnection({ iceServers: [] }));
  const id = ++offerId;
  watchIce(mine, log, 'control');
  stream.getTracks().forEach(t => mine.addTrack(t, stream));
  // Utamakan H264 (biasanya di-encode hardware/GPU); VP8/VP9 tetap tersedia sebagai cadangan.
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs ?? [];
  const h264 = codecs.filter(c => c.mimeType === 'video/H264');
  if (h264.length) for (const t of mine.getTransceivers()) { try { t.setCodecPreferences([...h264, ...codecs.filter(c => c.mimeType !== 'video/H264')]); } catch { /* urutan default */ } }
  // Gagal tersambung: coba offer lagi sekali lagi setelah 2 detik (preview juga minta ulang dari sisinya).
  mine.addEventListener('connectionstatechange', () => {
    if (mine.connectionState === 'failed') setTimeout(() => { if (pc === mine && stream) offer(); }, 2000);
  });
  // Penjaga: negosiasi yang macet di new/connecting tidak pernah jadi 'failed', jadi tidak akan dicoba ulang sendiri.
  setTimeout(() => {
    if (pc === mine && stream && !noPreview && mine.connectionState !== 'connected') { log('offer_stuck', { state: mine.connectionState }); offer(); }
  }, 10000);
  await mine.setLocalDescription();
  try {
    for (const sender of mine.getSenders()) {
      const p = sender.getParameters();
      // bawaan 8 Mbps: cukup untuk 1080p lokal; lebih tinggi hanya membebani encoder (diatur di tab Atur)
      if (p.encodings?.length) { p.encodings[0].maxBitrate = layout.settings.bitrate * 1_000_000; p.encodings[0].active = previewVisible; p.degradationPreference = 'maintain-resolution'; await sender.setParameters(p); }
    }
  } catch (e) { log('sender_params_error', { msg: String(e?.message).slice(0, 120) }); } // bitrate default bila ditolak
  await iceDone(mine);
  if (pc !== mine) return; // offer() lain mengambil alih selagi menunggu
  ws.send({ type: 'signal', data: { sdp: mine.localDescription, id } });
}

// Browser Source OBS tidak tampil (scene lain): encoder dijeda, tidak meng-encode frame yang akan dibuang.
let previewVisible = true;
function setPreviewVisible(on) {
  if (on === previewVisible) return;
  previewVisible = on;
  log('preview_visible', { on });
  for (const sender of pc?.getSenders() ?? []) {
    const p = sender.getParameters();
    if (!p.encodings?.length) continue;
    p.encodings[0].active = on;
    sender.setParameters(p).catch(err => log('sender_params_error', { msg: String(err?.message).slice(0, 120) }));
  }
}

async function onSignal(d) {
  if (!pc || !d.sdp || d.id !== offerId) return; // answer untuk offer lama diabaikan
  await pc.setRemoteDescription(d.sdp).catch(e => log('answer_error', { msg: String(e?.message).slice(0, 120) }));
}

// ---- rendering editor ----
function positionAll() {
  applyScale();
  for (const s of layout.slots) {
    const b = boxes.get(s.id);
    if (b) place(b.tile, s.place, 1);
  }
  drawRulers();
}

// ---- penggaris (kiri dan atas Layout, satuan piksel kanvas) ----
let cursor = null; // posisi kursor di kanvas { x, y }
function drawRuler(cv, vertical) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; } // alokasi ulang hanya saat ukuran berubah
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const k = layoutScale();
  const max = vertical ? CANVAS.h : CANVAS.w;
  const pos = v => v * k;
  const sel = selectedSlot();
  if (sel?.enabled) { // blok tile terpilih
    c.fillStyle = '#ece4cf30';
    const [a, len] = vertical ? [sel.place.y, sel.place.h] : [sel.place.x, sel.place.w];
    if (vertical) c.fillRect(0, pos(a), w, pos(len)); else c.fillRect(pos(a), 0, pos(len), h);
  }
  c.strokeStyle = c.fillStyle = '#8a8880';
  c.font = '500 10.5px Barlow, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  c.lineWidth = 1;
  const step = [50, 100, 200, 250, 500].find(n => n * k >= 48) ?? 500;
  const minor = step / 5;
  for (let v = 0; v <= max; v += minor) {
    const major = v % step === 0;
    const p = pos(v) + .5;
    c.beginPath();
    if (vertical) { c.moveTo(w, p); c.lineTo(major ? w - 14 : w - 6, p); } else { c.moveTo(p, h); c.lineTo(p, major ? h - 14 : h - 6); }
    c.stroke();
    if (major && v < max) {
      c.save();
      if (vertical) { c.translate(9, p + 3); c.rotate(-Math.PI / 2); c.textAlign = 'right'; c.fillText(String(v), 0, 0); } else c.fillText(String(v), p + 3, 10);
      c.restore();
    }
  }
  if (cursor) { // penanda kursor
    c.strokeStyle = '#ece4cf';
    c.lineWidth = 2;
    c.beginPath();
    const p = pos(vertical ? cursor.y : cursor.x);
    if (vertical) { c.moveTo(0, p); c.lineTo(w, p); } else { c.moveTo(p, 0); c.lineTo(p, h); }
    c.stroke();
  }
}
function drawRulers() { drawRuler($('rulerTop'), false); drawRuler($('rulerLeft'), true); }
const stagePoint = e => {
  const r = $('layoutStage').getBoundingClientRect(), k = layoutScale();
  return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
};
let rulerRaf = 0; // gabungkan pointermove beruntun jadi satu gambar per frame layar
const drawRulersSoon = () => { if (!rulerRaf) rulerRaf = requestAnimationFrame(() => { rulerRaf = 0; drawRulers(); }); };
$('layoutStage').addEventListener('pointermove', e => { cursor = stagePoint(e); drawRulersSoon(); });
$('layoutStage').addEventListener('pointerleave', () => { cursor = null; drawRulersSoon(); });

// ---- guide buatan pengguna: tarik dari penggaris untuk membuat, tarik kembali ke penggaris untuk menghapus ----
const MAX_GUIDES = 20;
function guideEl(axis, v) {
  const el = document.createElement('div');
  el.className = 'ug ' + (axis === 'x' ? 'v' : 'h');
  el.style[axis === 'x' ? 'left' : 'top'] = v + 'px';
  $('layoutInner').append(el);
  return el;
}
function startGuideDrag(axis, value, el, host, e) {
  e.preventDefault();
  host.setPointerCapture(e.pointerId);
  const max = axis === 'x' ? CANVAS.w : CANVAS.h;
  let v = value, gone = false;
  const set = nv => {
    v = nv;
    gone = nv < 0 || nv > max;
    el.classList.toggle('gone', gone);
    el.style[axis === 'x' ? 'left' : 'top'] = v + 'px';
  };
  const move = ev => set(Math.round(stagePoint(ev)[axis]));
  const up = () => {
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', up);
    host.removeEventListener('pointercancel', up);
    if (!gone) layout.guides[axis] = [...new Set([...layout.guides[axis], v])].sort((a, b) => a - b);
    commit();
    renderGuides();
  };
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  set(Math.round(stagePoint(e)[axis]));
}
function renderGuides() {
  $('layoutInner').querySelectorAll('.ug').forEach(e => e.remove());
  for (const axis of ['x', 'y']) {
    for (const v of layout.guides[axis]) {
      const el = guideEl(axis, v);
      el.addEventListener('pointerdown', e => {
        layout.guides[axis] = layout.guides[axis].filter(g => g !== v);
        startGuideDrag(axis, v, el, el, e);
      });
    }
  }
  $('clearGuides').disabled = !layout.guides.x.length && !layout.guides.y.length;
}
for (const [id, axis] of [['rulerTop', 'y'], ['rulerLeft', 'x']]) {
  $(id).addEventListener('pointerdown', e => {
    if (layout.guides[axis].length >= MAX_GUIDES) return setStatus('Maksimal 20 guide per sumbu');
    startGuideDrag(axis, -1, guideEl(axis, -1), $(id), e);
  });
}
$('clearGuides').onclick = () => { layout.guides = { x: [], y: [] }; commit(); renderGuides(); };

// Gabungan garis tempel (snap) dan semua tepi yang sudah sejajar persis, supaya terlihat "sudah satu garis atau belum".
function withAligned(g, rect, others) {
  const a = alignedLines(rect, others, CANVAS);
  return { x: [...new Set([...g.x, ...a.x])], y: [...new Set([...g.y, ...a.y])] };
}

const PENCIL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4zM14 7l3 3"/></svg>';

const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 4 4H6l4-4-1-6zM12 14v6"/></svg>';
const TILE_W = 448; // lebar tile bawaan (sama dengan slot baru)
const RESET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 1.6-7.3L4 10"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

function render() {
  drawKinds();
  $('layoutInner').replaceChildren();
  boxes.clear();
  for (const id of group) if (!layout.slots.some(s => s.id === id && s.enabled)) group.delete(id); // dihapus/disembunyikan/preset baru
  if (group.size < 2) group.clear();
  for (const s of layout.slots) {
    if (!s.enabled) continue;
    const { el: tile, canvas } = buildTile(s, slotStyle(s));
    tile.classList.add('tile');
    tile.classList.toggle('locked', s.placeLocked);
    tile.classList.toggle('sel', s.id === selected || group.has(s.id));
    tile.classList.toggle('speaking', !!speaking.get(s.id)); // pose bicara bertahan setelah render ulang
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit';
    edit.title = 'Edit frame ' + (s.name || s.id);
    edit.setAttribute('aria-label', edit.title);
    edit.innerHTML = PENCIL_SVG;
    edit.addEventListener('pointerdown', e => e.stopPropagation()); // jangan memicu geser tile
    edit.onclick = () => { select(s.id); s.image ? virtualDlg.open(s.id) : cropDlg.open(s.id); };
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = 'Hapus frame ' + (s.name || s.id) + ' (klik dua kali untuk memastikan)';
    del.setAttribute('aria-label', del.title);
    del.innerHTML = TRASH_SVG;
    del.addEventListener('pointerdown', e => e.stopPropagation());
    del.addEventListener('dblclick', e => e.stopPropagation()); // dua klik hapus bukan klik-ganda tile
    del.onclick = () => armed(del, null, null, () => deleteSlots([s.id]));
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reset';
    reset.title = 'Reset ' + (s.name || s.id) + ': crop kembali ke yang diatur di popup, ukuran tile ke bawaan';
    reset.setAttribute('aria-label', reset.title);
    reset.innerHTML = RESET_SVG;
    reset.addEventListener('pointerdown', e => e.stopPropagation());
    reset.addEventListener('dblclick', e => e.stopPropagation());
    reset.onclick = () => {
      select(s.id);
      s.crop = s.image ? { ...s.baseCrop } : clampRect(s.baseCrop ?? s.crop, frame()); // virtual: tanpa batas capture
      if (!s.image && !layout.settings.frameW) markFrame(); // acuan milik semua crop: hanya diisi bila belum ada
      s.place = clampRect({ ...s.place, w: TILE_W, h: ratioHeight(TILE_W, s.crop) }, CANVAS);
      commit(); render();
    };
    tile.append(edit, del, reset);
    const handles = [...addCorners(tile), ...addCorners(tile, ['n', 's', 'e', 'w'])]; // sisi hanya aktif saat Alt (lihat CSS body.alt)
    // Ctrl+klik: tambah/lepas dari pilihan. Klik biasa di luar pilihan: kembali pilih satu.
    tile.addEventListener('pointerdown', e => {
      dropped = null;
      if (e.ctrlKey || e.metaKey) {
        if (!group.size && selected && selected !== s.id && boxes.has(selected)) group.add(selected);
        if (group.has(s.id)) {
          group.delete(s.id);
          dropped = s.id; // yang baru dilepas tidak ikut digeser
          const next = [...group].at(-1) ?? null;
          if (group.size < 2) group.clear();
          selected = null; select(next); markSel();
          return;
        }
        group.add(s.id);
        if (group.size < 2) group.clear();
      } else if (!group.has(s.id)) group.clear();
      select(s.id); markSel();
    });
    tile.addEventListener('dblclick', () => { select(s.id); showTab('panelSlot'); }); // klik dua kali: buka pengaturan Slot di kiri
    canvas.width = 320; canvas.height = 180;
    $('layoutInner').append(tile);
    boxes.set(s.id, { tile, canvas });

    let cropStart = null, placeStart = null, moving = [], starts = [], bb = null;
    attachDrag(tile, handles, {
      get: () => s.place,
      scale: layoutScale,
      canResize: () => !s.placeLocked && dropped !== s.id,
      begin: () => {
        if (dropped === s.id) { moving = []; return; }
        select(s.id); cropStart = { ...s.crop }; placeStart = { ...s.place }; // yang diubah = yang terpilih (acuan Jadikan ukuran utama)
        moving = group.has(s.id) ? layout.slots.filter(o => group.has(o.id) && o.enabled) : [s];
        starts = moving.map(o => ({ ...o.place }));
        bb = unionRect(starts);
      },
      // Digeser sebagai satu kotak gabungan: magnet dan jarak dihitung dari kotak itu terhadap frame lain.
      move: (r, alt) => {
        if (!moving.length) return;
        const box = { ...bb, x: bb.x + r.x - placeStart.x, y: bb.y + r.y - placeStart.y };
        const others = layout.slots.filter(o => !moving.includes(o) && o.enabled).map(o => o.place);
        const sn = alt ? { x: box.x, y: box.y, guides: { x: [], y: [] } } : snapRect(box, others, CANVAS, SNAP, layout.guides);
        // Jarak sama dengan jarak antar frame lain (atau tengah di antara dua frame): menang bila lebih dekat dari magnet tepi.
        const gaps = [];
        if (!alt) {
          const sp = snapSpacing(box, others, SNAP);
          for (const a of ['x', 'y']) {
            const edge = Math.abs(sn[a] - box[a]);
            if (!sp[a] || (sn.guides[a].length && Math.abs(sp[a].d) > edge)) continue;
            if (!sn.guides[a].length || Math.abs(sp[a].d) < edge) sn.guides[a] = []; // seri: garis tepi tetap tampil
            sn[a] = box[a] + sp[a].d;
            gaps.push(...sp[a].marks);
          }
        }
        moving.forEach((o, i) => { o.place = { ...starts[i], x: starts[i].x + sn.x - bb.x, y: starts[i].y + sn.y - bb.y }; });
        showGuides(withAligned(sn.guides, { ...bb, x: sn.x, y: sn.y }, others), $('layoutInner'), 1);
        showGaps($('layoutInner'), 1, gaps);
        positionAll(); commitSoon();
      },
      // Alt (atau tarik sisi): potong seperti di OBS, bingkai bergeser dan gambar kamera tetap di skalanya.
      // Tanpa Alt: ubah ukuran tile dengan rasio terkunci dan magnet.
      resize: (r, alt, corner) => {
        const others = layout.slots.filter(o => o !== s && o.enabled);
        if (alt || corner.length === 1) {
          ({ place: s.place, crop: s.crop } = cropFromTile(r, placeStart, cropStart, s.image ? null : frame())); // virtual: boleh melewati tepi gambar
          if (!s.image && !layout.settings.frameW) markFrame(); // acuan milik semua crop: hanya diisi bila belum ada
          if (s.image) updateTile(tile, s, slotStyle(s)); // frame virtual: posisi gambar ikut crop baru
          showGuides({ x: [], y: [] }, $('layoutInner'), 1); showMatch($('layoutInner'), 1, null);
          positionAll();
          // Ganti crop mengubah ukuran canvas (isinya terhapus): gambar ulang sekarang juga, jangan tunggu frame video
          // berikutnya (~15 fps di editor), kalau tidak gambar lama sempat melar ke bingkai baru dan terlihat goyang.
          if (!paused) drawTiles();
          commitSoon();
          return;
        }
        s.crop = { ...cropStart };
        const sn = resizeCorner(r, corner, CANVAS, others.map(o => o.place), { threshold: SNAP, ratio: cropStart.w / cropStart.h, guides: layout.guides });
        s.place = sn.rect;
        showGuides(withAligned(sn.guides, s.place, others.map(o => o.place)), $('layoutInner'), 1);
        showMatch($('layoutInner'), 1, s.place, sn.matchIndex === null ? null : others[sn.matchIndex].place);
        positionAll(); commitSoon();
      },
      end: () => { showGuides({ x: [], y: [] }, $('layoutInner'), 1); showMatch($('layoutInner'), 1, null); showGaps($('layoutInner'), 1, []); commit(); },
    });
  }
  renderGuides();
  positionAll();
  fillForm();
  showArrange();
  fillGeneral();
  if (shownLists[0] !== layout.presets || shownLists[1] !== layout.temp) renderPresets(); // slider/geser memanggil render() tiap frame; tiap pengubah preset memanggil renderPresets() sendiri
  renderLibInfo();
  $('sAnimate').checked = layout.settings.animate;
  $('pTransition').value = String(layout.settings.transitionMs ?? 400);
  $('oBitrate').value = layout.settings.bitrate;
  $('oBitrateVal').textContent = layout.settings.bitrate;
  $('oFps').value = layout.settings.fps;
  $('sDetect').checked = layout.settings.detectEnabled;
  chips();
  $('sGreen').value = layout.settings.greenMin;
  $('sGreenVal').textContent = layout.settings.greenMin;
  if (!paused) drawTiles(); // canvas baru langsung terisi, tidak kosong sampai frame video berikutnya
}

let renderReq = 0;
const renderSoon = () => { renderReq ||= requestAnimationFrame(() => { renderReq = 0; render(); }); };

function select(id) {
  if (selected === id) return;
  selected = id;
  markSel();
  fillForm();
  drawRulers();
}
function markSel() {
  for (const [sid, b] of boxes) b.tile.classList.toggle('sel', sid === selected || group.has(sid));
  showArrange();
}

// ---- rata dan jarak (bar di judul kanvas): pilih banyak = acuan kotak gabungan, satu frame = acuan kanvas ----
const arrangeTargets = () => layout.slots.filter(s => s.enabled && (group.size ? group.has(s.id) : s.id === selected));
function showArrange() {
  const n = arrangeTargets().length;
  $('arrange').hidden = !n;
  $('dsH').disabled = $('dsV').disabled = n < 3;
  $('arGap').disabled = $('tidy').disabled = n < 2;
}
function arrange(fn) {
  const ss = arrangeTargets();
  if (!ss.length) return;
  const out = fn(ss.map(s => s.place));
  ss.forEach((s, i) => { s.place = clampRect(out[i], CANVAS); });
  positionAll(); drawRulers(); commit();
}
for (const [id, mode] of [['alL', 'left'], ['alH', 'hcenter'], ['alR', 'right'], ['alT', 'top'], ['alV', 'vcenter'], ['alB', 'bottom']]) {
  $(id).onclick = () => arrange(rs => alignRects(rs, mode, rs.length > 1 ? undefined : { x: 0, y: 0, ...CANVAS }));
}
$('dsH').onclick = () => arrange(rs => distribute(rs, 'x'));
$('dsV').onclick = () => arrange(rs => distribute(rs, 'y'));
const arGap = () => Math.min(400, Math.max(0, Math.round(Number($('arGap').value) || 0)));
$('arGap').onchange = () => arrange(rs => spaceRects(rs, axisOf(rs), arGap()));
$('tidy').onclick = () => arrange(rs => tidy(rs, arGap()));
let dropped = null; // id frame yang baru dilepas dari pilihan lewat Ctrl+klik: jangan digeser (pegangan sudut tidak mereset ini)

// Tarik kotak di area kosong: pilih semua frame yang tersentuh (Ctrl = tambahkan ke pilihan). Klik saja = batal pilih banyak.
$('layoutStage').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('.tile, .ug, button, input, select, label, a, [popover]')) return; // tombol di atas kanvas tetap bisa diklik
  const stage = $('layoutStage'), add = e.ctrlKey || e.metaKey, a = stagePoint(e);
  const mq = document.createElement('div');
  mq.className = 'marquee';
  let rect = { x: a.x, y: a.y, w: 0, h: 0 };
  const move = ev => {
    const b = stagePoint(ev);
    rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    if (!mq.isConnected) $('layoutInner').append(mq);
    place(mq, rect, 1);
  };
  const up = () => {
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', up);
    stage.removeEventListener('pointercancel', up);
    mq.remove();
    const hits = rect.w < 6 && rect.h < 6 ? [] : layout.slots.filter(s => s.enabled && boxes.has(s.id) && overlaps(s.place, rect)).map(s => s.id);
    const ids = new Set(add ? [...group, ...(selected && boxes.has(selected) ? [selected] : [])] : []);
    for (const id of hits) ids.add(id);
    group.clear();
    if (ids.size >= 2) for (const id of ids) group.add(id);
    const primary = hits.at(-1) ?? (ids.has(selected) || !ids.size ? selected : [...ids].at(-1));
    if (primary !== selected) select(primary);
    markSel();
  };
  stage.setPointerCapture(e.pointerId);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !group.size || document.querySelector('dialog[open], :popover-open')) return;
  group.clear(); markSel();
});

function deleteSlots(ids) {
  for (const id of ids) {
    layout.library = rememberVirtual(layout.library, layout.slots.find(s => s.id === id)); // virtual frame tetap ada di daftar
    layout.slots = layout.slots.filter(s => s.id !== id);
    if (selected === id) selected = null;
    setSpeaking(id, false); // preview dan server tidak boleh menyimpan glow slot yang sudah dihapus
    speaking.delete(id);
    debouncers.delete(id);
    lastRatio.delete(id);
  }
  commit(); render(); // satu commit = satu langkah Ctrl+Z
  setStatus(ids.length + ' frame dihapus · Ctrl+Z untuk membatalkan');
}
// frame terpilih (satu atau pilih banyak): tombol tong sampah di bar rata (klik dua kali) atau tombol Delete
const deleteSelected = () => { const ids = arrangeTargets().map(s => s.id); if (ids.length) deleteSlots(ids); };
$('arDel').onclick = () => armed($('arDel'), null, null, deleteSelected);
document.addEventListener('keydown', e => {
  if (e.key !== 'Delete' || e.ctrlKey || e.altKey || cropDlg.isOpen() || document.querySelector('dialog[open], :popover-open')) return;
  if (e.target.matches?.('input, textarea, select, [contenteditable]')) return; // Delete di kotak teks tetap menghapus huruf
  e.preventDefault();
  deleteSelected();
});

function fillForm() {
  const s = selectedSlot();
  $('mainSize').disabled = !s?.enabled;
  $('slotForm').hidden = !s;
  $('slotHint').hidden = !!s;
  if (!s) return;
  $('fName').value = s.name;
  $('fPlaceLock').checked = s.placeLocked;
  $('fEnabled').checked = s.enabled;
  fillSlotStyle();
}

// ---- panel handlers ----
// src: salin ukuran crop dan tile dari slot itu; tanpa src = ukuran default.
function makeNewSlot(slots, src) {
  const id = 's' + Date.now().toString(36) + slots.length;
  const s = src ? newSlotFrom(id, slots.length, src) : newSlot(id, slots.length);
  s.name = nextSlotName(slots);
  s.crop = clampRect(s.crop, frame());
  s.probe = clampRect(s.probe, frame());
  s.place = clampRect(s.place, CANVAS);
  return s;
}

// ---- popup frame virtual (virtual-dialog.js): frame dari gambar unggahan, bukan dari capture ----
// Acuan frame virtual baru, sama seperti Tambah frame: rasio dan ukuran ikut frame terpilih (atau frame aktif pertama).
const vRef = () => layout.slots.find(s => s.id === selected && s.enabled) ?? layout.slots.find(s => s.enabled);
const virtualDlg = createVirtualDialog({
  slots: () => layout.slots, ref: vRef, discord: () => discord,
  library: () => virtualLibrary(layout),
  // pakai lagi dari daftar: yang tersembunyi ditampilkan, yang tidak ada ditambahkan di posisi terakhirnya
  onPick(v) {
    const cur = layout.slots.find(x => x.id === v.id);
    if (cur) { cur.enabled = true; selected = cur.id; commit(); render(); return setStatus('Virtual frame ditampilkan lagi'); }
    if (layout.slots.length >= 16) return setStatus('Maksimal 16 frame');
    const [s] = withVirtualSources([{ ...structuredClone(v), enabled: true, place: clampRect(v.place, CANVAS) }], layout.library);
    layout.slots.push(s);
    selected = s.id;
    commit(); render();
  },
  onForget(id) { // hapus permanen (yang tersembunyi di kanvas juga ikut)
    Object.assign(layout, forgetVirtual(layout, id));
    layout.slots = layout.slots.filter(s => s.id !== id || s.enabled);
    if (selected === id) selected = null;
    commit(); render();
  },
  onSave({ id, ...fields }) {
    let s = layout.slots.find(x => x.id === id);
    if (!s) {
      const ref = vRef();
      s = makeNewSlot(layout.slots); // posisi grid seperti Tambah frame
      const w = ref ? ref.place.w : TILE_W;
      s.place = clampRect({ ...s.place, w, h: ratioHeight(w, fields.crop) }, CANVAS); // ukuran sama dengan frame acuan
      layout.slots.push(s);
    } else s.place = clampRect({ ...s.place, h: ratioHeight(s.place.w, fields.crop) }, CANVAS);
    Object.assign(s, fields, { baseCrop: { ...fields.crop } });
    layout.library = rememberVirtual(layout.library, s);
    selected = s.id;
    commit(); render();
  },
});
$('addVirtual').onclick = () => (layout.slots.length >= 16 ? setStatus('Maksimal 16 frame') : virtualDlg.open(null));

// ---- popup Tambah / Edit frame (crop-dialog.js): bekerja pada salinan, layout baru berubah saat Simpan ----
const cropDlg = createCropDialog({
  video, frame, makeNewSlot,
  slots: () => layout.slots,
  greenMin: () => layout.settings.greenMin,
  selected: () => selected,
  discord: () => discord,
  onSave({ slots, greenMin, selectedId }) {
    const merged = mergeDraft(layout.slots, slots, frame(), CANVAS);
    markFrame(); // crop baru diatur di capture ini
    const kept = new Set(merged.map(s => s.id));
    for (const s of layout.slots) if (!kept.has(s.id)) { speaking.delete(s.id); debouncers.delete(s.id); lastRatio.delete(s.id); }
    layout.slots = merged;
    layout.settings.greenMin = greenMin;
    selected = selectedId;
    commit(); render();
  },
});
$('addSlot').onclick = () => cropDlg.open(null, true);
$('editCrop').onclick = () => { const s = selectedSlot(); if (s) s.image ? virtualDlg.open(s.id) : cropDlg.open(s.id); };

// Jeda pratinjau: berhenti menggambar ulang tile Layout untuk menghemat resource (otomatis juga saat tab tersembunyi).
// Stream ke OBS dan deteksi bicara tetap jalan (video harus tetap berjalan agar bisa dibaca).
let paused = false;
$('pause').onclick = () => {
  paused = !paused;
  document.body.classList.toggle('paused', paused);
  $('pause').title = paused ? 'Lanjutkan pratinjau' : 'Jeda pratinjau: hemat resource, berhenti menggambar ulang tile di kanvas';
  $('pause').setAttribute('aria-pressed', String(paused));
};
$('sDetect').onchange = e => { layout.settings.detectEnabled = e.target.checked; commit(); chips(); }; // tidak mengubah tile: cukup chip status
$('fName').oninput = e => { const s = selectedSlot(); if (!s) return; s.name = e.target.value; restyleAll(); drawRulers(); commitSoon(); };
$('fPlaceLock').onchange = e => {
  const s = selectedSlot();
  s.placeLocked = e.target.checked;
  boxes.get(s.id)?.tile.classList.toggle('locked', s.placeLocked); // canResize membaca placeLocked langsung
  commit();
};
$('fEnabled').onchange = e => { selectedSlot().enabled = e.target.checked; commit(); render(); };
$('sAnimate').onchange = e => { layout.settings.animate = e.target.checked; commit(); };
$('pTransition').onchange = e => { layout.settings.transitionMs = Number(e.target.value); commit(); };
$('sGreen').oninput = e => {
  layout.settings.greenMin = Number(e.target.value);
  $('sGreenVal').textContent = e.target.value;
  commitSoon();
};

// ---- gambar tile live di editor layout ----
// Menggambar berhenti saat tab tersembunyi atau pratinjau dijeda; popup Crop hanya digambar saat terbuka.
function drawTiles() {
  if (!video.videoWidth) return;
  for (const s of layout.slots) {
    const b = boxes.get(s.id);
    if (!b || s.image) continue; // frame virtual: <img>, bukan video
    const w = 320, h = Math.round((w * s.crop.h) / s.crop.w);
    if (b.canvas.width !== w || b.canvas.height !== h) { b.canvas.width = w; b.canvas.height = h; }
    try {
      (b.ctx ??= b.canvas.getContext('2d')).drawImage(video, s.crop.x, s.crop.y, s.crop.w, s.crop.h, 0, 0, w, h);
    } catch (e) { log('draw_error', { msg: String(e?.message).slice(0, 120) }); }
  }
}
let tickReq = 0;
function tick() {
  tickReq = video.requestVideoFrameCallback(tick); // daftar ulang dulu: satu exception tidak boleh mematikan loop selamanya
  frames++;
  if (!paused && !document.hidden && frames % 2 === 0) { // pratinjau editor cukup ~15 fps; video ke OBS tetap penuh
    drawn++;
    drawTiles();
  }
  if (cropDlg.isOpen() && !document.hidden && frames % 2 === 0) cropDlg.draw(); // popup crop juga cukup ~15 fps
}
function restartTick() {
  video.cancelVideoFrameCallback(tickReq);
  tickReq = video.requestVideoFrameCallback(tick);
}

// Crop disimpan dalam piksel capture, dengan ukuran capture tempat crop itu dibuat (settings.frameW/H) sebagai acuan.
// Crop baru diatur di capture sekarang: capture ini jadi acuan baru.
function markFrame() {
  if (video.videoWidth) { layout.settings.frameW = video.videoWidth; layout.settings.frameH = video.videoHeight; clearResizeNote(); }
}
// Ukuran capture berubah (jendela Discord di-resize atau pindah monitor). Crop tidak pernah dijepit lalu disimpan:
// itu permanen, jadi setelah ukuran jendela dikembalikan crop sudah rusak.
// - rasio sama: Discord menskalakan isinya, jadi crop dan kotak deteksi ikut diskalakan, lalu capture ini jadi acuan.
// - rasio beda: Discord menyusun ulang isinya dan tidak bisa diikuti. Crop dan acuan dibiarkan, jadi crop pas lagi
//   begitu ukuran jendela dikembalikan (bagian crop di luar capture tidak digambar).
// Rasio capture sama dengan acuan: skalakan crop ke capture sekarang. false = tidak berubah (ukuran atau rasio beda).
function fitCrops() {
  const next = rescaleSlots(layout.slots, { w: layout.settings.frameW, h: layout.settings.frameH }, frame());
  if (next === layout.slots) return false;
  layout.slots = next; markFrame(); return true;
}
const RESIZE_NOTE = 'Ukuran jendela Discord berubah. Kembalikan ukurannya, atau atur ulang crop.';
const clearResizeNote = () => { if (original($('status')) === RESIZE_NOTE) setStatus(''); }; // crop sudah pas lagi (teks asli, bukan terjemahan)
function reclamp() {
  if (!video.videoWidth) return; // tanpa frame, frame() hanya tebakan 1920x1080
  const f = frame(), ref = { w: layout.settings.frameW, h: layout.settings.frameH };
  if (!ref.w) { markFrame(); commit(); return; } // layout lama: anggap crop dibuat untuk capture ini
  if (ref.w === f.w && ref.h === f.h) { clearResizeNote(); positionAll(); return; } // kembali ke ukuran acuan: crop sudah pas
  const scaled = fitCrops();
  log('frame_resize', { from: ref.w + 'x' + ref.h, to: f.w + 'x' + f.h, scaled });
  if (!scaled) {
    setStatus(RESIZE_NOTE, true);
    positionAll();
    return;
  }
  cropDlg.reclamp(f.w / ref.w); // popup terbuka: draft ikut diskalakan
  positionAll();
  commit();
}

window.addEventListener('resize', positionAll);
// ukuran panel mengikuti jendela dan kolom, jadi skala harus dihitung ulang saat ukurannya berubah
// Animasi lipat panel mengubah ukuran tiap frame: hitung ulang paling sering sekali per frame.
let positionReq = 0;
new ResizeObserver(() => { positionReq ||= requestAnimationFrame(() => { positionReq = 0; positionAll(); }); }).observe($('layoutStage'));

// tab pengaturan di rel kiri
const tabButtons = [...document.querySelectorAll('.tabs [role=tab]')];
function showTab(id) {
  for (const t of tabButtons) {
    const on = t.dataset.tab === id;
    t.setAttribute('aria-selected', String(on));
    $(t.dataset.tab).hidden = !on;
    if (on) {
      $('drawerTitle').textContent = t.dataset.title;
      if (id === 'panelAtur') ws.send({ type: 'uploads_info' }); // angka penyimpanan selalu segar saat panel dibuka
    }
  }
  $('work').classList.remove('collapsed');
}
for (const t of tabButtons) t.onclick = () => showTab(t.dataset.tab);
showTab('panelUmum');
$('collapse').onclick = () => $('work').classList.toggle('collapsed');
$('supportDev').onclick = () => $('supportDlg').showModal();
$('supportClose').onclick = () => $('supportDlg').close();
$('busyTake').onclick = () => ws.takeover();
$('busyDlg').addEventListener('cancel', e => e.preventDefault()); // Esc tidak boleh menyembunyikan peringatan ini
$('helpBtn').onclick = () => $('help').classList.add('open');
$('helpClose').onclick = () => $('help').classList.remove('open');
$('helpDc').onclick = () => { $('help').classList.remove('open'); $('dcOpen').click(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('help').classList.remove('open'); });
// klik di luar panel bantuan menutupnya (tombol ? sendiri tidak dihitung, supaya klik-nya tetap membuka)
document.addEventListener('pointerdown', e => {
  if ($('help').classList.contains('open') && !e.target.closest('#help, #helpBtn')) $('help').classList.remove('open');
});
video.addEventListener('loadedmetadata', reclamp);
// Saat jendela Discord di-drag ukurannya, resize datang beruntun: tunggu ukurannya stabil
// supaya ukuran sementara yang kecil tidak memotong crop secara permanen.
let reclampTimer = 0;
video.addEventListener('resize', () => { clearTimeout(reclampTimer); reclampTimer = setTimeout(reclamp, 600); });

// ---- deteksi bicara: hijau di kotak deteksi kecil tiap slot (≈10 Hz) ----
const SAMPLE = 32; // kotak deteksi diskalakan ke 32x32 sebelum dibaca
// Semua kotak deteksi digambar dulu ke satu atlas di GPU (32x32 per slot), lalu dibaca ke CPU sekali per putaran.
// Menggambar video langsung ke kanvas CPU (willReadFrequently) membaca ulang seluruh frame capture dari GPU tiap
// panggilan (frame NV12 dikonversi utuh): diukur 50 ms untuk 4 slot di capture 2404x1294, dengan atlas 12 ms.
const atlas = document.createElement('canvas'), actx = atlas.getContext('2d');
const reader = document.createElement('canvas'), rctx = reader.getContext('2d', { willReadFrequently: true });
atlas.height = reader.height = SAMPLE;
const debouncers = new Map();
const lastRatio = new Map();

function sampleAll(slots) {
  const w = SAMPLE * Math.max(1, slots.length);
  if (atlas.width !== w) atlas.width = reader.width = w; else actx.clearRect(0, 0, w, SAMPLE); // bagian di luar frame tidak boleh mewarisi piksel lain
  slots.forEach((s, i) => actx.drawImage(video, s.probe.x, s.probe.y, s.probe.w, s.probe.h, i * SAMPLE, 0, SAMPLE, SAMPLE));
  rctx.clearRect(0, 0, w, SAMPLE);
  rctx.drawImage(atlas, 0, 0);
  return slots.map((_, i) => greenFraction(rctx.getImageData(i * SAMPLE, 0, SAMPLE, SAMPLE).data));
}

// metrik diagnosis (dikirim berkala ke log)
const gapStat = new Stat(); // jeda antar-putaran sampler 100 ms (jitter/throttle timer)
const costStat = new Stat(); // waktu kerja satu putaran sampler (ms)
let slowTicks = 0, lastTickAt = 0, drawn = 0, frames = 0;
const firstHit = new Map(); // slotId -> waktu pertama hijau terbaca (untuk delay deteksi)
const speakStart = new Map();
let speakInfo = {};

function setSpeaking(id, now) {
  const was = speaking.get(id);
  if (!!was === now) return; // slot yang belum pernah bicara (undefined) tidak perlu mengirim "false"
  const name = layout.slots.find(s => s.id === id)?.name || id;
  if (now) { speakStart.set(id, performance.now()); log('speak_on', { slot: name, ...speakInfo }); }
  else if (was) log('speak_off', { slot: name, durMs: speakStart.has(id) ? Math.round(performance.now() - speakStart.get(id)) : undefined });
  speaking.set(id, now);
  boxes.get(id)?.tile.classList.toggle('speaking', now);
  ws.send({ type: 'speaking', slotId: id, speaking: now, t: Date.now() });
}

function detectTick() {
  const t0 = performance.now();
  if (lastTickAt) { const gap = t0 - lastTickAt; gapStat.add(gap); if (gap > 500) slowTicks++; }
  lastTickAt = t0;
  const canSample = stream && video.videoWidth && layout.settings.detectEnabled && !trackMuted; // muted: frame beku, outline lama bisa terbaca terus
  const probed = canSample ? layout.slots.filter(s => !s.discordId && s.enabled && s.detect && !s.image) : [];
  const ratios = new Map(probed.length ? sampleAll(probed).map((r, i) => [probed[i].id, r]) : []);
  for (const s of layout.slots) {
    // Official: hanya dari Discord; selama Discord terputus frame ini diam (tidak kembali ke kotak hijau).
    if (s.discordId) { lastRatio.delete(s.id); speakInfo = { via: 'discord' }; setSpeaking(s.id, viaDiscord(s) && discordSpeaks(s)); continue; }
    if (!canSample || !s.enabled || !s.detect || s.image) { setSpeaking(s.id, false); lastRatio.delete(s.id); continue; } // virtual: bicara hanya dari Discord
    const ratio = ratios.get(s.id);
    lastRatio.set(s.id, ratio);
    if (!debouncers.has(s.id)) debouncers.set(s.id, createDebouncer());
    const hit = ratio >= layout.settings.greenMin;
    if (hit) { if (!firstHit.has(s.id)) firstHit.set(s.id, performance.now()); } else firstHit.delete(s.id);
    speakInfo = { ratio: Math.round(ratio * 1000) / 1000, delayMs: firstHit.has(s.id) ? Math.round(performance.now() - firstHit.get(s.id)) : undefined };
    setSpeaking(s.id, debouncers.get(s.id)(hit));
  }
  const cur = cropDlg.current();
  if (cur?.mode === 'discord') { $('ratio').textContent = !viaDiscord(cur.slot) ? '-' : dSpeaking.get(cur.slot.discordId) ? 'bicara' : 'diam'; return; }
  if (!canSample) { $('ratio').textContent = '-'; return; }
  costStat.add(performance.now() - t0);
  if (cur?.mode === 'manual') { // popup Crop: bacaan langsung untuk kotak deteksi yang sedang diatur
    const r = sampleAll([cur.slot])[0];
    $('ratio').textContent = r.toFixed(3);
    cropDlg.markHit(r >= cur.greenMin);
  } else $('ratio').textContent = '-';
}
// ---- status bicara langsung dari aplikasi Discord (lewat server) ----
// Slot Official (dipetakan ke user Discord) memakai status dari Discord; saat Discord tidak tersambung, slot itu diam.
let discord = null; // null = server tidak punya discord.json
const dSpeaking = new Map(); // userId -> sedang bicara
const viaDiscord = s => discord?.status === 'ready' && !!s.discordId;
const discordSpeaks = s => s.enabled && (s.detect || !!s.image) && layout.settings.detectEnabled && !!dSpeaking.get(s.discordId); // virtual frame: cukup sumber Discord
function onDiscordSpeak(userId, on) {
  dSpeaking.set(userId, on);
  for (const s of layout.slots) if (s.discordId === userId && viaDiscord(s)) { speakInfo = { via: 'discord' }; setSpeaking(s.id, discordSpeaks(s)); }
}
const DC_TEXT = { off: 'Discord belum dibuka', connecting: 'menyambung...', authorize: 'klik Authorize di Discord', denied: 'izin ditolak · klik coba lagi', error: 'gagal · klik coba lagi' };
function onDiscord(st) {
  dcForm(st);
  if (st.status === 'unset') { // belum diisi di tab Atur: hanya kotak hijau
    discord = null; dSpeaking.clear(); $('dcChip').hidden = true;
    cropDlg.refreshSource();
    return;
  }
  discord = st;
  if (st.status !== 'ready') dSpeaking.clear();
  const ready = st.status === 'ready';
  $('dcChip').hidden = false;
  $('dcState').textContent = ready ? (st.channel ? st.channel.name || 'di panggilan' : 'belum masuk voice') : DC_TEXT[st.status] ?? st.status;
  $('dcState').className = ready && st.channel ? 'on' : 'off';
  $('dcChip').title = st.error || 'Status bicara langsung dari aplikasi Discord di PC ini.';
  cropDlg.refreshSource();
}
// tab Atur: Client ID + Secret milik pengguna. Server tidak pernah mengirim Secret balik, hanya clientId.
let dcSavedId = '';
function dcForm(st) {
  dcSavedId = st.clientId || '';
  if (document.activeElement !== $('dcId')) $('dcId').value = dcSavedId;
  $('dcSecret').placeholder = dcSavedId ? 'tersimpan; isi hanya untuk mengganti' : '';
  $('dcClear').hidden = !dcSavedId;
  const status = st.status === 'ready' ? 'tersambung' + (st.channel ? ' · ' + (st.channel.name || 'di panggilan') : '') : DC_TEXT[st.status] ?? st.status;
  $('dcInfo').textContent = !dcSavedId ? 'Belum diisi.' : 'Status: ' + status + (st.error ? ' (' + st.error + ')' : '');
  $('dcSummary').textContent = !dcSavedId ? 'Belum diatur. Bicara dideteksi dari kotak hijau di layar.' : 'Aktif · ' + status;
}
$('dcOpen').onclick = () => { $('dcDlg').showModal(); if (!dcSavedId) $('dcId').focus(); };
$('dcClose').onclick = () => $('dcDlg').close();
$('dcDlg').addEventListener('close', () => { $('dcSecret').value = ''; }); // secret yang belum disimpan tidak tertinggal di form
$('dcSave').onclick = () => {
  const clientId = $('dcId').value.trim(), clientSecret = $('dcSecret').value.trim();
  if (!/^\d{15,25}$/.test(clientId)) { $('dcInfo').textContent = 'Client ID harus berupa angka dari Developer Portal.'; return; }
  if (clientId !== dcSavedId && !clientSecret) { $('dcInfo').textContent = 'Isi Client Secret juga.'; return; }
  if (clientSecret && !/^[\w-]{8,128}$/.test(clientSecret)) { $('dcInfo').textContent = 'Client Secret tidak valid; salin ulang dari Developer Portal.'; return; }
  ws.send({ type: 'discord_creds', clientId, clientSecret });
  $('dcSecret').value = '';
  $('dcInfo').textContent = 'Menyimpan...';
};
$('dcClear').onclick = () => armed($('dcClear'), 'Hapus', 'Klik lagi untuk menghapus', () => ws.send({ type: 'discord_creds', clear: true }));
$('dcChip').onclick = () => { if (discord && discord.status !== 'ready') ws.send({ type: 'discord_retry' }); };
// Detak 100 ms dari Worker: timer Worker tidak diperlambat Chrome saat tab ini tersembunyi
// (setInterval biasa turun ke 1x per detik, deteksi bicara jadi telat).
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 100)'], { type: 'text/javascript' })));
ticker.onmessage = detectTick;

// ---- tab Atur: video ke OBS, gambar unggahan ----
// Bitrate dan fps berlaku langsung: encoder diatur ulang lewat setParameters, capture lewat applyConstraints.
$('oBitrate').oninput = e => {
  layout.settings.bitrate = Number(e.target.value);
  $('oBitrateVal').textContent = layout.settings.bitrate;
  for (const sender of pc?.getSenders() ?? []) {
    const p = sender.getParameters();
    if (!p.encodings?.length) continue;
    p.encodings[0].maxBitrate = layout.settings.bitrate * 1_000_000;
    sender.setParameters(p).catch(err => log('sender_params_error', { msg: String(err?.message).slice(0, 120) }));
  }
  commitSoon();
};
$('oFps').onchange = e => {
  layout.settings.fps = Number(e.target.value);
  stream?.getVideoTracks()[0]?.applyConstraints({ frameRate: { max: layout.settings.fps } })
    .catch(err => log('fps_error', { msg: String(err?.message).slice(0, 120) }));
  commit();
};
const fmtBytes = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
function showUploads(u) {
  $('oUploads').textContent = u.count
    ? u.count + ' gambar, ' + fmtBytes(u.bytes) + (u.unusedCount ? '. ' + u.unusedCount + ' tidak dipakai (' + fmtBytes(u.unusedBytes) + ')' : '. Semua dipakai frame atau preset.')
    : 'Belum ada gambar unggahan.';
  $('oClean').disabled = !u.unusedCount;
  if (u.removed) setStatus(u.removed + ' gambar dihapus');
}
$('oClean').onclick = () => armed($('oClean'), 'Hapus gambar yang tidak dipakai', 'Klik lagi untuk menghapus', () => ws.send({ type: 'uploads_clean' }));
// daftar virtual frame tersimpan: kosongkan, lalu gambar yang tidak dipakai lagi ikut dibersihkan (yang dipakai kanvas atau preset tetap)
function renderLibInfo() {
  const n = layout.library.filter(e => !layout.slots.some(s => s.id === e.id && s.enabled)).length;
  $('oLib').textContent = n ? n + ' virtual frame tersimpan di daftar (tidak di kanvas).' : 'Tidak ada virtual frame tersimpan di luar kanvas.';
  $('oLibClear').hidden = !layout.library.length;
}
$('oLibClear').onclick = () => armed($('oLibClear'), 'Hapus virtual frame tersimpan', 'Klik lagi untuk menghapus semua', () => {
  layout.library = [];
  commit(); renderLibInfo();
  ws.send({ type: 'uploads_clean' });
});
// ---- export / import preset (preset-io-dialog.js) ----
createPresetIoDialogs({
  presets: () => layout.presets, log, copyText, fmtBytes,
  onImport(added) { layout.presets.push(...added); commit(); renderPresets(); setStatus(added.length + ' preset diimpor'); },
});

// angka yang benar-benar dikirim ke OBS, tiap 2 detik selama tab Atur terbuka
let lastOut = null;
setInterval(async () => {
  if ($('panelAtur').hidden || document.hidden) { lastOut = null; return; }
  if (!pc || !stream) { $('oLive').textContent = 'Sekarang: capture mati'; lastOut = null; return; }
  try {
    for (const r of (await pc.getStats()).values()) {
      if (r.type !== 'outbound-rtp' || r.kind !== 'video') continue;
      const mbps = lastOut ? ((r.bytesSent - lastOut.bytes) * 8) / ((r.timestamp - lastOut.t) * 1000) : null;
      lastOut = { bytes: r.bytesSent, t: r.timestamp };
      $('oLive').textContent = 'Sekarang: ' + Math.round(r.framesPerSecond ?? 0) + ' fps' + (mbps === null ? '' : ', ' + mbps.toFixed(1) + ' Mbps') + (r.frameWidth ? ', ' + r.frameWidth + 'x' + r.frameHeight : '');
    }
  } catch { /* statistik WebRTC tidak tersedia */ }
}, 2000);

// ---- pengaturan cepat (tombol kiri atas kanvas) ----
// Tiap kontrol meneruskan ke kontrol aslinya di sidebar, jadi logikanya tidak dobel dan keduanya selalu sama.
$('qKind').innerHTML = $('aKind').innerHTML;
$('qFps').innerHTML = $('oFps').innerHTML;
for (const [q, orig, ev] of [['qKind', 'aKind', 'change'], ['qBitrate', 'oBitrate', 'input'], ['qFps', 'oFps', 'change']]) {
  $(q).addEventListener(ev, () => { $(orig).value = $(q).value; $(orig).dispatchEvent(new Event(ev)); syncQuick(); });
}
const quickForm = createStyleForm($('quickHost'), {
  onChange(group, patch) { onGeneralStyle(group, patch); generalForm.update(layout.style); quickForm.update(layout.style); },
});
function syncQuick() {
  for (const [q, orig] of [['qKind', 'aKind'], ['qBitrate', 'oBitrate'], ['qFps', 'oFps']]) $(q).value = $(orig).value;
  $('qBitrateVal').textContent = $('qBitrate').value;
  quickForm.update(layout.style);
}
const popUnder = (pop, btn) => { const r = $(btn).getBoundingClientRect(); Object.assign($(pop).style, { left: r.left + 'px', top: r.bottom + 6 + 'px' }); };
$('quickCfg').addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  syncQuick();
  popUnder('quickCfg', 'quickBtn');
});

// ---- safe zone game: area HUD digambar di lapisan bawah tile, hanya di editor; pilihan diingat per browser ----
let safeGame = '';
try { safeGame = localStorage.getItem('waku.safezone') ?? ''; } catch { /* penyimpanan diblokir */ }
function showSafe(key) {
  safeGame = SAFE_ZONES[key] ? key : '';
  try { localStorage.setItem('waku.safezone', safeGame); } catch { /* penyimpanan diblokir */ }
  $('safeLayer').replaceChildren(...(SAFE_ZONES[safeGame]?.zones ?? []).map(z => {
    const d = document.createElement('div');
    d.className = 'sz';
    d.textContent = z.label;
    Object.assign(d.style, { left: z.x + 'px', top: z.y + 'px', width: z.w + 'px', height: z.h + 'px' });
    return d;
  }));
  $('safeBtn').setAttribute('aria-pressed', String(!!safeGame));
  for (const b of $('safeList').children) b.setAttribute('aria-pressed', String(b.dataset.game === safeGame));
}
for (const [key, name] of [['', 'Mati'], ...Object.entries(SAFE_ZONES).map(([k, g]) => [k, g.name])]) {
  const b = document.createElement('button');
  Object.assign(b, { type: 'button', className: 'btn small', textContent: name });
  b.dataset.game = key;
  b.onclick = () => { showSafe(key); $('safeCfg').hidePopover(); };
  $('safeList').append(b);
}
showSafe(safeGame);
$('safeCfg').addEventListener('beforetoggle', e => { if (e.newState === 'open') popUnder('safeCfg', 'safeBtn'); });

// ---- metrik berkala (tiap 10 detik) ----
setInterval(async () => {
  const mem = performance.memory;
  const q = video.getVideoPlaybackQuality?.();
  const data = {
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
    heapLimitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : undefined,
    sampler: gapStat.snapshot(), cost: costStat.snapshot(), slowTicks,
    drawFps: Math.round(drawn / 10), videoFps: Math.round(frames / 10),
    hidden: document.hidden, paused,
    slots: layout.slots.filter(s => s.enabled).length,
    speaking: [...speaking.values()].filter(Boolean).length,
    video: video.videoWidth ? video.videoWidth + 'x' + video.videoHeight : undefined,
    dropped: q?.droppedVideoFrames, pc: pc?.connectionState,
  };
  try {
    const st = await pc?.getStats();
    for (const r of st?.values() ?? []) {
      // codec selalu ada. enc/hwEnc (nama encoder: MediaFoundation = GPU, OpenH264/libvpx = CPU) hanya diisi Chromium
      // bila halaman boleh melihat info hardware (izin kamera/mic); di Chrome biasa sering kosong.
      if (r.type === 'outbound-rtp' && r.kind === 'video') {
        Object.assign(data, { encFps: r.framesPerSecond, qlr: r.qualityLimitationReason, codec: st.get(r.codecId)?.mimeType, enc: r.encoderImplementation, hwEnc: r.powerEfficientEncoder });
      }
    }
  } catch { /* statistik WebRTC tidak tersedia */ }
  gapStat.reset(); costStat.reset(); slowTicks = 0; drawn = 0; frames = 0;
  log('metrics', data);
}, 10000);

// ---- bahasa ID/EN (sidebar kiri bawah); tanpa reload supaya capture tidak putus ----
const langBtn = $('langBtn');
const showLang = () => { langBtn.textContent = getLang().toUpperCase(); };
langBtn.onclick = () => { setLang(getLang() === 'id' ? 'en' : 'id'); showLang(); };
showLang();
startI18n();

// ---- port server (hanya di aplikasi Electron: window.wakuApp dari preload) ----
if (window.wakuApp) {
  const info = await window.wakuApp.info();
  if (info) {
    $('portBox').hidden = false;
    $('portIn').value = info.port;
    const say = t => { $('portInfo').textContent = t; };
    say('Alamat OBS sekarang: http://localhost:' + info.port + '/preview');
    const disarm = () => { $('portApply').classList.remove('armed'); $('portApply').textContent = 'Terapkan'; };
    $('portIn').oninput = disarm;
    $('portFind').onclick = async () => { $('portIn').value = await window.wakuApp.freePort(); disarm(); say('Port kosong ditemukan. Klik Terapkan untuk memakainya.'); };
    $('portApply').onclick = async () => {
      const p = Number($('portIn').value.trim());
      if (!Number.isInteger(p) || p < 1024 || p > 65535) return say('Port harus angka 1024-65535.');
      if (p === info.port) return say('Port ini sudah dipakai sekarang.');
      const b = $('portApply');
      if (!b.classList.contains('armed')) { // pindah port memuat ulang halaman: capture berhenti
        b.classList.add('armed'); b.textContent = 'Klik lagi untuk pindah';
        return say('Halaman dimuat ulang dan capture berhenti; capture lagi setelah pindah. Ganti juga alamat di OBS ke http://localhost:' + p + '/preview');
      }
      disarm();
      const r = await window.wakuApp.setPort(p);
      say(r.ok ? 'Memindahkan Waku ke port ' + p + '...' : r.error === 'busy' ? 'Port ' + p + ' sedang dipakai program lain.' : 'Port tidak valid.');
    };
  }
}

// ---- laporan bug (hanya di aplikasi Electron) ----
if (window.wakuApp?.bugReport) {
  $('bugBox').hidden = false;
  $('bugCopy').onclick = async () => {
    const text = await window.wakuApp.bugReport();
    $('bugInfo').textContent = text ? 'Tersalin. Tempel ke chat atau issue.' : 'Gagal membuat laporan.';
  };
  $('bugLogs').onclick = () => window.wakuApp.openLogs();
}

// ---- update aplikasi (hanya di aplikasi Electron; unduh/pasang di versi installer) ----
await initUpdates({ armed });

// ---- shortcut global / Stream Deck (hanya di aplikasi Electron) ----
if (window.wakuApp?.onCommand) {
  $('keysBox').hidden = false;
  $('qKeysRow').hidden = false;
  $('qKeys').onclick = () => { $('quickCfg').hidePopover(); $('keysOpen').click(); };
  const failText = failed => (failed.length ? 'Sudah dipakai program lain: ' + failed.map(keyLabel).join(', ') : '');
  const applyState = st => {
    appShortcuts = st.list;
    $('keysInfo').textContent = failText(st.failed);
    renderPresets();
  };
  applyState(await window.wakuApp.shortcuts());

  // Aksi di dropdown disandikan "jenis:nilai": preset:<id>, template:<kunci> (kosong = berikutnya), layout:<jenis>, detect:
  const encode = a => (a ? a.type + ':' + (a.id ?? a.key ?? a.kind ?? '') : '');
  const decode = v => {
    const [type, val] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    if (type === 'preset') return { type, id: val };
    if (type === 'template') return val ? { type, key: val } : { type };
    if (type === 'layout' && val) return { type, kind: val };
    if (type === 'detect') return { type };
    return null;
  };
  function actionOptions(current) {
    const opts = [['', 'Pilih aksi...']];
    for (const p of layout.presets) opts.push(['preset:' + p.id, 'Preset: ' + (p.name || 'Tanpa nama')]);
    if (current?.type === 'preset' && !layout.presets.some(p => p.id === current.id)) opts.push([encode(current), 'Preset: (sudah dihapus)']);
    opts.push(['template:', 'Template berikutnya']);
    for (const [k, t] of Object.entries(TEMPLATES)) opts.push(['template:' + k, 'Template: ' + t.name]);
    for (const o of $('aKind').options) if (o.value) opts.push(['layout:' + o.value, 'Susunan: ' + o.text]);
    opts.push(['detect:', 'Deteksi bicara nyala/mati']);
    return opts.map(([v, text]) => new Option(text, v));
  }

  // popup pengaturan: daftar diedit, baru berlaku setelah Simpan
  let rows = [], recording = -1;
  const say = t => { $('keysDlgInfo').textContent = t; };
  function renderRows(focus = -1) { // focus: baris yang tombolnya difokuskan lagi (tombol lama hilang saat digambar ulang)
    if (!rows.length) {
      const e = document.createElement('p');
      e.className = 'hint';
      e.textContent = 'Belum ada shortcut.';
      return $('keysList').replaceChildren(e);
    }
    $('keysList').replaceChildren(...rows.map((r, i) => {
      const row = document.createElement('div');
      row.className = 'key-row';
      const sel = document.createElement('select');
      sel.append(...actionOptions(r.action));
      sel.value = encode(r.action);
      sel.setAttribute('aria-label', 'Aksi');
      sel.onchange = () => { r.action = decode(sel.value); };
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'btn small key' + (recording === i ? ' rec' : '');
      key.textContent = recording === i ? 'Tekan kombinasi...' : r.key ? keyLabel(r.key) : 'Atur tombol';
      key.onclick = () => { recording = recording === i ? -1 : i; renderRows(i); };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small';
      del.textContent = '×';
      del.title = 'Hapus';
      del.setAttribute('aria-label', 'Hapus shortcut');
      del.onclick = () => { rows.splice(i, 1); recording = -1; renderRows(); };
      row.append(sel, key, del);
      return row;
    }));
    $('keysList').querySelectorAll('.key-row .key')[focus]?.focus();
  }
  // KeyboardEvent -> accelerator Electron. Wajib pakai Ctrl/Alt/Shift/Win, kecuali F1-F24.
  function accelerator(e) {
    const c = e.code;
    const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^Numpad\d$/.test(c) ? 'num' + c.slice(6) : /^F([1-9]|1\d|2[0-4])$/.test(c) ? c : null;
    if (!key) return null;
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!mods.length && !key.startsWith('F')) return null;
    return [...mods, key].join('+');
  }
  // Di window (capture), bukan di dialog: fokus bisa saja sedang di luar dialog, misalnya setelah klik di area kosong.
  window.addEventListener('keydown', e => {
    if (recording < 0 || !$('keysDlg').open) return;
    e.preventDefault();
    e.stopPropagation();
    const i = recording;
    if (e.key === 'Escape') { recording = -1; renderRows(i); return; }
    const acc = accelerator(e);
    if (!acc) return; // tunggu sampai tombol utama ditekan (Ctrl/Alt saja belum cukup)
    const other = rows.findIndex((r, j) => j !== i && r.key === acc);
    if (other >= 0) { rows[other].key = ''; say(keyLabel(acc) + ' dipindah dari baris ' + (other + 1)); } else say('');
    rows[i].key = acc;
    recording = -1;
    renderRows(i);
  }, true);
  $('keysDlg').addEventListener('cancel', e => { if (recording >= 0) e.preventDefault(); }); // Esc saat merekam hanya membatalkan rekaman
  $('keysOpen').onclick = async () => {
    const st = await window.wakuApp.pauseShortcuts(true); // selama popup terbuka, menekan kombinasi tidak menjalankan aksi
    rows = structuredClone(st.list);
    recording = -1;
    say(failText(st.failed));
    renderRows();
    $('keysDlg').showModal();
  };
  $('keysDlg').addEventListener('close', async () => { recording = -1; applyState(await window.wakuApp.pauseShortcuts(false)); });
  $('keysClose').onclick = () => $('keysDlg').close();
  $('keysAdd').onclick = () => { rows.push({ key: '', action: null }); recording = -1; say(''); renderRows(); };
  $('keysSave').onclick = async () => {
    if (rows.some(r => !r.action || !r.key)) return say('Setiap baris harus punya aksi dan tombol.');
    const st = await window.wakuApp.setShortcuts(rows);
    if (!st || st.error) return say('Gagal menyimpan.');
    if (st.failed.length) { say(failText(st.failed)); await window.wakuApp.pauseShortcuts(true); return; }
    $('keysDlg').close();
    setStatus('Shortcut disimpan');
  };

  window.wakuApp.onCommand(cmd => { log('shortcut', cmd); runCommand(cmd); });
  // Plugin Stream Deck: tombol status live, pilih preset dari nama. Aplikasi Stream Deck yang memasangnya.
  const installDeck = async () => {
    const err = await window.wakuApp.installDeck();
    if (!err) $('deckUpd').hidden = true;
    $('deckInfo').textContent = !err ? ''
      : err === 'missing' ? 'File plugin tidak ditemukan. Jalankan npm run deck dulu.'
      : 'Gagal membuka plugin. Pastikan aplikasi Stream Deck terpasang.';
    if (err) setStatus($('deckInfo').textContent);
  };
  $('deckInstall').onclick = installDeck;
  // update Waku tidak ikut memperbarui plugin di aplikasi Stream Deck: ingatkan sekali tiap Waku dibuka
  $('deckUpdGo').onclick = installDeck;
  $('deckUpdLater').onclick = () => { $('deckUpd').hidden = true; };
  window.wakuApp.deckOutdated?.().then(old => { $('deckUpd').hidden = !old; });
}

// ---- perintah dari shortcut global dan plugin Stream Deck ----
function runCommand(cmd) {
  if (cmd?.type === 'capture') stopCapture(true); // menu tray: hanya untuk menghentikan
  else if (cmd?.type === 'detect') {
    const want = cmd.set === 'on' ? true : cmd.set === 'off' ? false : !layout.settings.detectEnabled;
    if (want !== layout.settings.detectEnabled) $('sDetect').click();
  } else if (cmd?.type === 'template') {
    const keys = Object.keys(TEMPLATES), sel = $('gTemplate');
    sel.value = cmd.key in TEMPLATES ? cmd.key : keys[(keys.indexOf(layout.template) + 1) % keys.length];
    sel.onchange({ target: sel });
    setStatus('Template: ' + TEMPLATES[sel.value].name);
  } else if (cmd?.type === 'preset') {
    const p = layout.presets.find(x => x.id === cmd.id);
    if (cropDlg.isOpen()) setStatus('Tutup popup Crop dulu sebelum ganti preset');
    else if (p) applyPreset(p);
    else setStatus('Preset untuk shortcut ini sudah dihapus');
  } else if (cmd?.type === 'layout') { // template otomatis, sama seperti klik gambarnya di panel
    const o = [...$('aKind').options].find(x => x.value && x.value === cmd.kind);
    if (cropDlg.isOpen()) setStatus('Tutup popup Crop dulu sebelum ganti susunan');
    else if (o) { applyKind(o.value); setStatus(o.text); }
  }
}
// Status untuk tombol Stream Deck: nama preset, template aktif, deteksi nyala/mati.
function reportDeck() {
  const state = {
    presets: layout.presets.map(p => ({ id: p.id, name: p.name || 'Tanpa nama' })),
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name })),
    layouts: [...$('aKind').options].filter(o => o.value).map(o => ({ key: o.value, name: o.text, short: tr(o.dataset.short) })), // short: judul di tombol Stream Deck
    template: layout.template || '',
    detect: !!layout.settings.detectEnabled,
  };
  const json = JSON.stringify(state);
  if (json !== deckSent && ws.send({ type: 'deck_state', state })) deckSent = json;
}
