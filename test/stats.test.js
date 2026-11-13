import test from 'node:test';
import assert from 'node:assert/strict';
import { featureList } from '../server.js';
import { validateLayout } from '../public/shared/layout.js';

const slot = (id, extra) => ({ id, name: id, enabled: true, crop: { x: 0, y: 0, w: 10, h: 10 }, place: { x: 0, y: 0, w: 10, h: 10 }, ...extra });

test('featureList hanya berisi nama fitur, tanpa nama/akun', () => {
  const l = validateLayout({
    slots: [slot('a', { discordId: '123456789012', name: 'Rahasia' }), slot('b', { detect: true }), slot('c', { image: '/uploads/0123456789abcdef.png', imgW: 10, imgH: 10 }), slot('d', { enabled: false })],
    settings: { transitionMs: 0 },
  });
  const f = featureList(l);
  for (const k of ['f_frames_3-4', 'f_official', 'f_manual', 'f_virtual', 'f_transition_off']) assert.ok(f.includes(k), k);
  assert.ok(f.every(x => /^f_[a-z0-9_.-]+$/.test(x)));
  assert.ok(!JSON.stringify(f).includes('Rahasia') && !JSON.stringify(f).includes('123456789012'));
  assert.deepEqual(featureList(validateLayout({ slots: [slot('a', { detect: true })], settings: { detectEnabled: false } })).filter(x => /detect|manual|official/.test(x)), ['f_detect_off']);
});

test('fitur yang sudah terkirim hari ini tidak dikirim ulang setelah Waku dibuka lagi', async () => {
  const { createStats } = await import('../electron/stats.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const open = () => { const got = []; return { got, st: createStats({ dir, enabled: true, client: { track: f => got.push(f) } }) }; };
  const a = open(); a.st.features(['f_manual', 'f_official']);
  const b = open(); b.st.features(['f_manual', 'f_label']);
  assert.deepEqual(a.got, ['f_manual', 'f_official']);
  assert.deepEqual(b.got, ['f_label']);
  fs.rmSync(dir, { recursive: true });
});

test('fitur yang gagal terkirim (offline) dikirim lagi saat Waku dibuka berikutnya', async () => {
  const { createStats } = await import('../electron/stats.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const got = [];
  createStats({ dir, enabled: true, client: { track: async () => false } }).features(['f_manual']);
  await new Promise(r => setTimeout(r, 10));
  createStats({ dir, enabled: true, client: { track: f => got.push(f) } }).features(['f_manual']);
  assert.deepEqual(got, ['f_manual']);
  fs.rmSync(dir, { recursive: true });
});
