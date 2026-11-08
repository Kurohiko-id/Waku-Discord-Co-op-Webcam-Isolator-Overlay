import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPresets } from '../public/shared/default-presets.js';
import { validateLayout } from '../public/shared/layout.js';

test('preset bawaan: P2 sampai P7, kamera saja, susunan saja, tidak disematkan', () => {
  const ps = defaultPresets();
  assert.deepEqual(ps.map(p => [p.name, p.slots.length, p.full, p.pinned]), [2, 3, 4, 5, 6, 7].map(n => ['P' + n + '-default', n, false, false]));
  for (const p of ps) for (const s of p.slots) assert.deepEqual([s.name, s.image, s.discordId, s.detect, s.enabled], ['', '', '', false, true]);
});

test('preset bawaan: satu baris di tengah kanvas, jarak 32 px, lolos validasi', () => {
  for (const p of defaultPresets()) {
    const xs = p.slots.map(s => s.place);
    assert.equal(new Set(xs.map(r => Math.round(r.y))).size, 1); // satu baris
    assert.ok(Math.abs(xs[0].x - (1920 - xs.at(-1).x - xs.at(-1).w)) < 0.5); // kiri = kanan
    assert.ok(Math.abs(xs[0].y - (1080 - xs[0].y - xs[0].h)) < 0.5); // atas = bawah
    for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i].x - xs[i - 1].x - xs[i - 1].w - 32) < 0.5);
  }
  assert.equal(validateLayout({ slots: [], presets: defaultPresets() }).presets.length, 6);
});
