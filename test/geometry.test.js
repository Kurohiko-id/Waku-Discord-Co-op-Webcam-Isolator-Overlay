import test from 'node:test';
import assert from 'node:assert/strict';
import { snapRect, ratioHeight, clampRect, resizeKeepRatio, snapResize, alignedLines, resizeCorner, cropFromTile, snapSpacing } from '../public/shared/geometry.js';

// Tiga frame sebaris: frame 1 dan 2 berjarak 61 px; frame 3 digeser mendekati jarak yang sama dari frame 2.
const f1 = { x: 100, y: 200, w: 300, h: 500 }, f2 = { x: 461, y: 200, w: 300, h: 500 };
test('snapSpacing: jarak frame 3 ke frame 2 menempel ke jarak frame 1-2 (61 px), dengan garis ukur', () => {
  const s = snapSpacing({ x: 829, y: 210, w: 300, h: 500 }, [f1, f2]); // jarak sekarang 68
  assert.equal(s.x.d, -7); // x jadi 822 = 761 + 61
  assert.deepEqual(s.x.marks.map(m => [m.axis, m.from, m.to, m.value]), [['x', 400, 461, 61], ['x', 761, 822, 61]]);
  assert.equal(s.y, null); // tidak ada yang sebaris secara vertikal
});

test('snapSpacing: ke kiri juga, dan terlalu jauh tidak menempel', () => {
  assert.equal(snapSpacing({ x: -270, y: 200, w: 300, h: 500 }, [f1, f2]).x.d, 9); // tepi kanan 30 -> 39 = 100 - 61
  assert.equal(snapSpacing({ x: 850, y: 200, w: 300, h: 500 }, [f1, f2]).x, null); // jarak 89, selisih 28 > 12
});

test('snapSpacing: ditengahkan di antara dua tetangga, kedua jarak sama', () => {
  const s = snapSpacing({ x: 205, y: 0, w: 100, h: 100 }, [{ x: 0, y: 0, w: 100, h: 100 }, { x: 400, y: 0, w: 100, h: 100 }]);
  assert.equal(s.x.d, -5);
  assert.deepEqual(s.x.marks.map(m => m.value), [100, 100]);
});

test('snapSpacing: tile yang tidak sebaris tidak dihitung; sumbu y bekerja sama', () => {
  assert.equal(snapSpacing({ x: 829, y: 800, w: 300, h: 100 }, [f1, f2]).x, null);
  const col = [{ x: 0, y: 0, w: 200, h: 100 }, { x: 0, y: 140, w: 200, h: 100 }]; // jarak vertikal 40
  assert.equal(snapSpacing({ x: 10, y: 285, w: 200, h: 100 }, col).y.d, -5);
});

test('snapResize: lebar menempel ke lebar tile lain, tinggi ikut rasio, dan melaporkan kecocokan', () => {
  const others = [{ x: 600, y: 0, w: 448, h: 252 }];
  const r = snapResize({ x: 0, y: 0, w: 445, h: 250 }, others, { w: 1920, h: 1080 }, { ratio: 16 / 9 });
  assert.equal(r.w, 448);
  assert.equal(r.h, 252);
  assert.equal(r.matchIndex, 0);
});

test('snapResize: di luar ambang tidak menempel dan tidak melaporkan kecocokan', () => {
  const others = [{ x: 600, y: 0, w: 448, h: 252 }];
  const r = snapResize({ x: 0, y: 0, w: 400, h: 225 }, others, { w: 1920, h: 1080 }, { ratio: 16 / 9 });
  assert.equal(r.w, 400);
  assert.equal(r.matchIndex, null);
  assert.deepEqual(r.guides, { x: [], y: [] });
});

test('snapResize: tepi kanan menempel ke tepi kanvas dengan garis bantu', () => {
  const r = snapResize({ x: 1500, y: 0, w: 415, h: 233 }, [], { w: 1920, h: 1080 }, { ratio: 16 / 9 });
  assert.equal(r.w, 420);
  assert.deepEqual(r.guides.x, [1920]);
});

