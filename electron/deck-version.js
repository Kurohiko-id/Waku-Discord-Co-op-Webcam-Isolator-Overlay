// Plugin Stream Deck yang terpasang lebih lama dari yang dibawa Waku? (versi "1.1.0.0", dibandingkan per angka)
// Tidak terpasang atau versi tidak terbaca = false: pengguna tanpa Stream Deck tidak diganggu.
const parts = v => (/^\d+(\.\d+)*$/.test(v ?? '') ? v.split('.').map(Number) : null);
export function deckOutdated(installed, bundled) {
  const a = parts(installed), b = parts(bundled);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}
