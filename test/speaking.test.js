import test from 'node:test';
import assert from 'node:assert/strict';
import { isGreen, greenFraction, createDebouncer } from '../public/shared/speaking.js';

const px = (...p) => new Uint8ClampedArray(p.flatMap(([r, g, b]) => [r, g, b, 255]));

test('isGreen mengenali hijau Discord dan menolak lainnya', () => {
  assert.equal(isGreen(59, 165, 93), true);
  assert.equal(isGreen(200, 50, 50), false);
  assert.equal(isGreen(128, 128, 128), false);
  assert.equal(isGreen(0, 0, 0), false);
});

test('greenFraction menghitung gabungan beberapa strip', () => {
  const a = px([59, 165, 93], [59, 165, 93]);
  const b = px([128, 128, 128], [128, 128, 128]);
  assert.equal(greenFraction(a, b), 0.5);
  assert.equal(greenFraction(), 0);
  assert.equal(greenFraction(new Uint8ClampedArray(0)), 0);
});

test('debouncer: nyala butuh 2 frame, mati butuh 3, kedip diabaikan', () => {
  const d = createDebouncer(2, 3);
  assert.equal(d(true), false);
  assert.equal(d(true), true);
  assert.equal(d(false), true);
  assert.equal(d(false), true);
  assert.equal(d(false), false);
  assert.equal(d(true), false);
  assert.equal(d(false), false);
  assert.equal(d(true), false);
});