test('snapResize: tepi kanan menempel ke tepi kiri tile lain', () => {
  const r = snapResize({ x: 100, y: 0, w: 395, h: 222 }, [{ x: 500, y: 300, w: 200, h: 100 }], { w: 1920, h: 1080 }, { ratio: 16 / 9 });
  assert.equal(r.w, 400);
  assert.deepEqual(r.guides.x, [500]);
});

test('snapResize: tanpa rasio, lebar dan tinggi menempel sendiri-sendiri', () => {
  const others = [{ x: 600, y: 0, w: 448, h: 252 }, { x: 0, y: 500, w: 300, h: 600 }];
  const r = snapResize({ x: 0, y: 0, w: 440, h: 595 }, others, { w: 1920, h: 1080 });
  assert.equal(r.w, 448);
  assert.equal(r.h, 600);
});

test('alignedLines: semua tepi/tengah yang sejajar persis dengan tile lain atau kanvas', () => {
  const others = [{ x: 600, y: 0, w: 200, h: 100 }, { x: 0, y: 500, w: 300, h: 100 }];
  // x: tepi kiri = tepi kiri tile 1 (600). y: tengah (500) = tepi atas tile 2, dan tepi bawah (600) = tepi bawah tile 2
  const g = alignedLines({ x: 600, y: 400, w: 120, h: 200 }, others, { w: 1920, h: 1080 });
  assert.deepEqual(g.x, [600]);
  assert.deepEqual(g.y, [500, 600]);
  assert.deepEqual(alignedLines({ x: 601, y: 401, w: 120, h: 200 }, others, { w: 1920, h: 1080 }).x, [600]); // selisih 1 px masih dihitung
  assert.deepEqual(alignedLines({ x: 650, y: 150, w: 120, h: 130 }, others, { w: 1920, h: 1080 }), { x: [], y: [] });
  assert.deepEqual(alignedLines({ x: 0, y: 0, w: 100, h: 100 }, [], { w: 1920, h: 1080 }), { x: [0], y: [0] }); // tepi kanvas
});

test('snapRect: tile menempel ke guide pengguna', () => {
  const r = snapRect({ x: 495, y: 300, w: 100, h: 50 }, [], { w: 1920, h: 1080 }, 12, { x: [500], y: [] });
  assert.equal(r.x, 500);
  assert.deepEqual(r.guides.x, [500]);
  const bawah = snapRect({ x: 100, y: 565, w: 100, h: 50 }, [], { w: 1920, h: 1080 }, 12, { x: [], y: [620] });
  assert.equal(bawah.y, 570); // tepi bawah (y + h) menempel ke guide 620
});

test('snapResize: tepi kanan dan bawah menempel ke guide pengguna', () => {
  const r = snapResize({ x: 100, y: 100, w: 595, h: 300 }, [], { w: 1920, h: 1080 }, { guides: { x: [700], y: [] } });
  assert.equal(r.w, 600);
  assert.deepEqual(r.guides.x, [700]);
  const h = snapResize({ x: 0, y: 100, w: 400, h: 295 }, [], { w: 1920, h: 1080 }, { guides: { x: [], y: [400] } });
  assert.equal(h.h, 300);
});

test('snapResize: kandidat terdekat menang dan threshold 0 (tombol Alt) mematikan magnet', () => {
  const others = [{ x: 900, y: 0, w: 440, h: 100 }, { x: 900, y: 0, w: 448, h: 100 }];
  assert.equal(snapResize({ x: 0, y: 0, w: 446, h: 100 }, others, { w: 1920, h: 1080 }).w, 448);
  assert.equal(snapResize({ x: 0, y: 0, w: 446, h: 100 }, others, { w: 1920, h: 1080 }, { threshold: 0 }).w, 446);
});

const BOUNDS = { w: 1920, h: 1080 };

