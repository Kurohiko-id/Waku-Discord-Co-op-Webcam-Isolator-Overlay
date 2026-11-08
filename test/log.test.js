import test from 'node:test';
import assert from 'node:assert/strict';
import { Stat } from '../public/shared/log.js';

test('Stat: n, rata-rata, maksimum dan reset', () => {
  const s = new Stat();
  assert.deepEqual(s.snapshot(), { n: 0, avg: 0, max: 0 });
  for (const v of [100, 120, 400]) s.add(v);
  assert.deepEqual(s.snapshot(), { n: 3, avg: 206.7, max: 400 });
  s.reset();
  assert.deepEqual(s.snapshot(), { n: 0, avg: 0, max: 0 });
});

test('Stat: nilai bukan angka diabaikan', () => {
  const s = new Stat();
  for (const v of [NaN, undefined, null, 'x', Infinity]) s.add(v);
  s.add(5);
  assert.deepEqual(s.snapshot(), { n: 1, avg: 5, max: 5 });
});
