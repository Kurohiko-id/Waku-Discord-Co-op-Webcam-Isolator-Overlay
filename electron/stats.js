// Statistik anonim ke dash.kurohiko.id (lihat bagian Privasi di README): install, versi, OS, bahasa, fitur yang dipakai, error.
// Hanya aplikasi hasil installer yang mengirim; `npm run app` (dev) tidak.
import fs from 'node:fs';
import path from 'node:path';
import kuroStats from './kuro-stats.cjs';

const FEATURE = /^f_[a-z0-9_.-]{1,30}$/;
const today = () => new Date().toISOString().slice(0, 10);

export function createStats({ version, dir, enabled, client = kuroStats({ app: 'waku', version, dir, enabled }) }) {
  const s = client;
  // fitur yang sudah terkirim hari ini disimpan ke file, supaya buka-tutup Waku tidak mengirim ulang
  const file = path.join(dir, 'stats-features.json');
  let sent = new Set(), day = '';
  try { ({ day, sent } = JSON.parse(fs.readFileSync(file, 'utf8'))); sent = new Set(sent); } catch { sent = new Set(); }
  const errs = new Set();
  let last = [];
  // tiap fitur paling banyak sekali sehari: yang dihitung "berapa orang memakai", bukan berapa kali diklik
  const features = (list = last) => {
    last = list.filter(f => f !== 'f_preset_switch'); // kejadian, bukan keadaan: jangan diulang besok tanpa pindah preset
    if (day !== today()) { day = today(); sent = new Set(); }
    const fresh = list.filter(f => FEATURE.test(f) && !sent.has(f));
    if (!fresh.length) return;
    for (const f of fresh) { sent.add(f); s.track(f); }
    if (enabled) try { fs.writeFileSync(file, JSON.stringify({ day, sent: [...sent] })); } catch {} // dev berbagi folder data, jangan tandai
  };
  return {
    start() { s.start(); setInterval(() => features(), 3600e3).unref(); },
    features,
    error(e) { // pesan yang sama cukup sekali per sesi, maksimal 10
      const k = String(e?.message ?? e).slice(0, 100);
      if (errs.size < 10 && !errs.has(k)) { errs.add(k); s.error(e); }
    },
  };
}