test('resizeKeepRatio: tinggi mengikuti lebar dan rasio', () => {
  assert.deepEqual(resizeKeepRatio({ x: 100, y: 100, w: 640, h: 999 }, 16 / 9, BOUNDS), { x: 100, y: 100, w: 640, h: 360 });
});

test('resizeKeepRatio: dibatasi tepi kanan dan tepi bawah frame', () => {
  assert.deepEqual(resizeKeepRatio({ x: 1800, y: 0, w: 400, h: 0 }, 16 / 9, BOUNDS), { x: 1800, y: 0, w: 120, h: 67.5 });
  assert.deepEqual(resizeKeepRatio({ x: 0, y: 1000, w: 640, h: 0 }, 2, BOUNDS), { x: 0, y: 1000, w: 160, h: 80 });
});

test('resizeKeepRatio: lebar minimum 32', () => {
  assert.deepEqual(resizeKeepRatio({ x: 0, y: 0, w: 10, h: 0 }, 2, BOUNDS), { x: 0, y: 0, w: 32, h: 16 });
});

const CANVAS = { w: 1920, h: 1080 };

test('snap ke tepi kiri kanvas', () => {
  const r = snapRect({ x: 5, y: 300, w: 100, h: 50 }, [], CANVAS);
  assert.deepEqual(r, { x: 0, y: 300, guides: { x: [0], y: [] } });
});

test('snap tepi kanan ke tepi kanan kanvas', () => {
  const r = snapRect({ x: 1810, y: 0, w: 100, h: 50 }, [], CANVAS);
  assert.deepEqual(r, { x: 1820, y: 0, guides: { x: [1920], y: [0] } });
});

test('snap tepi kanan ke tepi kiri tile lain', () => {
  const others = [{ x: 500, y: 0, w: 200, h: 100 }];
  const r = snapRect({ x: 395, y: 700, w: 100, h: 50 }, others, CANVAS);
  assert.deepEqual(r, { x: 400, y: 700, guides: { x: [500], y: [] } });
});

test('tidak snap di luar ambang', () => {
  const r = snapRect({ x: 100, y: 100, w: 100, h: 50 }, [], CANVAS);
  assert.deepEqual(r, { x: 100, y: 100, guides: { x: [], y: [] } });
});

test('ratioHeight mengikuti rasio crop', () => {
  assert.equal(ratioHeight(480, { w: 480, h: 270 }), 270);
  assert.equal(ratioHeight(320, { w: 480, h: 270 }), 180);
});

test('clampRect menahan crop di dalam frame', () => {
  const b = { w: 1920, h: 1080 };
  assert.deepEqual(clampRect({ x: -10, y: 2000, w: 100, h: 100 }, b), { x: 0, y: 980, w: 100, h: 100 });
  assert.deepEqual(clampRect({ x: 1900, y: 0, w: 100, h: 100 }, b), { x: 1820, y: 0, w: 100, h: 100 });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 3000, h: 500 }, b), { x: 0, y: 0, w: 1920, h: 500 });
});

test('snapRect: tengah kanvas tidak menarik tile; tepi kanvas dan slot lain tetap', () => {
  const tengah = snapRect({ x: 905, y: 485, w: 100, h: 100 }, [], { w: 1920, h: 1080 }, 12); // tengah tile 5 px dari tengah kanvas
  assert.deepEqual([tengah.x, tengah.y, tengah.guides], [905, 485, { x: [], y: [] }]);
  const tepi = snapRect({ x: 6, y: 1000, w: 100, h: 74 }, [], { w: 1920, h: 1080 }, 12);
  assert.deepEqual([tepi.x, tepi.y], [0, 1006]);
  const sebaris = snapRect({ x: 600, y: 208, w: 300, h: 170 }, [{ x: 100, y: 200, w: 300, h: 170 }], { w: 1920, h: 1080 }, 12);
  assert.equal(sebaris.y, 200); // rata atas dengan slot di sebelahnya
  assert.deepEqual(sebaris.guides.y, [200]);
  assert.deepEqual(alignedLines({ x: 910, y: 490, w: 100, h: 100 }, [], { w: 1920, h: 1080 }), { x: [], y: [] });
});

