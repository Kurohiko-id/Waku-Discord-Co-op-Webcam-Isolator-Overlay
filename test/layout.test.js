import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, newSlot, newSlotFrom, nextSlotName, presetOrder, carryDiscordSlots, mergeDraft, presetSlots, applyPresetSlots, virtualLibrary, rememberVirtual, forgetVirtual, withVirtualSources, rescaleSlots } from '../public/shared/layout.js';
import { defaultStyle, TEMPLATES } from '../public/shared/style.js';

test('nextSlotName: DC 1 untuk layout kosong, lalu nomor terkecil yang kosong', () => {
  assert.equal(nextSlotName([]), 'DC 1');
  const named = names => names.map((name, i) => ({ ...newSlot('s' + i, i), name }));
  assert.equal(nextSlotName(named(['DC 1'])), 'DC 2');
  assert.equal(nextSlotName(named(['DC 1', 'DC 3'])), 'DC 2');
  assert.equal(nextSlotName(named(['DC 2'])), 'DC 1');
  assert.equal(nextSlotName(named(['Dewi', '', 'DC 1'])), 'DC 2');
  assert.ok(validateLayout({ slots: [{ ...newSlot('a', 0), name: nextSlotName([]) }] }));
});

test('rasio terkunci secara default, termasuk layout lama tanpa field itu', () => {
  assert.equal(newSlot('a', 0).ratioLocked, true);
  const legacy = { ...newSlot('a', 0) };
  delete legacy.ratioLocked;
  assert.equal(validateLayout({ slots: [legacy] }).slots[0].ratioLocked, true);
  assert.equal(validateLayout({ slots: [{ ...legacy, ratioLocked: false }] }).slots[0].ratioLocked, false);
});

test('newSlotFrom menyalin ukuran crop dan tile, posisi mengikuti grid', () => {
  const src = {
    ...newSlot('a', 0),
    crop: { x: 5, y: 6, w: 640, h: 480 },
    place: { x: 7, y: 8, w: 300, h: 225 },
  };
  const s = newSlotFrom('b', 1, src);
  const grid = newSlot('b', 1);
  assert.deepEqual([s.crop.w, s.crop.h], [640, 480]);
  assert.deepEqual([s.place.w, s.place.h], [300, 225]);
  assert.deepEqual([s.crop.x, s.crop.y], [grid.crop.x, grid.crop.y]);
  assert.deepEqual([s.place.x, s.place.y], [grid.place.x, grid.place.y]);
  assert.equal(s.id, 'b');
  assert.ok(validateLayout({ slots: [src, s] }));
});

test('layout kosong valid dengan settings default', () => {
  assert.deepEqual(validateLayout({ slots: [] }), {
    slots: [],
    settings: { animate: true, greenMin: 0.02, detectEnabled: true, bitrate: 8, fps: 30, frameW: 0, frameH: 0 },
    style: defaultStyle(),
    template: 'sticker-night',
    guides: { x: [], y: [] },
    presets: [],
    temp: [],
    library: [],
  });
});

test('presets divalidasi: id, nama, isi slot, dan batas jumlah', () => {
  const a = [newSlot('a', 0), newSlot('b', 1)];
  const l = validateLayout({ slots: [], presets: [
    { id: 'p1', name: 'Duo', slots: a },
    { id: 'p2', name: 'x'.repeat(100), slots: [a[0]] },
    { id: '', name: 'tanpa id', slots: a },
    { id: 'p3', name: 'id slot kembar', slots: [a[0], a[0]] },
    { id: 'p4', name: 'kosong', slots: [] },
    { id: 'p5', name: 'slot rusak', slots: [{ id: 'z' }] },
    'zzz', null,
  ] });
  assert.deepEqual(l.presets.map(p => [p.id, p.slots.length]), [['p1', 2], ['p2', 1]]);
  assert.equal(l.presets[1].name.length, 40);
  for (const bad of [null, undefined, 5, 'x', {}]) assert.deepEqual(validateLayout({ slots: [], presets: bad }).presets, []);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i, name: 'n' + i, slots: [a[0]] }));
  assert.equal(validateLayout({ slots: [], presets: many }).presets.length, 50);
  const temp = validateLayout({ slots: [], temp: many.map((p, i) => ({ ...p, t: 1000 + i })) }).temp;
  assert.deepEqual([temp.length, temp[0].t], [15, 1000]); // Temp: 15 terakhir, waktu ikut tersimpan
});

