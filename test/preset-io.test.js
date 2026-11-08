import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, parseImport, uniqueName, FILE_TYPE } from '../public/shared/preset-io.js';
import { newSlot } from '../public/shared/layout.js';

const cam = (id, extra) => ({ ...newSlot(id, 0), name: 'Andi', discordId: '111111', discordName: 'andi', detect: true, ...extra });
const logo = { ...newSlot('v', 1), name: 'Logo', image: '/uploads/0123456789abcdef.png', imgW: 10, imgH: 10 };
const presets = [{ id: 'p1', name: 'Duo', full: true, pinned: true, slots: [cam('a'), logo] }, { id: 'p2', name: 'P5', full: false, pinned: false, slots: [cam('b')] }];

test('buildExport: ganti nama, akun Discord dibuang kecuali diminta, preset asli tidak berubah', () => {
  const out = buildExport(presets, { names: { p1: '  Duo bareng  ' }, images: { '/uploads/0123456789abcdef.png': 'data:image/png;base64,AAAA' } });
  assert.equal(out.type, FILE_TYPE);
  assert.deepEqual(out.presets.map(p => p.name), ['Duo bareng', 'P5']);
  assert.deepEqual(out.presets[0].slots.map(s => [s.name, s.discordId]), [['Andi', ''], ['Logo', '']]);
  assert.equal(presets[0].slots[0].discordId, '111111');
  assert.equal(buildExport(presets, { includeAccounts: true }).presets[0].slots[0].discordId, '111111');
  assert.equal('pinned' in out.presets[0], false);
});

test('parseImport: hasil export terbaca lagi; gambar hanya data URI gambar', () => {
  const file = JSON.stringify(buildExport(presets, { images: { '/uploads/0123456789abcdef.png': 'data:image/png;base64,AAAA', '/uploads/ffffffffffffffff.png': 'javascript:alert(1)' } }));
  const { presets: ps, images } = parseImport(file);
  assert.deepEqual(ps.map(p => [p.name, p.slots.length, p.pinned]), [['Duo', 2, false], ['P5', 1, false]]);
  assert.deepEqual(Object.keys(images), ['/uploads/0123456789abcdef.png']);
});

test('parseImport: file yang salah ditolak dengan pesan jelas', () => {
  assert.throws(() => parseImport('bukan json'), /bukan JSON/);
  assert.throws(() => parseImport(JSON.stringify({ presets: [] })), /bukan preset Waku/);
  assert.throws(() => parseImport(JSON.stringify({ type: FILE_TYPE, presets: [{ name: 'x', slots: 'rusak' }] })), /Tidak ada preset/);
});

test('uniqueName: nama bentrok diberi v2, v3, ...', () => {
  const taken = new Set(['P5', 'P5 v2', 'Duo']);
  assert.equal(uniqueName('Baru', taken), 'Baru');
  assert.equal(uniqueName('P5', taken), 'P5 v3');
  assert.equal(uniqueName('P5 v2', taken), 'P5 v3');
  assert.equal(uniqueName('Duo', taken), 'Duo v2');
});
