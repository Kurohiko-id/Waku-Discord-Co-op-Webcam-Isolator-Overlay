import test from 'node:test';
import assert from 'node:assert/strict';
import { alignRects, axisOf, distribute, spaceRects, tidy, unionRect } from '../public/shared/align.js';

const R = (x, y, w = 100, h = 50) => ({ x, y, w, h });
const gaps = (rs, p, s) => [...rs].sort((a, b) => a[p] - b[p]).map((r, i, a) => (i ? r[p] - (a[i - 1][p] + a[i - 1][s]) : null)).slice(1);

test('alignRects: rata ke kotak gabungan, atau ke acuan yang diberikan, tanpa mengubah masukan', () => {
  const rs = [R(10, 0), R(300, 40, 50, 20)];
  const before = JSON.stringify(rs);
  assert.deepEqual(alignRects(rs, 'left').map(r => r.x), [10, 10]);
  assert.deepEqual(alignRects(rs, 'right').map(r => r.x + r.w), [350, 350]);
  assert.deepEqual(alignRects(rs, 'bottom').map(r => r.y + r.h), [60, 60]);
  assert.deepEqual(alignRects(rs, 'hcenter').map(r => r.x + r.w / 2), [180, 180]);
  const canvas = { x: 0, y: 0, w: 1920, h: 1080 };
  assert.deepEqual(alignRects([R(5, 5, 400, 200)], 'vcenter', canvas)[0].y, 440);
  assert.equal(JSON.stringify(rs), before);
});

test('distribute: ujung tetap, celah di antaranya sama', () => {
  const rs = [R(0, 0), R(500, 0, 60), R(130, 0, 200), R(900, 0)];
  const out = distribute(rs, 'x');
  assert.equal(out[0].x, 0);
  assert.equal(out[3].x, 900);
  const g = gaps(out, 'x', 'w');
  assert.ok(Math.max(...g) - Math.min(...g) <= 1, String(g));
  assert.deepEqual(distribute(rs.slice(0, 2), 'x'), rs.slice(0, 2)); // < 3 frame: tidak berubah
});

test('spaceRects: celah tepat sesuai angka, mulai dari frame paling atas', () => {
  const out = spaceRects([R(0, 300), R(0, 20), R(0, 700, 100, 80)], 'y', 24);
  assert.deepEqual(gaps(out, 'y', 'h'), [24, 24]);
  assert.equal(Math.min(...out.map(r => r.y)), 20);
});

test('axisOf: arah sebaran yang lebih lebar', () => {
  assert.equal(axisOf([R(0, 0), R(800, 30)]), 'x');
  assert.equal(axisOf([R(0, 0), R(30, 600)]), 'y');
});

test('tidy: baris dan kolom dikenali, celah rata, sudut kiri atas tetap', () => {
  // 2 baris x 2 kolom yang berantakan
  const rs = [R(410, 10), R(100, 0), R(95, 200), R(400, 230)];
  const out = tidy(rs, 20);
  assert.deepEqual(out[1], R(95, 0));      // kiri atas
  assert.deepEqual(out[0], R(215, 0));     // kanan atas: 95 + 100 + 20
  assert.deepEqual(out[2], R(95, 70));     // kiri bawah: 0 + 50 + 20
  assert.deepEqual(out[3], R(215, 70));
  assert.equal(unionRect(out).x, unionRect(rs).x);
});