test('guides divalidasi: hanya angka dalam kanvas, dibulatkan, unik, terurut, maksimal 20 per sumbu', () => {
  const g = validateLayout({ slots: [], guides: { x: [960.4, 100, 100, -5, 2000, 'a', NaN, null], y: [540] } }).guides;
  assert.deepEqual(g, { x: [100, 960], y: [540] });
  for (const bad of [null, undefined, 5, 'x', [], { x: 'a', y: 3 }]) {
    assert.deepEqual(validateLayout({ slots: [], guides: bad }).guides, { x: [], y: [] });
  }
  const many = Array.from({ length: 40 }, (_, i) => i * 10);
  assert.equal(validateLayout({ slots: [], guides: { x: many, y: [] } }).guides.x.length, 20);
});

test('layout lama tanpa style/template mendapat Sticker Night', () => {
  const l = validateLayout({ slots: [newSlot('a', 0)] });
  assert.deepEqual(l.style, defaultStyle());
  assert.equal(l.template, 'sticker-night');
  assert.deepEqual(l.slots[0].style, {});
});

test('style dan template di layout divalidasi; template tak dikenal menjadi kosong', () => {
  const polos = TEMPLATES.polos.style;
  const l = validateLayout({ slots: [], style: polos, template: 'polos' });
  assert.deepEqual(l.style, polos);
  assert.equal(l.template, 'polos');
  assert.equal(validateLayout({ slots: [], style: polos, template: 'entah' }).template, '');
  assert.equal(validateLayout({ slots: [], style: polos }).template, '');
  const rusak = validateLayout({ slots: [], style: { radius: 'x', border: 5, speak: { effects: 'lift' } } });
  assert.deepEqual(rusak.style, defaultStyle());
});

test('style per slot divalidasi sebagian; slot dengan style rusak tetap valid', () => {
  const s = { ...newSlot('a', 0), style: { radius: 500, border: { color: 'x' }, asing: 1 } };
  const l = validateLayout({ slots: [s, { ...newSlot('b', 1), style: 'rusak' }] });
  assert.deepEqual(l.slots[0].style, { radius: 60 });
  assert.deepEqual(l.slots[1].style, {});
});

test('slot baru punya kotak deteksi di sudut kiri atas crop, tapi deteksi bicara nonaktif', () => {
  const s = newSlot('a', 0);
  assert.deepEqual(s.probe, { x: s.crop.x - 16, y: s.crop.y - 16, w: 32, h: 32 });
  assert.equal(s.detect, false);
  assert.equal(s.discordId, '');
  assert.deepEqual([s.discordName, s.image, s.imgW, s.imgH], ['', '', 0, 0]); // field lengkap sejak dibuat, bukan baru setelah validasi server
});

test('layout lama tanpa probe/detect mendapat default; probe rusak diganti default', () => {
  const legacy = { ...newSlot('a', 0) };
  delete legacy.probe; // layout lama tanpa field detect: deteksi tetap aktif seperti dulu
  delete legacy.detect;
  const a = validateLayout({ slots: [legacy] }).slots[0];
  assert.deepEqual(a.probe, { x: legacy.crop.x - 16, y: legacy.crop.y - 16, w: 32, h: 32 });
  assert.equal(a.detect, true);
  const b = validateLayout({ slots: [{ ...legacy, probe: { x: 1, y: 1, w: 0, h: 5 } }] }).slots[0];
  assert.equal(b.probe.w, 32);
  const c = validateLayout({ slots: [{ ...newSlot('c', 0), detect: false, probe: { x: 5, y: 6, w: 7, h: 8 } }] }).slots[0];
  assert.deepEqual(c.probe, { x: 5, y: 6, w: 7, h: 8 });
  assert.equal(c.detect, false);
});

test('pengaturan deteksi bicara global aktif secara default dan bisa dimatikan', () => {
  assert.equal(validateLayout({ slots: [] }).settings.detectEnabled, true);
  assert.equal(validateLayout({ slots: [], settings: { detectEnabled: false } }).settings.detectEnabled, false);
});

test('newSlot lolos validasi dan crop/place 16:9', () => {
  const l = validateLayout({ slots: [newSlot('a', 0), newSlot('b', 5)] });
  assert.ok(l);
  for (const s of l.slots) {
    assert.ok(Math.abs(s.crop.w / s.crop.h - 16 / 9) < 1e-9);
    assert.ok(Math.abs(s.place.w / s.place.h - 16 / 9) < 1e-9);
  }
});

