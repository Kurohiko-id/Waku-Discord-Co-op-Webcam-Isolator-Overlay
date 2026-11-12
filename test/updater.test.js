import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater } from '../electron/updater.js';

// autoUpdater palsu: event dikirim manual dari tes
function fake({ checkFails = false, downloadFails = false } = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = () => { u.calls.push('check'); return checkFails ? Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')) : Promise.resolve(); };
  u.downloadUpdate = () => { u.calls.push('download'); return downloadFails ? Promise.reject(new Error('disk penuh')) : Promise.resolve(); };
  u.quitAndInstall = (...a) => u.calls.push(['install', ...a]);
  return u;
}
const setup = (opts, packaged = true) => {
  const u = fake(opts), sent = [];
  return { u, sent, up: createUpdater({ updater: u, packaged, send: s => sent.push(s) }) };
};
const tick = () => new Promise(r => setImmediate(r));

test('bukan installer (dev): tidak pernah mengecek', () => {
  const { u, up } = setup({}, false);
  assert.equal(up.check(true).status, 'dev');
  assert.deepEqual(u.calls, []);
});

test('tidak mengunduh atau memasang otomatis', () => {
  const { u } = setup();
  assert.equal(u.autoDownload, false);
  assert.equal(u.autoInstallOnAppQuit, false);
});

test('alur lengkap: tersedia -> unduh -> progres -> siap -> pasang', () => {
  const { u, up, sent } = setup();
  up.check();
  u.emit('checking-for-update');
  u.emit('update-available', { version: '1.1.0' });
  assert.deepEqual(up.state(), { status: 'available', version: '1.1.0', prompt: true });
  assert.equal(up.install(), false); // belum diunduh
  up.download();
  u.emit('download-progress', { percent: 63.7 });
  assert.deepEqual(up.state(), { status: 'downloading', version: '1.1.0', percent: 63 });
  u.emit('update-downloaded', { version: '1.1.0' });
  assert.deepEqual(up.state(), { status: 'ready', version: '1.1.0' });
  assert.equal(up.check(true).status, 'ready'); // update siap: tidak cek ulang
  assert.equal(up.install(), true);
  assert.deepEqual(u.calls, ['check', 'download', ['install', true, true]]);
  assert.deepEqual(sent.map(s => s.status), ['checking', 'available', 'downloading', 'downloading', 'ready']);
});

test('sudah versi terbaru', () => {
  const { u, up } = setup();
  up.check(true);
  u.emit('update-not-available');
  assert.equal(up.state().status, 'none');
});

test('cek otomatis gagal (offline): diam; cek manual gagal: tampilkan error', async () => {
  const auto = setup({ checkFails: true });
  auto.up.check();
  await tick();
  assert.equal(auto.up.state().status, 'idle');
  const man = setup({ checkFails: true });
  man.up.check(true);
  await tick();
  assert.deepEqual(man.up.state(), { status: 'error', msg: 'Tidak bisa terhubung ke GitHub. Cek koneksi internet.' });
});

test('error yang sama dari event dan promise dicatat sekali; 404 jadi pesan yang jelas', () => {
  const u = fake(), logs = [];
  const up = createUpdater({ updater: u, packaged: true, send: () => {}, log: (e, d) => logs.push([e, d.msg]) });
  up.check(true);
  const err = new Error('HttpError: 404 \n"method: GET url: https://github.com/..."');
  u.emit('error', err);
  u.emit('error', err);
  assert.deepEqual(logs, [['update_error', 'HttpError: 404 ']]);
  assert.deepEqual(up.state(), { status: 'error', msg: 'Belum ada rilis yang bisa diunduh.' });
});

test('unduhan gagal selalu ditampilkan, dan bisa dicek ulang', async () => {
  const { u, up } = setup({ downloadFails: true });
  up.check();
  u.emit('update-available', { version: '1.1.0' });
  up.download();
  await tick();
  assert.deepEqual(up.state(), { status: 'error', msg: 'disk penuh' });
  up.check(true);
  assert.deepEqual(u.calls, ['check', 'download', 'check']);
});

test('popup otomatis maks. sekali sehari, tidak untuk cek manual, dan tidak untuk versi yang dilewati', () => {
  let saved = {};
  const store = { get: () => saved, set: v => { saved = v; } };
  const open = () => { const u = fake(); return { u, up: createUpdater({ updater: u, packaged: true, send: () => {}, store }) }; };
  const a = open();
  a.up.check();
  a.u.emit('update-available', { version: '1.1.0', releaseNotes: '<h2>English</h2><p>New</p>' });
  assert.equal(a.up.state().prompt, true);
  assert.deepEqual(a.up.state().notes, [{ version: '1.1.0', note: '<h2>English</h2><p>New</p>' }]);
  assert.equal(a.u.fullChangelog, true);
  assert.equal(a.up.seen().prompt, undefined); // dimuat ulang: tidak muncul lagi
  const b = open(); // Waku dibuka lagi hari yang sama
  b.up.check();
  b.u.emit('update-available', { version: '1.1.0' });
  assert.equal(b.up.state().prompt, undefined);
  saved.day = 'kemarin';
  const c = open();
  c.up.check(true); // cek manual: popup dibuka oleh tombol, bukan prompt
  c.u.emit('update-available', { version: '1.1.0' });
  assert.equal(c.up.state().prompt, undefined);
  c.up.skip();
  assert.equal(saved.skip, '1.1.0');
  assert.equal(c.up.state().skipped, true);
  const d = open();
  d.up.check();
  d.u.emit('update-available', { version: '1.1.0' });
  assert.deepEqual([d.up.state().prompt, d.up.state().skipped], [undefined, true]);
  const e = open(); // versi lebih baru: muncul lagi
  e.up.check();
  e.u.emit('update-available', { version: '1.2.0' });
  assert.equal(e.up.state().prompt, true);
});

test('catatan semua versi yang terlewat ikut dikirim, terbaru dulu', () => {
  const { u, up } = setup();
  up.check();
  u.emit('update-available', { version: '2.0.0', releaseNotes: [{ version: '2.0.0', note: '<p>b</p>' }, { version: '1.0.7', note: '<p>a</p>' }, { version: '1.0.6', note: null }] });
  assert.deepEqual(up.state().notes, [{ version: '2.0.0', note: '<p>b</p>' }, { version: '1.0.7', note: '<p>a</p>' }]);
});
