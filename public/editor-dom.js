// Helper DOM bersama editor Layout dan popup crop: posisi kotak, garis bantu, pegangan sudut.

export function place(el, r, k) {
  Object.assign(el.style, { left: r.x * k + 'px', top: r.y * k + 'px', width: r.w * k + 'px', height: r.h * k + 'px' });
}

// Garis dan kotak bantu saat menarik: guide koral untuk tepi yang ditempeli, magenta untuk "ukuran sama dengan slot lain".
// host = elemen tempat menggambar (Layout: #layoutInner pada skala 1, popup: #dlgStage), k = skala host.
export function showGuides(g, host, k) {
  host.querySelectorAll('.guide:not(.m)').forEach(e => e.remove());
  for (const x of g.x) { const e = document.createElement('div'); e.className = 'guide v'; e.style.left = x * k + 'px'; host.append(e); }
  for (const y of g.y) { const e = document.createElement('div'); e.className = 'guide h'; e.style.top = y * k + 'px'; host.append(e); }
}
export function showMatch(host, k, rect, other) {
  host.querySelectorAll('.matchbox, .guide.m').forEach(e => e.remove());
  if (!rect || !other) return;
  const box = document.createElement('div');
  box.className = 'matchbox';
  place(box, other, k);
  const v = document.createElement('div');
  v.className = 'guide v m';
  v.style.left = (rect.x + rect.w) * k + 'px';
  const h = document.createElement('div');
  h.className = 'guide h m';
  h.style.top = (rect.y + rect.h) * k + 'px';
  host.append(box, v, h);
}

// Garis ukur "jarak sama" (dari snapSpacing): garis dengan ujung tegak dan angka jaraknya di tengah.
export function showGaps(host, k, marks) {
  host.querySelectorAll('.gapm').forEach(e => e.remove());
  for (const m of marks) {
    const e = document.createElement('div');
    e.className = 'gapm ' + (m.axis === 'x' ? 'h' : 'v');
    Object.assign(e.style, m.axis === 'x'
      ? { left: m.from * k + 'px', width: (m.to - m.from) * k + 'px', top: m.at * k + 'px' }
      : { top: m.from * k + 'px', height: (m.to - m.from) * k + 'px', left: m.at * k + 'px' });
    const label = document.createElement('b');
    label.textContent = m.value;
    e.append(label);
    host.append(e);
  }
}

// Pegangan ubah ukuran di keempat sudut (pengganti ikon resize di kanan bawah).
export function addCorners(el, list = ['nw', 'ne', 'sw', 'se']) {
  return list.map(c => {
    const h = document.createElement('i');
    h.className = 'c ' + c;
    h.dataset.corner = c;
    el.append(h);
    return h;
  });
}