test('menolak input rusak', () => {
  const ok = newSlot('a', 0);
  const bad = [
    null, 'x', {}, { slots: 'x' },
    { slots: [{ ...ok, id: '' }] },
    { slots: [{ ...ok, crop: { ...ok.crop, w: 0 } }] },
    { slots: [{ ...ok, place: { ...ok.place, x: NaN } }] },
    { slots: [ok, ok] },
    { slots: Array.from({ length: 17 }, (_, i) => newSlot('s' + i, i)) },
  ];
  for (const b of bad) assert.equal(validateLayout(b), null);
});

test('menormalkan nama, boolean, dan greenMin', () => {
  const s = { ...newSlot('a', 0), name: 'x'.repeat(100), cropLocked: 1, enabled: undefined };
  const l = validateLayout({ slots: [s], settings: { animate: false, greenMin: 5 } });
  assert.equal(l.slots[0].name.length, 40);
  assert.equal(l.slots[0].cropLocked, true);
  assert.equal(l.slots[0].enabled, true);
  assert.deepEqual(l.settings, { animate: false, greenMin: 1, detectEnabled: true, bitrate: 8, fps: 30, frameW: 0, frameH: 0 });
  assert.equal(validateLayout({ slots: [], settings: { greenMin: 'abc' } }).settings.greenMin, 0.02);
  assert.equal(validateLayout({ slots: [], settings: { greenMin: 0 } }).settings.greenMin, 0.005);
  assert.equal(validateLayout({ slots: [], settings: { greenMin: 0.03 } }).settings.greenMin, 0.03);
});

test('slot: discordId hanya ID numerik Discord, selain itu kembali ke kotak hijau', () => {
  const slot = id => validateLayout({ slots: [{ ...newSlot('a', 0), discordId: id, discordName: 'Eko' }] }).slots[0];
  assert.equal(slot('333333444455556666').discordId, '333333444455556666');
  assert.equal(slot('333333444455556666').discordName, 'Eko');
  assert.equal(slot('abc').discordId, '');
  assert.equal(slot(123456).discordId, '');
  assert.equal(validateLayout({ slots: [newSlot('a', 0)] }).slots[0].discordId, '');
});

test('slot: baseCrop (crop asli dari popup) disimpan; layout lama memakai crop sekarang', () => {
  const s = newSlot('a', 0);
  const lama = validateLayout({ slots: [s] }).slots[0];
  assert.deepEqual(lama.baseCrop, lama.crop);
  const base = { x: 10, y: 20, w: 640, h: 360 };
  assert.deepEqual(validateLayout({ slots: [{ ...s, baseCrop: base }] }).slots[0].baseCrop, base);
  assert.deepEqual(validateLayout({ slots: [{ ...s, baseCrop: { x: 1, y: 1, w: -5, h: 3 } }] }).slots[0].baseCrop, s.crop); // rusak: pakai crop
});

test('preset: urutan tetap (disematkan dulu, lalu urutan simpan), tidak berubah karena dipakai', () => {
  const slot = newSlot('a', 0);
  const p = (id, extra) => ({ id, name: id, slots: [slot], ...extra });
  const l = validateLayout({ slots: [], presets: [p('a'), p('b', { usedAt: 300 }), p('c', { pinned: true }), p('d'), p('e', { pinned: true })] });
  assert.deepEqual(l.presets.map(x => [x.id, x.pinned]), [['a', false], ['b', false], ['c', true], ['d', false], ['e', true]]);
  assert.equal(l.presets[1].usedAt, undefined); // "terakhir dipakai" tidak disimpan lagi
  assert.deepEqual(presetOrder(l.presets).map(x => x.id), ['c', 'e', 'a', 'b', 'd']);
});

test('preset: "full" (nama & akun Discord ikut) bawaan true untuk preset lama', () => {
  const p = (id, extra) => ({ id, name: id, slots: [newSlot('a', 0)], ...extra });
  const l = validateLayout({ slots: [], presets: [p('lama'), p('susunan', { full: false }), p('lengkap', { full: true })] });
  assert.deepEqual(l.presets.map(x => x.full), [true, false, true]);
});

