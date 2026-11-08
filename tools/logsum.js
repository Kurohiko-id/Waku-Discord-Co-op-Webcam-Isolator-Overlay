// Ringkasan log Waku yang enak dibaca: npm run log  (atau: node tools/logsum.js [--all] [berkas])
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(p * arr.length) - 1)] : 0);
const round1 = v => Math.round(v * 10) / 10;

// Potong ke sesi kontrol terakhir (mulai dari session_start 'control' terakhir).
export function lastSession(lines) {
  let k = -1;
  lines.forEach((l, i) => { if (l.src === 'control' && l.event === 'session_start') k = i; });
  return k < 0 ? lines : lines.slice(k);
}

function series(lines, src, event, pick) {
  return lines.filter(l => l.src === src && l.event === event).map(pick).map(num).filter(v => v !== null);
}
const trend = arr => (arr.length ? { first: arr[0], last: arr.at(-1), max: Math.max(...arr) } : null);

export function summarize(lines) {
  const s = {
    lines: lines.length, from: lines[0]?.t ?? null, to: lines.at(-1)?.t ?? null,
    control: {}, preview: {}, server: {},
    speak: { on: 0, off: 0, delay: { n: 0, avg: 0, p95: 0, max: 0 } },
    errors: [], warnings: [],
  };
  const ev = (src, event) => lines.filter(l => l.src === src && l.event === event);

  s.control.heapMB = trend(series(lines, 'control', 'metrics', l => l.heapMB));
  s.control.samplerGapMax = Math.max(0, ...series(lines, 'control', 'metrics', l => l.sampler?.max));
  s.control.slowTicks = series(lines, 'control', 'metrics', l => l.slowTicks).reduce((a, b) => a + b, 0);
  s.control.hiddenEvents = ev('control', 'visibility').filter(l => l.hidden).length;
  s.control.qlrCpu = ev('control', 'metrics').filter(l => l.qlr === 'cpu').length;

  s.preview.heapMB = trend(series(lines, 'preview', 'metrics', l => l.heapMB));
  s.preview.latency = { avg: 0, max: Math.max(0, ...series(lines, 'preview', 'metrics', l => l.latency?.max)) };
  const lat = ev('preview', 'metrics').filter(l => num(l.latency?.avg) !== null && num(l.latency?.n));
  const latN = lat.reduce((a, l) => a + l.latency.n, 0);
  s.preview.latency.avg = latN ? round1(lat.reduce((a, l) => a + l.latency.avg * l.latency.n, 0) / latN) : 0;
  s.preview.dropped = series(lines, 'preview', 'metrics', l => l.dropped).reduce((a, b) => a + b, 0);
  s.preview.decoded = series(lines, 'preview', 'metrics', l => l.decoded).reduce((a, b) => a + b, 0);

  s.server.rssMB = trend(series(lines, 'server', 'server_stats', l => l.rssMB));

  const on = ev('control', 'speak_on');
  const delays = on.map(l => num(l.delayMs)).filter(v => v !== null);
  s.speak.on = on.length;
  s.speak.off = ev('control', 'speak_off').length;
  s.speak.delay = {
    n: delays.length,
    avg: delays.length ? round1(delays.reduce((a, b) => a + b, 0) / delays.length) : 0,
    p95: pct(delays, 0.95),
    max: delays.length ? Math.max(...delays) : 0,
  };

  s.errors = lines.filter(l => l.event === 'error' || l.event === 'console_error').slice(-10).map(l => ({ t: l.t, src: l.src, event: l.event, msg: l.msg }));
  s.closes = lines.filter(l => l.event === 'conn_close').length;

  const w = s.warnings;
  if (s.speak.delay.n && s.speak.delay.p95 > 400) w.push(`deteksi bicara: delay tinggi (p95 ${s.speak.delay.p95} ms, maks ${s.speak.delay.max} ms)`);
  if (s.control.samplerGapMax > 500 || s.control.slowTicks > 0) w.push(`Timer deteksi tertunda (jeda terbesar ${s.control.samplerGapMax} ms, ${s.control.slowTicks} kali lambat); biasanya tab /control tersembunyi atau di-throttle Chrome`);
  const h = s.control.heapMB;
  if (h && (h.last > 300 || (h.last > 200 && h.last > h.first * 1.8))) w.push(`Pemakaian RAM halaman kontrol tinggi atau naik terus (${h.first} → ${h.last} MB, puncak ${h.max} MB)`);
  const r = s.server.rssMB;
  if (r && r.max > 600) w.push(`RAM server tinggi (puncak ${r.max} MB)`);
  if (s.errors.length) w.push(`Ada ${s.errors.length} error tercatat (lihat daftar di bawah)`);
  if (s.preview.decoded && s.preview.dropped / s.preview.decoded > 0.05) w.push(`Frame di OBS banyak terbuang (${Math.round((100 * s.preview.dropped) / s.preview.decoded)}%)`);
  if (s.closes > 2) w.push(`Koneksi sering putus (${s.closes} kali)`);
  const iceFail = lines.filter(l => l.event === 'ice_failed');
  if (iceFail.length) w.push(`Koneksi video (WebRTC) gagal ${iceFail.length}x; kandidat terakhir [${iceFail.at(-1).tag}] dikumpulkan ${JSON.stringify(iceFail.at(-1).gathered)} remote ${JSON.stringify(iceFail.at(-1).remote)}`);
  if (s.control.qlrCpu) w.push('Encoder membatasi kualitas karena CPU (qualityLimitationReason = cpu)');
  return s;
}

