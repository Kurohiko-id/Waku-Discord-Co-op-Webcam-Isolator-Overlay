import test from 'node:test';
import assert from 'node:assert/strict';
import { newSlot } from '../public/shared/layout.js';
import { sameSize, sameRatio, toGrid, autoLayout, AUTO_KINDS } from '../public/shared/bulk.js';

const CANVAS = { w: 1920, h: 1080 };
const FRAME = { w: 1920, h: 1080 };
const make = n => Array.from({ length: n }, (_, i) => newSlot('s' + i, i));
const inside = (r, b) => r.x >= 0 && r.y >= 0 && r.x + r.w <= b.w + 1e-6 && r.y + r.h <= b.h + 1e-6;

test('sameSize menyamakan lebar, tinggi mengikuti rasio crop, dan tidak mengubah masukan', () => {
  const slots = make(3);
  slots[1].enabled = false;
  const before = JSON.stringify(slots);
  const out = sameSize(slots, 400, CANVAS);
  assert.equal(JSON.stringify(slots), before);
  assert.equal(out[0].place.w, 400);
  assert.equal(out[0].place.h, 225);
  assert.deepEqual(out[1].place, slots[1].place);
  assert.equal(out[2].place.w, 400);
  for (const s of out) assert.ok(inside(s.place, CANVAS));
});

test('sameSize: lebar terlalu besar atau kecil dibatasi, tile tetap di kanvas', () => {
  const big = sameSize(make(2), 5000, CANVAS);
  for (const s of big) assert.ok(inside(s.place, CANVAS));
  const small = sameSize(make(1), 1, CANVAS);
  assert.ok(small[0].place.w >= 32);
});

test('sameRatio mengubah tinggi crop dan tile, lebar crop tetap bila muat', () => {
  const out = sameRatio(make(2), 1, FRAME);
  assert.equal(out[0].crop.w, 480);
  assert.equal(out[0].crop.h, 480);
  assert.equal(out[0].place.h, out[0].place.w);
  assert.equal(out[0].ratioLocked, true);
  for (const s of out) assert.ok(inside(s.crop, FRAME));
});

test('sameRatio 9:16 memotong lebar crop agar tinggi muat di frame', () => {
  const slots = make(1);
  slots[0].crop = { x: 10, y: 10, w: 1800, h: 1000 };
  const out = sameRatio(slots, 9 / 16, FRAME);
  assert.ok(inside(out[0].crop, FRAME));
  assert.ok(Math.abs(out[0].crop.w / out[0].crop.h - 9 / 16) < 1e-9);
});

test('sameRatio: tile yang kehabisan tinggi dikecilkan agar tetap di kanvas dan rasionya cocok', () => {
  const slots = make(2);
  slots[0].place = { x: 100, y: 100, w: 1800, h: 1012 };
  slots[1].place = { x: 0, y: 0, w: 900, h: 506 };
  const square = sameRatio(slots, 1, FRAME, CANVAS);
  assert.ok(inside(square[0].place, CANVAS));
  assert.ok(Math.abs(square[0].place.w / square[0].place.h - 1) < 1e-9);
  const tall = sameRatio(slots, 9 / 16, FRAME, CANVAS);
  assert.ok(inside(tall[1].place, CANVAS));
  assert.ok(Math.abs(tall[1].place.w / tall[1].place.h - 9 / 16) < 1e-9);
});

test('toGrid menjaga rasio tile: crop 4:3 dan 9:16 tidak diregangkan', () => {
  const s43 = make(1);
  s43[0].crop = { x: 0, y: 0, w: 640, h: 480 };
  const o = toGrid(s43, 1, 0, CANVAS);
  assert.ok(inside(o[0].place, CANVAS));
  assert.ok(Math.abs(o[0].place.w / o[0].place.h - 4 / 3) < 1e-9);
  const tall = make(3).map(s => ({ ...s, crop: { ...s.crop, w: 360, h: 640 } }));
  for (const s of toGrid(tall, 2, 20, CANVAS)) {
    assert.ok(inside(s.place, CANVAS));
    assert.ok(Math.abs(s.place.w / s.place.h - 360 / 640) < 1e-9);
  }
});