test('presetSlots: tanpa identitas hanya menyimpan susunan', () => {
  const cam = { ...newSlot('a', 0), name: 'Andi', detect: true, discordId: '111111', discordName: 'andi' };
  const logo = { ...newSlot('v', 1), name: 'Logo', image: '/uploads/0123456789abcdef.png', imgW: 10, imgH: 10, discordId: '222222', discordName: 'x' };
  const full = presetSlots([cam, logo], true);
  assert.deepEqual(full, [cam, logo]);
  assert.notEqual(full[0], cam); // salinan
  const bare = presetSlots([cam, logo], false);
  assert.deepEqual([bare[0].name, bare[0].detect, bare[0].discordId, bare[0].discordName], ['', false, '', '']);
  assert.deepEqual(bare[0].crop, cam.crop);
  assert.deepEqual([bare[1].name, bare[1].image, bare[1].discordId], ['Logo', logo.image, '']); // frame virtual: nama & gambar tetap
  assert.equal(cam.name, 'Andi', 'slot asal tidak diubah');
});

test('applyPresetSlots: dengan identitas membawa frame Discord; tanpa identitas mulai kosong DC 1..n', () => {
  const s = (id, extra) => ({ ...newSlot(id, 0), ...extra });
  const cur = [s('andi', { name: 'Andi', detect: true, discordId: '111111' })];
  const full = applyPresetSlots({ full: true, slots: [s('budi', { name: 'Budi', detect: true, discordId: '222222' })] }, cur);
  assert.deepEqual(full.map(x => [x.name, x.discordId, x.enabled]), [['Budi', '222222', true], ['Andi', '111111', false]]);
  const bare = applyPresetSlots({ full: false, slots: [s('a', { name: 'Budi', detect: true, discordId: '222222' }), s('b'), s('c', { name: 'DC 1' })] }, cur);
  assert.deepEqual(bare.map(x => [x.id, x.name, x.detect, x.discordId]), [['a', 'DC 1', false, ''], ['b', 'DC 2', false, ''], ['c', 'DC 3', false, '']]);
});

test('ganti preset: frame terikat Discord yang tidak ada di preset dibawa nonaktif', () => {
  const s = (id, discordId = '') => ({ ...newSlot(id, 0), discordId });
  const cur = [s('andi', '111111'), s('dc1'), s('budi', '222222'), s('citra', '333333')];
  const next = [s('budi', '222222'), s('baru', '333333')]; // citra: akun sama sudah ada di preset dengan id lain
  const out = carryDiscordSlots(cur, next);
  assert.deepEqual(out.map(x => [x.id, x.enabled]), [['budi', true], ['baru', true], ['andi', false]]);
  assert.equal(out[2].discordId, '111111');
  assert.equal(cur[0].enabled, true); // slot asal tidak diubah
  const full = Array.from({ length: 16 }, (_, i) => s('n' + i));
  assert.equal(carryDiscordSlots(cur, full).length, 16); // batas 16 frame
});

test('mergeDraft: simpan popup crop hanya menimpa bidang popup; gaya, tile, dan frame virtual tetap', () => {
  const F = { w: 1280, h: 720 };
  const a = { ...newSlot('a', 0), style: { border: { width: 4 } }, place: { x: 100, y: 100, w: 640, h: 360 } };
  const v = { ...newSlot('v', 1), image: '/uploads/0123456789abcdef.png', imgW: 800, imgH: 600, name: 'Logo' };
  const cur = [a, v];
  const draft = structuredClone(cur);
  draft[0] = { ...draft[0], name: 'Budi', enabled: false, crop: { x: 1200, y: 0, w: 400, h: 400 }, style: {}, place: { x: 0, y: 0, w: 1, h: 1 } };
  draft[1].name = 'diubah popup crop';
  draft.push({ ...newSlot('b', 2), place: { x: 1900, y: 1000, w: 448, h: 252 } });
  const out = mergeDraft(cur, draft, F);
  assert.deepEqual(out.map(s => s.id), ['a', 'v', 'b']);
  assert.equal(out[0].name, 'Budi');
  assert.equal(out[0].enabled, false);
  assert.deepEqual(out[0].crop, { x: 880, y: 0, w: 400, h: 400 }); // crop dijepit ke frame
  assert.deepEqual(out[0].baseCrop, out[0].crop);
  assert.notEqual(out[0].baseCrop, out[0].crop); // salinan, bukan objek yang sama
  assert.deepEqual(out[0].style, { border: { width: 4 } }); // gaya slot asli tidak tertimpa
  assert.deepEqual(out[0].place, { x: 100, y: 100, w: 640, h: 640 }); // posisi tile asli, tinggi ikut rasio crop
  assert.equal(out[1], v); // frame virtual: objek asli, tidak disentuh
  assert.deepEqual(out[2].place, { x: 1472, y: 828, w: 448, h: 252 }); // slot baru dijepit ke kanvas
  assert.equal(cur[0].name, '', 'slot asal tidak diubah');
});

