import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanShortcut, createShortcuts } from '../electron/shortcuts.js';

test('cleanShortcut: hanya kombinasi dan aksi yang dikenal, bidang lain dibuang', () => {
  assert.deepEqual(cleanShortcut({ key: 'Control+Alt+P', action: { type: 'preset', id: 'p1', x: 1 }, extra: true }), { key: 'Control+Alt+P', action: { type: 'preset', id: 'p1' } });
  assert.deepEqual(cleanShortcut({ key: 'F13', action: { type: 'template', key: 'bad key!' } }), { key: 'F13', action: { type: 'template' } });
  assert.deepEqual(cleanShortcut({ key: 'num5', action: { type: 'detect' } }), { key: 'num5', action: { type: 'detect' } });
  assert.deepEqual(cleanShortcut({ key: 'F14', action: { type: 'layout', kind: 'left', x: 1 } }), { key: 'F14', action: { type: 'layout', kind: 'left' } });
  for (const bad of [null, {}, { key: 'Ctrl+P', action: { type: 'detect' } }, { key: 'Control+P', action: { type: 'run', cmd: 'calc' } }, { key: 'Control+P', action: { type: 'preset', id: '../x' } }, { key: 'F25', action: { type: 'detect' } }, { key: 'F14', action: { type: 'layout' } }, { key: 'F14', action: { type: 'layout', kind: 'bad kind!' } }])
    assert.equal(cleanShortcut(bad), null);
});

test('createShortcuts: simpan, daftar ulang, catat yang gagal, tolak duplikat', () => {
  let saved = {};
  const registered = new Map();
  const globalShortcut = {
    register: (key, fn) => { if (key === 'Control+X') return false; registered.set(key, fn); return true; }, // Control+X dipakai program lain
    unregisterAll: () => registered.clear(),
  };
  const sent = [], logs = [];
  const sc = createShortcuts({ globalShortcut, readSettings: () => saved, saveSettings: s => { saved = { ...saved, ...s }; }, send: a => sent.push(a), log: (e, d) => logs.push([e, d]) });

  const ok = sc.set([{ key: 'Control+P', action: { type: 'detect' } }, { key: 'Control+X', action: { type: 'preset', id: 'a' } }]);
  assert.deepEqual(ok.list.map(s => s.key), ['Control+P', 'Control+X']);
  assert.deepEqual(ok.failed, ['Control+X']);
  assert.deepEqual(logs, [['shortcut_fail', { keys: ['Control+X'] }]]);
  registered.get('Control+P')();
  assert.deepEqual(sent, [{ type: 'detect' }]);

  assert.equal(sc.set([{ key: 'Control+P', action: { type: 'detect' } }, { key: 'Control+P', action: { type: 'detect' } }]).error, 'duplicate');
  assert.equal(sc.set([{ key: 'Control+P', action: { type: 'nope' } }]).error, 'invalid');
  assert.equal(sc.set('bukan array'), null);
  assert.equal(saved.shortcuts.length, 2, 'input ditolak tidak menimpa yang tersimpan');

  sc.pause(true);
  assert.equal(registered.size, 0);
  sc.pause(false);
  assert.ok(registered.has('Control+P'));
});
