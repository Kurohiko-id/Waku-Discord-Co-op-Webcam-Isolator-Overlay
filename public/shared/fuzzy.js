// Pencarian yang memaafkan typo: huruf besar/kecil, spasi, dan tanda baca diabaikan; tiap kata yang diketik cukup
// cocok dengan awal salah satu kata di teks, dengan salah ketik maksimal 1 huruf (kata 4-6 huruf) atau 2 (lebih panjang).
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function dist(a, b) { // jarak edit Levenshtein
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const wordHit = (tok, word) => {
  if (word.startsWith(tok)) return true;
  const max = tok.length <= 3 ? 0 : tok.length <= 6 ? 1 : 2;
  if (!max) return false;
  for (let n = tok.length - max; n <= tok.length + max; n++) if (n > 0 && n <= word.length && dist(tok, word.slice(0, n)) <= max) return true;
  return false;
};

export function fuzzyMatch(query, text) {
  const q = norm(query), t = norm(text);
  if (!q) return true;
  if (t.replace(/ /g, '').includes(q.replace(/ /g, ''))) return true; // "pskingame" cocok dengan "PSK IN GAME"
  const words = t.split(' ');
  return q.split(' ').every(tok => words.some(w => wordHit(tok, w)));
}