test('frame virtual: gambar dari /uploads dengan ukuran asli; path lain ditolak', () => {
  const s = newSlot('a', 0);
  const v = img => validateLayout({ slots: [{ ...s, image: img, imgW: 800, imgH: 600 }] }).slots[0];
  const ok = v('/uploads/0123456789abcdef.png');
  assert.deepEqual([ok.image, ok.imgW, ok.imgH], ['/uploads/0123456789abcdef.png', 800, 600]);
  for (const bad of ['https://x.example/a.png', '/uploads/../server.js', '/uploads/0123456789abcdef.svg', 5]) assert.equal(v(bad).image, '');
  assert.equal(validateLayout({ slots: [{ ...s, image: '/uploads/0123456789abcdef.png', imgW: -1, imgH: 600 }] }).slots[0].image, ''); // tanpa ukuran valid: bukan virtual
  assert.equal(validateLayout({ slots: [s] }).slots[0].image, '');
});

test('frame virtual: background warna hex atau transparan, bawaan hitam', () => {
  const s = { ...newSlot('a', 0), image: '/uploads/0123456789abcdef.png', imgW: 800, imgH: 600 };
  const bg = v => validateLayout({ slots: [{ ...s, bg: v }] }).slots[0].bg;
  assert.equal(bg(undefined), '#000000');
  assert.equal(bg('#12ab9F'), '#12ab9F');
  assert.equal(bg('transparent'), 'transparent');
  assert.equal(bg('red; x: url(evil)'), '#000000');
});

test('settings: bitrate 2-20 Mbps (bawaan 8) dan fps dari pilihan (bawaan 30)', () => {
  const st = settings => validateLayout({ slots: [], settings }).settings;
  assert.deepEqual([st({}).bitrate, st({}).fps], [8, 30]);
  assert.deepEqual([st({ bitrate: 12.4, fps: 60 }).bitrate, st({ bitrate: 12.4, fps: 60 }).fps], [12, 60]);
  assert.deepEqual([st({ bitrate: 99, fps: 50 }).bitrate, st({ bitrate: 99, fps: 50 }).fps], [20, 30]);
  assert.equal(st({ bitrate: 0 }).bitrate, 2);
  assert.equal(st({ bitrate: 'x' }).bitrate, 8);
});

test('safe zone game: semua area di dalam kanvas 1920x1080 dan berlabel', async () => {
  const { SAFE_ZONES } = await import('../public/shared/safezones.js');
  for (const g of Object.values(SAFE_ZONES)) {
    assert.ok(g.name && g.zones.length);
    for (const z of g.zones) {
      assert.ok(z.label, 'label');
      assert.ok(z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0 && z.x + z.w <= 1920 && z.y + z.h <= 1080, z.label);
    }
  }
});

test('library: daftar virtual frame tersimpan (hanya frame virtual, id unik, maks 50)', () => {
  const v = (id, extra) => ({ ...newSlot(id, 0), name: 'Logo ' + id, image: '/uploads/0123456789abcdef.png', imgW: 800, imgH: 600, discordId: '111111', discordName: 'andi', ...extra });
  assert.deepEqual(validateLayout({ slots: [] }).library, []);
  const l = validateLayout({ slots: [], library: [v('a'), newSlot('cam', 0), v('a', { name: 'dobel' }), v('b'), 'rusak'] });
  assert.deepEqual(l.library.map(s => [s.id, s.name, s.discordId]), [['a', 'Logo a', '111111'], ['b', 'Logo b', '111111']]);
  assert.equal(validateLayout({ slots: [], library: Array.from({ length: 60 }, (_, i) => v('v' + i)) }).library.length, 50);
});

const vf = (id, extra) => ({ ...newSlot(id, 0), name: 'Logo ' + id, image: '/uploads/0123456789abcdef.png', imgW: 10, imgH: 10, ...extra });

test('rememberVirtual: frame virtual masuk ke depan daftar, diperbarui bila sudah ada; frame kamera diabaikan', () => {
  let lib = rememberVirtual([], vf('a'));
  lib = rememberVirtual(lib, vf('b'));
  lib = rememberVirtual(lib, vf('a', { name: 'Logo baru', enabled: false }));
  assert.deepEqual(lib.map(s => [s.id, s.name, s.enabled]), [['a', 'Logo baru', true], ['b', 'Logo b', true]]);
  assert.equal(rememberVirtual(lib, newSlot('cam', 0)), lib);
  assert.equal(rememberVirtual(lib, undefined), lib);
});