test('toGrid 2 kolom: posisi, lebar, urutan, dan semuanya di dalam kanvas', () => {
  const out = toGrid(make(4), 2, 20, CANVAS);
  assert.equal(out[0].place.w, 930);
  assert.equal(out[0].place.x, 20);
  assert.equal(out[1].place.x, 970);
  assert.equal(out[0].place.y, 20);
  assert.equal(out[1].place.y, 20);
  assert.ok(out[2].place.y > out[0].place.y);
  assert.equal(out[2].place.x, 20);
  for (const s of out) assert.ok(inside(s.place, CANVAS));
});

test('toGrid: kolom lebih banyak dari slot, kolom/gap di luar batas, 16 slot, tanpa slot aktif', () => {
  const six = toGrid(make(4), 6, 10, CANVAS);
  assert.ok(six[0].place.w > 0);
  for (const s of six) assert.ok(inside(s.place, CANVAS));
  const wild = toGrid(make(2), 99, -5, CANVAS);
  for (const s of wild) assert.ok(inside(s.place, CANVAS));
  const many = toGrid(make(16), 4, 8, CANVAS);
  assert.equal(many.length, 16);
  for (const s of many) assert.ok(inside(s.place, CANVAS));
  const none = make(2).map(s => ({ ...s, enabled: false }));
  assert.deepEqual(toGrid(none, 2, 10, CANVAS), none);
  assert.deepEqual(sameSize(none, 300, CANVAS), none);
  assert.deepEqual(sameRatio(none, 1, FRAME), none);
});

const overlap = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

test('autoLayout: semua jenis dan jumlah 1-8 muat di kanvas, tidak tumpang tindih, rasio crop terjaga', () => {
  for (const kind of AUTO_KINDS) {
    for (let n = 1; n <= 8; n++) {
      const slots = make(n);
      slots[0].crop = { ...slots[0].crop, w: 400, h: 400 }; // satu slot persegi, sisanya 16:9
      const out = autoLayout(slots, kind, 20, CANVAS);
      out.forEach((s, i) => {
        assert.ok(inside(s.place, CANVAS), `${kind} n=${n} slot ${i} keluar kanvas`);
        assert.ok(Math.abs(s.place.w / s.place.h - s.crop.w / s.crop.h) < 1e-6, `${kind} n=${n} slot ${i} rasio berubah`);
        assert.ok(s.place.w >= 32);
      });
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(!overlap(out[i].place, out[j].place), `${kind} n=${n}: ${i} menimpa ${j}`);
    }
  }
});

test('autoLayout: susunan sesuai namanya dan tidak mengubah masukan atau slot nonaktif', () => {
  const slots = make(3);
  slots[1].enabled = false;
  const before = JSON.stringify(slots);
  const row = autoLayout(slots, 'row', 20, CANVAS);
  assert.equal(JSON.stringify(slots), before);
  assert.deepEqual(row[1], slots[1]);
  assert.ok(Math.abs(row[0].place.y - row[2].place.y) < 1e-6 && row[2].place.x > row[0].place.x + row[0].place.w);

  const duo = make(2);
  const col = autoLayout(duo, 'column', 20, CANVAS);
  assert.ok(col[1].place.y >= col[0].place.y + col[0].place.h);
  const side = autoLayout(duo, 'grid', 20, CANVAS);
  assert.ok(side[1].place.x >= side[0].place.x + side[0].place.w && Math.abs(side[0].place.y - side[1].place.y) < 1e-6);

  const squad = autoLayout(make(4), 'main-right', 20, CANVAS);
  const area = s => s.place.w * s.place.h;
  assert.ok(area(squad[0]) > area(squad[1]) && area(squad[1]) <= area(squad[0]));
  assert.ok(squad[1].place.x >= squad[0].place.x + squad[0].place.w);
  const below = autoLayout(make(4), 'main-bottom', 20, CANVAS);
  assert.ok(below[1].place.y >= below[0].place.y + below[0].place.h);
});

