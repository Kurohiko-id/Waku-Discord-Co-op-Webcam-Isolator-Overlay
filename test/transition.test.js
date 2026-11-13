import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSlots, sameView } from '../public/shared/transition.js';

const S = (id, x, y, o = {}) => ({ id, name: '', discordId: '', image: '', place: { x, y, w: 100, h: 60 }, ...o });
const kinds = ps => ps.map(p => `${p.a?.id ?? '-'}>${p.b?.id ?? '-'}:${p.kind}`).sort();

test('matchSlots: akun dulu, lalu nama, lalu id', () => {
  const A = [S('a1', 0, 0, { discordId: '111111' }), S('a2', 500, 0), S('a3', 900, 0, { name: 'DC 1' })];
  const B = [S('b1', 900, 900, { discordId: '111111' }), S('a2', 0, 900), S('b3', 0, 0, { name: 'DC 1' })];
  assert.deepEqual(kinds(matchSlots(A, B)), ['a1>b1:akun', 'a2>a2:id', 'a3>b3:nama']);
});

test('matchSlots: id sama tapi nama beda (preset salinan) kalah oleh nama yang sama', () => {
  const A = [S('A', 0, 0, { name: 'Wili' }), S('B', 0, 200, { name: 'Pai' })];
  const B = [S('A', 900, 0, { name: 'Pai' }), S('B', 900, 200, { name: 'Piggy' })];
  assert.deepEqual(kinds(matchSlots(A, B)), ['A>B:dekat', 'B>A:nama']);
});

test('matchSlots: 4 -> 5, sisa ke terdekat, satu baru muncul', () => {
  const d = n => ({ discordId: '10000' + n });
  const A = [S('k', 0, 0, d(1)), S('r', 800, 0, d(2)), S('a', 0, 500, d(3)), S('s', 800, 500, d(4))];
  const B = [S('k', 0, 0, d(1)), S('r', 600, 0, d(2)), S('a', 1200, 0, d(3)), S('t', 100, 500, d(5)), S('b', 700, 520, d(6))];
  assert.deepEqual(kinds(matchSlots(A, B)), ['->t:baru', 'a>a:akun', 'k>k:akun', 'r>r:akun', 's>b:dekat']);
});

test('matchSlots: pasangan terdekat dikunci dulu, frame lebih sedikit = keluar', () => {
  const A = [S('x', 0, 0), S('y', 1000, 0), S('z', 2000, 0)];
  const B = [S('p', 1010, 0), S('q', 20, 0)];
  assert.deepEqual(kinds(matchSlots(A, B)), ['x>q:dekat', 'y>p:dekat', 'z>-:keluar']);
});

test('matchSlots: frame gambar tidak dipasangkan dengan kamera', () => {
  const A = [S('cam', 0, 0)];
  const B = [S('logo', 0, 0, { image: '/uploads/logo.png' })];
  assert.deepEqual(kinds(matchSlots(A, B)), ['->logo:baru', 'cam>-:keluar']);
});

test('sameView: isi sama = crop tumpang tindih atau gambar sama; selain itu crossfade', () => {
  const c = (x, o = {}) => ({ image: '', crop: { x, y: 0, w: 100, h: 60 }, ...o });
  assert.equal(sameView(c(0), c(50)), true);
  assert.equal(sameView(c(0), c(300)), false); // nama sama, kamera beda
  assert.equal(sameView(c(0, { image: '/u/a.png' }), c(900, { image: '/u/a.png' })), true);
  assert.equal(sameView(c(0, { image: '/u/a.png' }), c(0, { image: '/u/b.png' })), false);
});