test('virtualLibrary: gabungan daftar, preset, dan kanvas, satu per id, dengan status', () => {
  const list = virtualLibrary({
    library: [vf('a'), vf('b')],
    presets: [{ slots: [vf('b'), vf('c'), newSlot('cam', 0)] }, { slots: [vf('c')] }],
    slots: [vf('a', { name: 'di kanvas' }), vf('d', { enabled: false })],
  });
  assert.deepEqual(list.map(e => [e.slot.id, e.saved, e.canvas, e.presets]), [['a', true, 'on', 0], ['b', true, null, 1], ['c', false, null, 2], ['d', false, 'off', 0]]);
  assert.equal(list[0].slot.name, 'di kanvas'); // data kanvas paling baru
});

test('forgetVirtual: hapus permanen dari daftar dan semua preset; preset yang jadi kosong ikut hilang', () => {
  const out = forgetVirtual({ library: [vf('a'), vf('b')], presets: [{ id: 'p1', slots: [vf('a'), vf('b')] }, { id: 'p2', slots: [vf('a')] }] }, 'a');
  assert.deepEqual(out.library.map(s => s.id), ['b']);
  assert.deepEqual(out.presets.map(p => [p.id, p.slots.map(s => s.id)]), [['p1', ['b']]]);
});

test('withVirtualSources: virtual frame tanpa sumber bicara memakai sumber dari daftar; yang lain tidak diubah', () => {
  const lib = [vf('a', { discordId: '111111', discordName: 'andi' })];
  const [a, b, cam, own] = withVirtualSources([vf('a'), vf('b'), { ...newSlot('a', 0) }, vf('a', { discordId: '222222', discordName: 'budi' })], lib);
  assert.deepEqual([a.discordId, a.discordName, a.detect], ['111111', 'andi', true]);
  assert.equal(b.discordId, '');
  assert.equal(cam.discordId, ''); // frame kamera (tanpa gambar) tidak diisi
  assert.equal(own.discordId, '222222'); // sumber sendiri dipertahankan
});

test('rescaleSlots: pindah monitor dengan rasio sama -> crop, baseCrop, dan kotak deteksi ikut diskalakan, bolak-balik kembali utuh', () => {
  const cam = { ...newSlot('a', 0), crop: { x: 800, y: 400, w: 640, h: 360 }, baseCrop: { x: 800, y: 400, w: 640, h: 360 }, probe: { x: 784, y: 384, w: 32, h: 32 } };
  const logo = vf('v');
  const q = { w: 2560, h: 1440 }, f = { w: 1920, h: 1080 };
  const [a, v] = rescaleSlots([cam, logo], q, f);
  assert.deepEqual(a.crop, { x: 600, y: 300, w: 480, h: 270 });
  assert.deepEqual(a.baseCrop, { x: 600, y: 300, w: 480, h: 270 });
  assert.deepEqual(a.probe, { x: 588, y: 288, w: 24, h: 24 });
  assert.equal(v, logo); // virtual frame tidak bergantung pada capture
  assert.deepEqual(rescaleSlots([a], f, q)[0].crop, cam.crop); // balik ke monitor semula
});

test('rescaleSlots: rasio berbeda, ukuran sama, atau ukuran lama tidak diketahui -> tidak diubah', () => {
  const slots = [newSlot('a', 0)];
  assert.equal(rescaleSlots(slots, { w: 1920, h: 1080 }, { w: 1600, h: 1200 }), slots);
  assert.equal(rescaleSlots(slots, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }), slots);
  assert.equal(rescaleSlots(slots, { w: 0, h: 0 }, { w: 1920, h: 1080 }), slots);
});

test('ukuran frame capture tersimpan di settings dan di preset; nilai rusak jadi 0', () => {
  const l = validateLayout({ slots: [], settings: { frameW: 2560.4, frameH: 1440 }, presets: [{ id: 'p', name: 'p', slots: [newSlot('a', 0)], frameW: 1920, frameH: 'x' }] });
  assert.deepEqual([l.settings.frameW, l.settings.frameH], [2560, 1440]);
  assert.deepEqual([l.presets[0].frameW, l.presets[0].frameH], [1920, 0]);
});
