// Rata, jarak sama, dan rapikan ala Figma. Masukan dan keluaran: array rect { x, y, w, h } dengan urutan yang sama
// (keluaran salinan baru, masukan tidak diubah). Batas kanvas diurus pemanggil.

export const unionRect = rs => {
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
  return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
};

// mode: left | hcenter | right | top | vcenter | bottom. Acuan bawaan = kotak gabungan pilihan.
export function alignRects(rs, mode, b = unionRect(rs)) {
  return rs.map(r => {
    const o = { ...r };
    if (mode === 'left') o.x = b.x;
    else if (mode === 'hcenter') o.x = Math.round(b.x + (b.w - r.w) / 2);
    else if (mode === 'right') o.x = b.x + b.w - r.w;
    else if (mode === 'top') o.y = b.y;
    else if (mode === 'vcenter') o.y = Math.round(b.y + (b.h - r.h) / 2);
    else if (mode === 'bottom') o.y = b.y + b.h - r.h;
    return o;
  });
}

const keys = axis => (axis === 'x' ? ['x', 'w'] : ['y', 'h']);
const orderBy = (rs, p) => rs.map((_, i) => i).sort((a, b) => rs[a][p] - rs[b][p] || a - b);

// Arah susunan: sebaran titik tengah yang lebih lebar.
export function axisOf(rs) {
  const spread = f => Math.max(...rs.map(f)) - Math.min(...rs.map(f));
  return spread(r => r.x + r.w / 2) >= spread(r => r.y + r.h / 2) ? 'x' : 'y';
}

// Frame paling ujung tetap; yang di antaranya diatur supaya celahnya sama.
export function distribute(rs, axis) {
  const out = rs.map(r => ({ ...r }));
  if (rs.length < 3) return out;
  const [p, s] = keys(axis);
  const order = orderBy(rs, p);
  const first = rs[order[0]], last = rs[order.at(-1)];
  const gap = (last[p] + last[s] - first[p] - rs.reduce((t, r) => t + r[s], 0)) / (rs.length - 1);
  let pos = first[p];
  for (const i of order) { out[i][p] = Math.round(pos); pos += rs[i][s] + gap; }
  return out;
}

// Berjajar mulai dari frame paling depan dengan celah tepat `gap` piksel.
export function spaceRects(rs, axis, gap) {
  const out = rs.map(r => ({ ...r }));
  const [p, s] = keys(axis);
  let pos = Math.min(...rs.map(r => r[p]));
  for (const i of orderBy(rs, p)) { out[i][p] = Math.round(pos); pos += rs[i][s] + gap; }
  return out;
}

// Rapikan: kelompokkan jadi baris (urut titik tengah; masuk baris bila bertumpuk vertikal dengan baris itu), urutkan kiri ke kanan, lalu susun
// sebagai tabel dengan celah `gap`. Lebar kolom / tinggi baris = frame terbesar di kolom / baris itu.
export function tidy(rs, gap) {
  const out = rs.map(r => ({ ...r }));
  if (!rs.length) return out;
  const rows = [];
  for (const i of orderBy(rs.map(r => ({ c: r.y + r.h / 2 })), 'c')) {
    const r = rs[i], row = rows.at(-1);
    if (row && r.y < row.bottom) { row.items.push(i); row.bottom = Math.max(row.bottom, r.y + r.h); } else rows.push({ items: [i], bottom: r.y + r.h });
  }
  for (const row of rows) row.items.sort((a, b) => rs[a].x - rs[b].x || a - b);
  const colW = [], rowH = rows.map(row => Math.max(...row.items.map(i => rs[i].h)));
  for (const row of rows) row.items.forEach((i, c) => { colW[c] = Math.max(colW[c] ?? 0, rs[i].w); });
  const b = unionRect(rs);
  let y = b.y;
  rows.forEach((row, ri) => {
    let x = b.x;
    row.items.forEach((i, c) => { out[i].x = Math.round(x); out[i].y = Math.round(y); x += colW[c] + gap; });
    y += rowH[ri] + gap;
  });
  return out;
}