test('resizeCorner: sudut seberang diam, untuk keempat sudut', () => {
  const B = { w: 1920, h: 1080 };
  // tarik sudut kiri atas 50 px ke kiri-atas dari tile 400x200 di (500,300): kanan-bawah tetap (900,500)
  assert.deepEqual(resizeCorner({ x: 450, y: 250, w: 450, h: 250 }, 'nw', B, [], { threshold: 0 }).rect, { x: 450, y: 250, w: 450, h: 250 });
  const ne = resizeCorner({ x: 500, y: 250, w: 450, h: 250 }, 'ne', B, [], { threshold: 0, ratio: 2 }).rect; // rasio 2: tinggi dari lebar
  assert.deepEqual(ne, { x: 500, y: 275, w: 450, h: 225 }); // bawah tetap di 500
  const sw = resizeCorner({ x: 450, y: 300, w: 450, h: 250 }, 'sw', B, [], { threshold: 0, ratio: 2 }).rect;
  assert.deepEqual(sw, { x: 450, y: 300, w: 450, h: 225 }); // kanan tetap di 900, atas tetap di 300
});

test('resizeCorner: magnet dan batas kanvas ikut dicerminkan', () => {
  const B = { w: 1920, h: 1080 };
  const r = resizeCorner({ x: 8, y: 300, w: 492, h: 200 }, 'nw', B, [], { threshold: 12 }); // tepi kiri 8 px dari tepi kanvas
  assert.equal(r.rect.x, 0);
  assert.equal(r.rect.x + r.rect.w, 500);
  assert.deepEqual(r.guides.x, [0]);
  const keluar = resizeCorner({ x: -100, y: 300, w: 600, h: 200 }, 'nw', B, [], { threshold: 0, ratio: 3 }).rect;
  assert.ok(keluar.x >= 0 && Math.abs(keluar.x + keluar.w - 500) < 1e-9);
});

test('cropFromTile: bingkai tile bergeser, gambar kamera tetap di skala yang sama', () => {
  const F = { w: 1920, h: 1080 };
  const p0 = { x: 100, y: 100, w: 400, h: 200 }, c0 = { x: 500, y: 300, w: 800, h: 400 }; // skala 0.5
  // potong 50 px tile dari kiri = 100 px frame dari kiri; tepi kanan tetap
  assert.deepEqual(cropFromTile({ x: 150, y: 100, w: 350, h: 200 }, p0, c0, F), { place: { x: 150, y: 100, w: 350, h: 200 }, crop: { x: 600, y: 300, w: 700, h: 400 } });
  // lebarkan ke atas 100 px tile = 200 px frame
  assert.deepEqual(cropFromTile({ x: 100, y: 0, w: 400, h: 300 }, p0, c0, F).crop, { x: 500, y: 100, w: 800, h: 600 });
  // melebar melewati tepi frame: crop berhenti di 0, bingkai tile ikut berhenti
  assert.deepEqual(cropFromTile({ x: -300, y: 100, w: 800, h: 200 }, p0, c0, F), { place: { x: -150, y: 100, w: 650, h: 200 }, crop: { x: 0, y: 300, w: 1300, h: 400 } });
});

test('cropFromTile tanpa batas (frame virtual): bingkai boleh melewati tepi gambar', () => {
  const p0 = { x: 100, y: 100, w: 400, h: 300 }, c0 = { x: 0, y: 0, w: 800, h: 600 };
  assert.deepEqual(cropFromTile({ x: 50, y: 100, w: 450, h: 300 }, p0, c0, null), { place: { x: 50, y: 100, w: 450, h: 300 }, crop: { x: -100, y: 0, w: 900, h: 600 } });
});
