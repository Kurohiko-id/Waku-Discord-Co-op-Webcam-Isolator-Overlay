import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, DEFAULT_TEMPLATE, defaultStyle, validatePartialStyle, validateStyle, mergeStyle, resolveStyle,
} from '../public/shared/style.js';

test('defaultStyle adalah salinan Sticker Night dan bukan objek yang sama', () => {
  const a = defaultStyle();
  assert.deepEqual(a, TEMPLATES[DEFAULT_TEMPLATE].style);
  a.border.width = 99;
  a.speak.effects.push('glow');
  assert.equal(TEMPLATES[DEFAULT_TEMPLATE].style.border.width, 5);
  assert.deepEqual(TEMPLATES[DEFAULT_TEMPLATE].style.speak.effects, ['lift', 'wiggle', 'bubble']);
});

test('keempat template valid dan lolos validateStyle tanpa berubah', () => {
  assert.deepEqual(Object.keys(TEMPLATES), ['sticker-night', 'polos', 'neobrutalism', 'neon']);
  for (const t of Object.values(TEMPLATES)) assert.deepEqual(validateStyle(t.style), t.style);
});

test('validatePartialStyle memotong rentang dan membuang yang tidak valid', () => {
  const p = validatePartialStyle({
    radius: 999,
    border: { width: -5, color: 'merah' },
    shadow: { amount: 500, hard: 'ya', color: '#ABCDEF' },
    label: { show: 1, pos: 'tengah' },
    speak: { effects: ['lift', 'lift', 'meledak', 'glow'], strength: NaN, glowColor: '#12345' },
    asing: 1,
  });
  assert.deepEqual(p, {
    radius: 60,
    border: { width: 0 },
    shadow: { amount: 100, color: '#abcdef' },
    speak: { effects: ['lift', 'glow'] },
  });
});

test('validatePartialStyle: input bukan objek memberi objek kosong; efek kosong dipertahankan', () => {
  for (const bad of [null, undefined, 5, 'x', []]) assert.deepEqual(validatePartialStyle(bad), {});
  assert.deepEqual(validatePartialStyle({ speak: { effects: [] } }), { speak: { effects: [] } });
});

test('validatePartialStyle membatasi efek maksimal 4 dan unik', () => {
  const p = validatePartialStyle({ speak: { effects: ['lift', 'wiggle', 'glow', 'bubble', 'lift'] } });
  assert.deepEqual(p.speak.effects, ['lift', 'wiggle', 'glow', 'bubble']);
});

test('validateStyle mengisi yang hilang dari bawaan', () => {
  const s = validateStyle({ radius: 4 });
  assert.equal(s.radius, 4);
  assert.deepEqual(s.border, TEMPLATES['sticker-night'].style.border);
  assert.deepEqual(validateStyle(undefined), defaultStyle());
});

test('mergeStyle menggabungkan grup per kunci dan tidak mengubah masukan', () => {
  const base = defaultStyle();
  const m = mergeStyle(base, { border: { color: '#000000' }, speak: { strength: 10 } });
  assert.deepEqual(m.border, { width: 5, color: '#000000' });
  assert.equal(m.speak.strength, 10);
  assert.deepEqual(m.speak.effects, ['lift', 'wiggle', 'bubble']);
  assert.notEqual(m.speak.effects, base.speak.effects);
  assert.equal(base.border.color, '#ffffff');
});

test('resolveStyle: penimpaan sebagian per slot, tanpa penimpaan mewarisi umum', () => {
  const general = validateStyle(TEMPLATES.polos.style);
  assert.deepEqual(resolveStyle(general, undefined), general);
  assert.deepEqual(resolveStyle(general, {}), general);
  const r = resolveStyle(general, { radius: 12, border: { width: 3 } });
  assert.equal(r.radius, 12);
  assert.deepEqual(r.border, { width: 3, color: general.border.color });
  assert.deepEqual(r.shadow, general.shadow);
});
