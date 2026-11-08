import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, validateStyle } from '../public/shared/style.js';
import { styleToVars, labelPos } from '../public/shared/tile-style.js';

const v = key => styleToVars(TEMPLATES[key].style);

test('Sticker Night: nilai CSS tile sesuai gaya template', () => {
  const x = v('sticker-night');
  assert.equal(x['--r'], '20px');
  assert.equal(x['--sh-idle'], '0 0 0 5px #ffffff, 0 8px 18px rgba(31,35,71,0.35)');
  assert.equal(x['--sh-speak'], x['--sh-idle']);
  assert.equal(x['--tf-speak'], 'translateY(-16px) rotate(-2deg) scale(1.04)');
  assert.equal(x['--bubble-on'], '1');
  assert.equal(x['--glow'], '#3ddc97');
});

test('Polos: tanpa radius, border, dan bayangan', () => {
  const x = v('polos');
  assert.equal(x['--r'], '0px');
  assert.equal(x['--sh-idle'], 'none');
  assert.equal(x['--sh-speak'], 'none');
  assert.equal(x['--tf-speak'], 'translateY(-9.6px) scale(1.02)');
  assert.equal(x['--bubble-on'], '0');
});

test('Neobrutalism: bayangan keras tanpa blur', () => {
  const x = v('neobrutalism');
  assert.equal(x['--sh-idle'], '0 0 0 4px #000000, 10px 10px 0 #000000');
});

test('Neon: glow ikut bayangan saat bicara, tidak saat diam', () => {
  const x = v('neon');
  assert.equal(x['--sh-idle'], '0 0 0 2px #a78bfa');
  assert.equal(x['--sh-speak'], '0 0 0 2px #a78bfa, 0 0 36px 7.2px #a78bfa');
  assert.equal(x['--tf-speak'], 'translateY(-19.2px) scale(1.05)');
});

test('tanpa border dan tanpa bayangan: none; tanpa efek: transform none', () => {
  const s = validateStyle({
    radius: 0, border: { width: 0 }, shadow: { amount: 0 }, speak: { effects: [] },
  });
  const x = styleToVars(s);
  assert.equal(x['--r'], '0px');
  assert.equal(x['--sh-idle'], 'none');
  assert.equal(x['--sh-speak'], 'none');
  assert.equal(x['--tf-speak'], 'none');
  assert.equal(x['--bubble-on'], '0');
});

test('kekuatan 0 mematikan glow dan gerak', () => {
  const s = validateStyle({ speak: { effects: ['lift', 'wiggle', 'glow'], strength: 0 } });
  const x = styleToVars(s);
  assert.equal(x['--tf-speak'], 'none');
  assert.equal(x['--sh-speak'], x['--sh-idle']);
});

test('labelPos', () => {
  assert.equal(labelPos(TEMPLATES['sticker-night'].style), null);
  assert.equal(labelPos(TEMPLATES.neobrutalism.style), 'tl');
  assert.equal(labelPos(TEMPLATES.neon.style), 'bl');
});
