import { clampRect, ratioHeight } from './geometry.js';

const MIN_W = 32;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mapActive = (slots, fn) => slots.map(s => (s.enabled ? fn(s) : s));

export function sameSize(slots, w, canvas = { w: 1920, h: 1080 }) {
  return mapActive(slots, s => {
    const ratio = s.crop.w / s.crop.h;
    const width = clampN(w, MIN_W, Math.min(canvas.w, canvas.h * ratio));
    const place = clampRect({ x: s.place.x, y: s.place.y, w: width, h: ratioHeight(width, s.crop) }, canvas);
    return { ...s, place };
  });
}

export function sameRatio(slots, ratio, frame, canvas = { w: 1920, h: 1080 }) {
  return mapActive(slots, s => {
    const f = s.image ? { w: s.imgW, h: s.imgH } : frame; // frame virtual: batasnya gambar, bukan capture
    const w = clampN(s.crop.w, MIN_W, Math.min(f.w, f.h * ratio));
    const crop = clampRect({ x: s.crop.x, y: s.crop.y, w, h: w / ratio }, f);
    // tile ikut rasio baru; kecilkan lebarnya bila tingginya akan melebihi kanvas
    const pw = clampN(s.place.w, MIN_W, Math.min(canvas.w, canvas.h * (crop.w / crop.h)));
    const place = clampRect({ x: s.place.x, y: s.place.y, w: pw, h: ratioHeight(pw, crop) }, canvas);
    return { ...s, crop, place };
  });
}

export function toGrid(slots, cols, gap, canvas = { w: 1920, h: 1080 }) {
  const n = clampN(Math.round(cols), 1, 8);
  const g = clampN(gap, 0, 200);
  const w = (canvas.w - g * (n + 1)) / n;
  const active = slots.filter(s => s.enabled);
  // lebar tiap tile dibatasi agar tingginya muat di kanvas; rasio crop tidak boleh diregangkan
  const widths = active.map(s => Math.min(w, canvas.h * (s.crop.w / s.crop.h)));
  const heights = active.map((s, i) => ratioHeight(widths[i], s.crop));
  const rowH = [];
  heights.forEach((h, i) => { const r = Math.floor(i / n); rowH[r] = Math.max(rowH[r] ?? 0, h); });
  const placed = new Map();
  active.forEach((s, i) => {
    const col = i % n, row = Math.floor(i / n);
    const y = g + rowH.slice(0, row).reduce((a, h) => a + h + g, 0);
    placed.set(s.id, clampRect({ x: g + col * (w + g), y, w: widths[i], h: heights[i] }, canvas));
  });
  return slots.map(s => (placed.has(s.id) ? { ...s, place: placed.get(s.id) } : s));
}

export const AUTO_KINDS = ['grid', 'row', 'column', 'main-right', 'main-bottom', 'bottom', 'top', 'left', 'right', 'sides'];

// Rata tepi: tile berukuran "strip" (bukan memenuhi kanvas) yang menempel ke tepi, jarak antar tile = jarak ke tepi = g.
// Lebar tiap tile mengikuti rasio crop-nya sendiri; bila tidak muat, semua tile mengecil bersama.
const STRIP_H = 0.13; // tinggi tile rata atas/bawah/kiri-kanan: 13% kanvas (~140 px di 1080p)
const ratioOf = s => s.crop.w / s.crop.h;
function edgeRects(active, kind, g, c) {
  if (kind === 'bottom' || kind === 'top') {
    const sum = active.reduce((a, s) => a + ratioOf(s), 0); // lebar total per 1 px tinggi
    const h = Math.min(c.h * STRIP_H, (c.w - 2 * g - g * (active.length - 1)) / sum);
    let x = (c.w - (h * sum + g * (active.length - 1))) / 2; // baris di tengah
    const y = kind === 'top' ? g : c.h - g - h;
    return active.map(s => { const r = { x, y, w: h * ratioOf(s), h }; x += r.w + g; return r; });
  }
  // Kolom: rata kiri/kanan = semua tile satu kolom; sides = setengah pertama (dibulatkan ke atas) kiri, sisanya kanan.
  // Tiap kolom di tengah vertikal. Tinggi tile sama dengan rata atas/bawah; mengecil bersama bila kolom terpanjang tidak muat.
  const left = kind === 'right' ? [] : kind === 'left' ? active : active.slice(0, Math.ceil(active.length / 2));
  const right = active.slice(left.length), n = Math.max(left.length, right.length);
  const h = Math.min(c.h * STRIP_H, (c.h - 2 * g - g * (n - 1)) / n);
  const column = (list, onLeft) => {
    let y = (c.h - (h * list.length + g * (list.length - 1))) / 2;
    return list.map(s => { const w = h * ratioOf(s); const r = { x: onLeft ? g : c.w - g - w, y, w, h }; y += h + g; return r; });
  };
  return [...column(left, true), ...column(right, false)];
}

// Tile dimuat ke dalam sel dengan rasio crop terjaga, di tengah sel.
function fit(s, cell) {
  const ratio = s.crop.w / s.crop.h;
  const w = Math.max(MIN_W, Math.min(cell.w, cell.h * ratio));
  const h = w / ratio;
  return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h };
}

// Sel untuk n tile menurut jenis susunan; g = jarak/margin.
function autoCells(kind, n, g, c) {
  const W = c.w - 2 * g, H = c.h - 2 * g;
  const split = (x, y, w, h, cols, rows) => {
    const cw = (w - g * (cols - 1)) / cols, ch = (h - g * (rows - 1)) / rows;
    return Array.from({ length: cols * rows }, (_, i) => ({ x: x + (i % cols) * (cw + g), y: y + Math.floor(i / cols) * (ch + g), w: cw, h: ch }));
  };
  if (kind === 'row') return split(g, g, W, H, n, 1);
  if (kind === 'column') return split(g, g, W, H, 1, n);
  if (kind === 'main-right' && n > 1) {
    const mw = (W - g) * 0.65;
    return [{ x: g, y: g, w: mw, h: H }, ...split(g + mw + g, g, W - mw - g, H, 1, n - 1)];
  }
  if (kind === 'main-bottom' && n > 1) {
    const mh = (H - g) * 0.7;
    return [{ x: g, y: g, w: W, h: mh }, ...split(g, g + mh + g, W, H - mh - g, n - 1, 1)];
  }
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4; // grid rata (juga untuk 1 tile)
  const rows = Math.ceil(n / cols);
  const all = split(g, g, W, H, cols, rows);
  const last = n - (rows - 1) * cols;
  if (last < cols) for (let i = n - last; i < n; i++) all[i].x += ((cols - last) * (all[0].w + g)) / 2; // baris terakhir ditengahkan
  return all.slice(0, n);
}

// Susunan otomatis untuk semua tile aktif (urutan slot = urutan sel). Hanya posisi/ukuran tile; crop tidak disentuh.
export function autoLayout(slots, kind, gap, canvas = { w: 1920, h: 1080 }) {
  const active = slots.filter(s => s.enabled);
  if (!AUTO_KINDS.includes(kind) || !active.length) return slots;
  const g = clampN(gap, 0, 100);
  const rects = ['bottom', 'top', 'left', 'right', 'sides'].includes(kind) ? edgeRects(active, kind, g, canvas) : autoCells(kind, active.length, g, canvas).map((cell, i) => fit(active[i], cell));
  const placed = new Map(active.map((s, i) => [s.id, clampRect(rects[i], canvas)]));
  return slots.map(s => (placed.has(s.id) ? { ...s, place: placed.get(s.id) } : s));
}