export function format(s) {
  if (!s.lines) return 'Tidak ada data log. Jalankan aplikasinya dulu, pakai sebentar, lalu coba lagi.';
  const t = x => (x ? `${x.first} → ${x.last} MB (puncak ${x.max})` : 'tidak ada data');
  const d = s.speak.delay;
  const out = [`Log Waku: ${s.lines} baris, ${s.from} sampai ${s.to}`, ''];
  out.push(s.warnings.length ? 'PERINGATAN' : 'Tidak ada peringatan.');
  for (const w of s.warnings) out.push('  - ' + w);
  out.push('', 'Deteksi bicara');
  out.push(`  muncul ${s.speak.on}x, berhenti ${s.speak.off}x; delay ${d.n ? `rata-rata ${d.avg} ms, p95 ${d.p95} ms, maks ${d.max} ms (${d.n} sampel)` : 'belum ada sampel'}`);
  out.push(`  timer deteksi: jeda terbesar ${s.control.samplerGapMax || 0} ms, lambat ${s.control.slowTicks || 0}x, tab tersembunyi ${s.control.hiddenEvents || 0}x`);
  out.push('', 'Memori');
  out.push(`  halaman kontrol: ${t(s.control.heapMB)}`);
  out.push(`  preview/OBS    : ${t(s.preview.heapMB)}`);
  out.push(`  server (RSS)   : ${t(s.server.rssMB)}`);
  out.push('', 'Preview/OBS');
  out.push(`  latensi bicara: rata-rata ${s.preview.latency.avg} ms, maks ${s.preview.latency.max} ms; frame terbuang ${s.preview.dropped}/${s.preview.decoded}`);
  if (s.errors.length) {
    out.push('', 'Error terakhir');
    for (const e of s.errors) out.push(`  ${e.t} [${e.src}] ${e.msg}`);
  }
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--')) ?? path.join(root, 'logs', 'waku.log');
  const lines = [];
  for (const f of [4, 3, 2, 1].map(i => `${file}.${i}`).concat(file)) { // paling lama dulu (rotasi di server.js)
    try {
      for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
        try { if (raw) lines.push(JSON.parse(raw)); } catch { /* baris rusak dilewati */ }
      }
    } catch { /* berkas belum ada */ }
  }
  console.log(format(summarize(args.includes('--all') ? lines : lastSession(lines))));
}
