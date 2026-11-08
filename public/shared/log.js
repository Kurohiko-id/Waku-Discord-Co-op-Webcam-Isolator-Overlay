// Penghitung ringan untuk metrik berkala: n, rata-rata, dan maksimum sejak reset terakhir.
export class Stat {
  constructor() { this.reset(); }
  add(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    this.n++;
    this.sum += v;
    if (v > this.max) this.max = v;
  }
  snapshot() {
    return { n: this.n, avg: this.n ? Math.round((this.sum / this.n) * 10) / 10 : 0, max: Math.round(this.max * 10) / 10 };
  }
  reset() { this.n = 0; this.sum = 0; this.max = 0; }
}

// Diagnosis koneksi WebRTC: catat status ICE, error kandidat, dan saat gagal ringkasan kandidat lokal/remote
// (jenis/protokol/bentuk alamat saja, tanpa IP) serta status pasangan kandidat.
const kindOf = a => (!a ? 'none' : a.endsWith('.local') ? 'mdns' : a.includes(':') ? 'ipv6' : 'ipv4');
const sumCands = list => {
  const o = {};
  for (const c of list) { const k = `${c.candidateType ?? c.type}/${c.protocol}/${kindOf(c.address ?? c.ip)}`; o[k] = (o[k] || 0) + 1; }
  return o;
};
export function watchIce(pc, log, tag) {
  const gathered = []; // kandidat lokal dari event (alamatnya terbaca di sini, tidak di getStats)
  pc.addEventListener('icecandidate', e => e.candidate && gathered.push(e.candidate));
  pc.addEventListener('iceconnectionstatechange', () => log('ice_state', { tag, state: pc.iceConnectionState, gathering: pc.iceGatheringState }));
  pc.addEventListener('icecandidateerror', e => log('ice_error', { tag, code: e.errorCode, text: String(e.errorText).slice(0, 100) }));
  pc.addEventListener('connectionstatechange', async () => {
    if (pc.connectionState !== 'failed') return;
    try {
      const st = [...(await pc.getStats()).values()];
      log('ice_failed', {
        tag,
        gathered: sumCands(gathered),
        local: sumCands(st.filter(r => r.type === 'local-candidate')),
        remote: sumCands(st.filter(r => r.type === 'remote-candidate')),
        pairs: st.filter(r => r.type === 'candidate-pair').slice(0, 6).map(p => ({ state: p.state, nominated: p.nominated, sent: p.bytesSent, rcv: p.bytesReceived })),
      });
    } catch { /* statistik tidak tersedia */ }
  });
}

// Logger klien: mengirim peristiwa ke server lewat WebSocket (server menulisnya ke logs/waku.log).
// Batas laju (30 pesan, isi ulang 10/detik) supaya log tidak membanjir; error global dan console.error ikut dicatat.
export function createLogger(ws) {
  let budget = 30;
  let last = Date.now();
  const queue = []; // peristiwa sebelum koneksi siap
  const log = (event, data = {}) => {
    const now = Date.now();
    budget = Math.min(30, budget + (now - last) / 100);
    last = now;
    if (budget < 1) return;
    budget--;
    queue.push({ type: 'log', event, data });
    while (queue.length && ws.send(queue[0])) queue.shift();
    if (queue.length > 50) queue.shift();
  };
  addEventListener('error', e => log('error', { msg: String(e.message).slice(0, 300), at: `${String(e.filename || '').split('/').pop()}:${e.lineno}` }));
  addEventListener('unhandledrejection', e => log('error', { msg: 'promise: ' + String(e.reason?.message ?? e.reason).slice(0, 300) }));
  const original = console.error;
  console.error = (...args) => {
    log('console_error', { msg: args.map(String).join(' ').slice(0, 300) });
    original.apply(console, args);
  };
  return log;
}
