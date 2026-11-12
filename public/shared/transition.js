// Pasangan frame lama -> baru untuk animasi pindah preset. Urutan: akun Discord sama, id slot sama, nama sama,
// lalu sisanya ke frame terdekat (pasangan paling dekat dikunci dulu supaya lintasan tidak saling silang).
// Kamera hanya dipasangkan dengan kamera, frame gambar dengan frame gambar.
// Hasil: [{ a, b, kind }] dengan kind 'akun' | 'id' | 'nama' | 'dekat' | 'baru' (a null) | 'keluar' (b null).
export function matchSlots(A, B) {
  const pairs = [], ua = new Set(), ub = new Set();
  const step = (kind, key) => B.forEach((b, j) => {
    const k = key(b);
    if (ub.has(j) || !k) return;
    const i = A.findIndex((a, n) => !ua.has(n) && !a.image === !b.image && key(a) === k);
    if (i >= 0) { ua.add(i); ub.add(j); pairs.push({ a: A[i], b, kind }); }
  });
  step('akun', s => s.discordId);
  step('nama', s => s.name); // nama dulu: id sering sama di preset hasil salinan walau orangnya beda
  step('id', s => s.id);
  const mid = s => [s.place.x + s.place.w / 2, s.place.y + s.place.h / 2], cand = [];
  A.forEach((a, i) => B.forEach((b, j) => {
    if (ua.has(i) || ub.has(j) || !a.image !== !b.image) return;
    const [p, q] = mid(a), [u, v] = mid(b);
    cand.push([Math.hypot(p - u, q - v), i, j]);
  }));
  for (const [, i, j] of cand.sort((x, y) => x[0] - y[0])) if (!ua.has(i) && !ub.has(j)) { ua.add(i); ub.add(j); pairs.push({ a: A[i], b: B[j], kind: 'dekat' }); }
  B.forEach((b, j) => { if (!ub.has(j)) pairs.push({ a: null, b, kind: 'baru' }); });
  A.forEach((a, i) => { if (!ua.has(i)) pairs.push({ a, b: null, kind: 'keluar' }); });
  return pairs;
}
