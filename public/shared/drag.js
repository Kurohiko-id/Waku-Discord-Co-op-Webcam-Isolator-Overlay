// handles: pegangan ubah ukuran, masing-masing dengan data-corner = sudut (nw ne sw se) atau sisi (n s e w); bawaan se.
// resize(rect, alt, corner): rect dengan sudut seberang tetap di tempat; alt = tombol Alt ditekan.
export function attachDrag(el, handles, { get, scale, canResize, begin, move, resize, end, minW = 32, minH = 18 }) {
  let start = null;
  const down = (mode, corner) => e => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'resize' && !canResize()) return;
    start = { mode, corner, px: e.clientX, py: e.clientY, rect: { ...get() } };
    begin?.(mode);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  // Mouse gaming bisa mengirim ratusan pointermove per detik, dan tiap move menata ulang editor:
  // simpan posisi terakhir, proses sekali per frame.
  let last = null, raf = 0;
  const apply = () => {
    raf = 0;
    if (!start || !last) return;
    const k = scale();
    const dx = (last.x - start.px) / k;
    const dy = (last.y - start.py) / k;
    const alt = last.alt;
    last = null;
    const r = start.rect, c = start.corner;
    // argumen kedua: Alt ditekan (mematikan magnet / melepas rasio)
    if (start.mode === 'move') return move({ ...r, x: r.x + dx, y: r.y + dy }, alt);
    const w = Math.max(minW, c.includes('w') ? r.w - dx : c.includes('e') ? r.w + dx : r.w); // sisi n/s: lebar tetap
    const h = Math.max(minH, c.includes('n') ? r.h - dy : c.includes('s') ? r.h + dy : r.h); // sisi e/w: tinggi tetap
    resize({ x: c.includes('w') ? r.x + r.w - w : r.x, y: c.includes('n') ? r.y + r.h - h : r.y, w, h }, alt, c);
  };
  const onMove = e => {
    if (!start) return;
    last = { x: e.clientX, y: e.clientY, alt: e.altKey };
    raf ||= requestAnimationFrame(apply);
  };
  const up = () => {
    if (!start) return;
    cancelAnimationFrame(raf);
    apply(); // posisi terakhir tidak boleh hilang
    start = null;
    end();
  };
  el.addEventListener('pointerdown', down('move'));
  for (const h of [handles].flat()) h.addEventListener('pointerdown', down('resize', h.dataset.corner || 'se'));
  // Cukup di el: pegangan selalu anak el, jadi event-nya (termasuk yang di-capture pegangan) naik ke el.
  // Memasang di keduanya memproses tiap event dua kali.
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