test('autoLayout: jarak 0 dan jenis tak dikenal tidak merusak', () => {
  for (const s of autoLayout(make(5), 'grid', 0, CANVAS)) assert.ok(inside(s.place, CANVAS));
  const slots = make(2);
  assert.deepEqual(autoLayout(slots, 'entah', 20, CANVAS), slots);
  assert.deepEqual(autoLayout([], 'grid', 20, CANVAS), []);
});

test('ukuran utama: rasio lalu lebar disamakan = semua tile persis sama walau rasio crop awalnya beda', () => {
  const slots = make(3);
  slots[1].crop = { x: 100, y: 100, w: 504, h: 298 };
  slots[2].crop = { x: 200, y: 200, w: 348, h: 196 };
  const main = slots[0];
  const out = sameSize(sameRatio(slots, main.crop.w / main.crop.h, FRAME, CANVAS), 420, CANVAS);
  for (const s of out) {
    assert.ok(Math.abs(s.place.w - 420) < 1e-9 && Math.abs(s.place.h - out[0].place.h) < 1e-9);
    assert.ok(Math.abs(s.place.w / s.place.h - s.crop.w / s.crop.h) < 1e-9); // video tidak gepeng
  }
});

test('autoLayout rata bawah/atas: satu baris di tengah, jarak antar tile dan ke tepi sama', () => {
  const g = 20;
  for (const n of [1, 4, 16]) {
    const bottom = autoLayout(make(n), 'bottom', g, CANVAS).map(s => s.place);
    const top = autoLayout(make(n), 'top', g, CANVAS).map(s => s.place);
    for (const p of bottom) assert.ok(Math.abs(p.y + p.h - (CANVAS.h - g)) < 1e-6);
    for (const p of top) assert.ok(Math.abs(p.y - g) < 1e-6);
    const left = bottom[0].x, right = CANVAS.w - (bottom.at(-1).x + bottom.at(-1).w);
    assert.ok(Math.abs(left - right) < 1e-6, 'baris harus di tengah');
    assert.ok(left >= g - 1e-6);
    for (let i = 1; i < n; i++) assert.ok(Math.abs(bottom[i].x - (bottom[i - 1].x + bottom[i - 1].w) - g) < 1e-6, 'jarak antar tile = g');
  }
  assert.ok(autoLayout(make(4), 'bottom', g, CANVAS)[0].place.h <= CANVAS.h * 0.14); // ukuran strip, bukan raksasa
});

test('autoLayout kiri-kanan: setengah di kolom kiri, sisanya di kanan, kolom di tengah vertikal', () => {
  const g = 20;
  const out = autoLayout(make(5), 'sides', g, CANVAS).map(s => s.place);
  const left = out.filter(p => Math.abs(p.x - g) < 1e-6), right = out.filter(p => Math.abs(p.x + p.w - (CANVAS.w - g)) < 1e-6);
  assert.deepEqual([left.length, right.length], [3, 2]);
  for (const col of [left, right]) {
    const topGap = col[0].y, bottomGap = CANVAS.h - (col.at(-1).y + col.at(-1).h);
    assert.ok(Math.abs(topGap - bottomGap) < 1e-6, 'kolom harus di tengah vertikal');
  }
});

test('autoLayout kiri-kanan: ukuran tile sama dengan rata bawah/atas', () => {
  const size = kind => autoLayout(make(4), kind, 32, CANVAS).map(s => [Math.round(s.place.w * 100), Math.round(s.place.h * 100)]);
  assert.deepEqual(size('sides'), size('bottom'));
});
