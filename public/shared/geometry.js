export function ratioHeight(w, crop) {
  return (w * crop.h) / crop.w;
}

// Resize dengan rasio terkunci: hanya lebar yang dipakai, tinggi = lebar / rasio.
export function resizeKeepRatio(r, ratio, bounds, minW = 32) {
  const maxW = Math.max(minW, Math.min(bounds.w - r.x, (bounds.h - r.y) * ratio));
  const w = Math.min(Math.max(r.w, minW), maxW);
  return { x: r.x, y: r.y, w, h: w / ratio };
}

export function clampRect(r, bounds) {
  const w = Math.min(r.w, bounds.w);
  const h = Math.min(r.h, bounds.h);
  return {
    x: Math.min(Math.max(r.x, 0), bounds.w - w),
    y: Math.min(Math.max(r.y, 0), bounds.h - h),
    w, h,
  };
}

// Magnet saat ubah ukuran: lebar (dan tinggi bila rasio tidak terkunci) menempel ke ukuran tile lain,
// dan tepi kanan/bawah menempel ke tepi kanvas atau tepi tile lain. threshold 0 = magnet mati (tombol Alt).
// r = rect yang sedang ditarik (x,y tetap); ratio (w/h) bila rasio terkunci -> tinggi = lebar / ratio.
export function snapResize(r, others, bounds, { threshold = 12, ratio = null, guides: user = { x: [], y: [] } } = {}) {
  const pick = (value, cands) => {
    let best = null;
    for (const c of cands) {
      const d = c.v - value;
      if (c.v > 0 && Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, ...c };
    }
    return best;
  };
  const wc = [{ v: bounds.w - r.x, edge: bounds.w }];
  const hc = [{ v: bounds.h - r.y, edge: bounds.h }];
  for (const gx of user.x) wc.push({ v: gx - r.x, edge: gx });
  for (const gy of user.y) hc.push({ v: gy - r.y, edge: gy });
  for (const o of others) {
    wc.push({ v: o.w }, { v: o.x - r.x, edge: o.x }, { v: o.x + o.w - r.x, edge: o.x + o.w });
    hc.push({ v: o.h }, { v: o.y - r.y, edge: o.y }, { v: o.y + o.h - r.y, edge: o.y + o.h });
  }
  const guides = { x: [], y: [] };
  const bw = pick(r.w, wc);
  const w = bw ? bw.v : r.w;
  if (bw?.edge !== undefined) guides.x.push(bw.edge);
  let h;
  if (ratio) {
    h = w / ratio;
  } else {
    const bh = pick(r.h, hc);
    h = bh ? bh.v : r.h;
    if (bh?.edge !== undefined) guides.y.push(bh.edge);
  }
  const m = others.findIndex(o => Math.abs(o.w - w) < 0.5 && Math.abs(o.h - h) < 0.5);
  return { w, h, guides, matchIndex: m < 0 ? null : m };
}

// Ubah ukuran dari sudut mana pun (nw, ne, sw, se); sudut seberang tetap di tempat.
// Sumbu dicerminkan supaya sudut yang ditarik selalu jadi kanan-bawah, lalu snapResize/resizeKeepRatio dipakai apa adanya.
export function resizeCorner(r, corner, bounds, others = [], { threshold = 12, ratio = null, guides = { x: [], y: [] }, minW = 32 } = {}) {
  const fx = corner.includes('w'), fy = corner.includes('n');
  const mx = v => (fx ? bounds.w - v : v), my = v => (fy ? bounds.h - v : v);
  const flip = q => ({ x: fx ? bounds.w - q.x - q.w : q.x, y: fy ? bounds.h - q.y - q.h : q.y, w: q.w, h: q.h });
  const fr = flip(r);
  const sn = snapResize(fr, others.map(flip), bounds, { threshold, ratio, guides: { x: guides.x.map(mx), y: guides.y.map(my) } });
  const out = ratio
    ? resizeKeepRatio({ ...fr, w: sn.w }, ratio, bounds, minW)
    : { ...fr, w: Math.min(sn.w, bounds.w - fr.x), h: Math.min(sn.h, bounds.h - fr.y) };
  return { rect: flip(out), guides: { x: sn.guides.x.map(mx), y: sn.guides.y.map(my) }, matchIndex: sn.matchIndex };
}

// Potong seperti Alt-drag di OBS: bingkai tile (r) bergeser, gambar kamera tetap di skala yang sama (p0/c0 saat mulai).
// Tiap px yang digeser di kanvas = 1/skala px crop di frame. Crop bisa melebar lagi sampai tepi frame (f),
// dan bingkai ikut berhenti di sana supaya gambar tidak pernah melar.
// f = null: tanpa batas (frame virtual: di luar gambar terlihat warna latar).
export function cropFromTile(r, p0, c0, f) {
  const k = p0.w / c0.w;
  const lo = f ? 0 : -Infinity;
  const x1 = Math.max(lo, c0.x + (r.x - p0.x) / k), y1 = Math.max(lo, c0.y + (r.y - p0.y) / k);
  const x2 = Math.min(f?.w ?? Infinity, c0.x + (r.x + r.w - p0.x) / k), y2 = Math.min(f?.h ?? Infinity, c0.y + (r.y + r.h - p0.y) / k);
  const crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return { place: { x: p0.x + (x1 - c0.x) * k, y: p0.y + (y1 - c0.y) * k, w: crop.w * k, h: crop.h * k }, crop };
}

// Semua tepi/tengah r yang sejajar (selisih <= tol px) dengan tepi/tengah tile lain atau kanvas, untuk garis bantu
// "sudah sejajar belum". Mengembalikan posisi garisnya (bukan posisi r), terurut dan unik.
export function alignedLines(r, others, canvas = { w: 1920, h: 1080 }, tol = 1) {
  const axis = (pos, size, canvasSize, key, sizeKey) => {
    const cand = new Set([0, canvasSize]); // tengah kanvas sengaja tidak dihitung (tidak menarik tile)
    for (const o of others) { cand.add(o[key]); cand.add(o[key] + o[sizeKey] / 2); cand.add(o[key] + o[sizeKey]); }
    const edges = [pos, pos + size / 2, pos + size];
    return [...cand].filter(c => edges.some(e => Math.abs(e - c) <= tol)).sort((p, q) => p - q);
  };
  return { x: axis(r.x, r.w, canvas.w, 'x', 'w'), y: axis(r.y, r.h, canvas.h, 'y', 'h') };
}

// Snap pada gerakan (lihat snapResize untuk ubah ukuran).
export function snapRect(r, others, canvas = { w: 1920, h: 1080 }, threshold = 12, user = { x: [], y: [] }) {
  const xs = [0, canvas.w, ...user.x]; // tepi kanvas saja: tengah kanvas mengganggu saat menggeser bebas
  const ys = [0, canvas.h, ...user.y];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const axis = (pos, size, lines) => {
    let best = null;
    for (const off of [0, size / 2, size]) {
      for (const line of lines) {
        const d = line - (pos + off);
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, line };
      }
    }
    return best;
  };
  const bx = axis(r.x, r.w, xs);
  const by = axis(r.y, r.h, ys);
  return {
    x: r.x + (bx?.d ?? 0),
    y: r.y + (by?.d ?? 0),
    guides: { x: bx ? [bx.line] : [], y: by ? [by.line] : [] },
  };
}
