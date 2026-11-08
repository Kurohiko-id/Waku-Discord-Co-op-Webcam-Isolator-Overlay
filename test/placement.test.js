import test from 'node:test';
import assert from 'node:assert/strict';
import { centerIn } from '../electron/placement.js';

const mon3 = { x: 3840, y: 0, width: 2560, height: 1400 }; // monitor ketiga, di kanan
test('popup di tengah jendela Waku, di monitor tempat jendela itu berada', () => {
  assert.deepEqual(centerIn({ x: 4200, y: 200, width: 1600, height: 960 }, mon3, 860, 620), { x: 4570, y: 370, width: 860, height: 620 });
});
test('jendela Waku mepet tepi monitor: popup tetap utuh di dalam monitor itu', () => {
  assert.deepEqual(centerIn({ x: 6000, y: 1200, width: 800, height: 600 }, mon3, 860, 620), { x: 5540, y: 780, width: 860, height: 620 });
});
test('monitor lebih kecil dari popup: popup diperkecil supaya muat', () => {
  assert.deepEqual(centerIn({ x: 0, y: 0, width: 800, height: 500 }, { x: 0, y: 0, width: 800, height: 560 }, 860, 620), { x: 0, y: 0, width: 800, height: 560 });
});
