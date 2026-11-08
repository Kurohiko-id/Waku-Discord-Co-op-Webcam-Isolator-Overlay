import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, format } from '../tools/logsum.js';

const L = (src, event, data = {}, t = '2026-10-14T10:00:00.000Z') => ({ t, src, event, ...data });

test('summarize: log kosong tidak error', () => {
  const s = summarize([]);
  assert.equal(s.lines, 0);
  assert.deepEqual(s.warnings, []);
  assert.ok(format(s).includes('Tidak ada'));
});

test('summarize: delay deteksi bicara dihitung (n, rata-rata, p95, maks)', () => {
  const lines = [L('control', 'session_start')];
  for (const d of [100, 110, 120, 130, 140, 150, 160, 170, 180, 900]) lines.push(L('control', 'speak_on', { slot: 'a', delayMs: d }));
  const s = summarize(lines);
  assert.equal(s.speak.on, 10);
  assert.equal(s.speak.delay.n, 10);
  assert.equal(s.speak.delay.max, 900);
  assert.ok(s.speak.delay.p95 >= 180);
  assert.ok(s.warnings.some(w => w.includes('delay')));
});

test('summarize: timer deteksi tertunda, tab tersembunyi, dan RAM dilaporkan sebagai peringatan', () => {
  const lines = [
    L('control', 'session_start'),
    L('control', 'metrics', { heapMB: 90, sampler: { n: 100, avg: 101, max: 105 }, slowTicks: 0 }, '2026-10-14T10:00:10.000Z'),
    L('control', 'visibility', { hidden: true }, '2026-10-14T10:00:20.000Z'),
    L('control', 'metrics', { heapMB: 480, sampler: { n: 10, avg: 1000, max: 1004 }, slowTicks: 9 }, '2026-10-14T10:00:30.000Z'),
    L('server', 'server_stats', { rssMB: 700, heapMB: 40 }, '2026-10-14T10:00:30.000Z'),
  ];
  const s = summarize(lines);
  assert.equal(s.control.heapMB.first, 90);
  assert.equal(s.control.heapMB.last, 480);
  assert.equal(s.control.heapMB.max, 480);
  assert.equal(s.control.samplerGapMax, 1004);
  assert.equal(s.control.slowTicks, 9);
  assert.equal(s.control.hiddenEvents, 1);
  assert.equal(s.server.rssMB.max, 700);
  const w = s.warnings.join(' | ');
  assert.ok(/timer/i.test(w), w);
  assert.ok(/RAM|memori/i.test(w), w);
});

test('summarize: koneksi video gagal (ice_failed) jadi peringatan dengan ringkasan kandidat', () => {
  const s = summarize([
    L('control', 'session_start'),
    L('preview', 'ice_failed', { tag: 'preview', gathered: { 'host/udp/mdns': 2 }, remote: {}, pairs: [] }),
  ]);
  const w = s.warnings.find(x => /WebRTC/.test(x));
  assert.ok(w, s.warnings.join(' | '));
  assert.match(w, /mdns/);
});

test('summarize: error dan koneksi putus dicatat; format menghasilkan teks', () => {
  const s = summarize([
    L('control', 'session_start'),
    L('control', 'error', { msg: 'boom' }),
    L('preview', 'conn_close', {}),
    L('preview', 'metrics', { heapMB: 50, latency: { n: 5, avg: 12, max: 30 }, dropped: 10, decoded: 100 }),
  ]);
  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].msg, 'boom');
  assert.equal(s.preview.latency.max, 30);
  assert.ok(s.warnings.some(w => /error/i.test(w)));
  assert.ok(s.warnings.some(w => /frame/i.test(w)));
  assert.match(format(s), /boom/);
});
