import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server.js';
import { newSlot } from '../public/shared/layout.js';

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const layoutFile = path.join(dir, 'layout.json');
  const srv = createServer({ port: 0, layoutFile, logFile: path.join(dir, 'waku.log'), statsEveryMs: 0, uploadDir: path.join(dir, 'uploads') });
  const port = await srv.start();
  return { srv, port, layoutFile, dir };
}

const open = (port, role) =>
  new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`);
    ws.q = [];
    ws.on('message', m => ws.q.push(JSON.parse(m)));
    ws.on('open', () => resolve(ws));
  });

async function next(ws, pred) {
  for (let i = 0; i < 100; i++) {
    const k = ws.q.findIndex(pred);
    if (k >= 0) return ws.q.splice(k, 1)[0];
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('timeout');
}
const isLayout = m => m.type === 'layout';

test('klien baru menerima layout saat connect', async () => {
  const { srv, port } = await setup();
  const p = await open(port, 'preview');
  const m = await next(p, isLayout);
  assert.deepEqual(m.layout.slots, []);
  p.close(); await srv.close();
});

test('layout dari control diteruskan ke preview dan disimpan', async () => {
  const { srv, port, layoutFile } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await next(p, isLayout);
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)] } }));
  const m = await next(p, isLayout);
  assert.equal(m.layout.slots[0].id, 'a');
  c.close(); p.close(); await srv.close(); // simpan di-debounce, di-flush saat close
  assert.equal(JSON.parse(fs.readFileSync(layoutFile, 'utf8')).slots[0].id, 'a');
});

test('pesan sampah, layout invalid, dan layout dari preview diabaikan', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await next(p, isLayout);
  c.send('bukan json');
  c.send(JSON.stringify({ type: 'layout', layout: { slots: 'x' } }));
  p.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('hacked', 0)] } }));
  c.send(JSON.stringify({ type: 'speaking', slotId: 5, speaking: 'ya' }));
  c.send(JSON.stringify({ type: 'aneh' }));
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('ok', 0)] } }));
  const m = await next(p, isLayout);
  assert.equal(m.layout.slots[0].id, 'ok');
  assert.equal(p.q.filter(x => x.type === 'speaking').length, 0);
  c.close(); p.close(); await srv.close();
});

test('speaking, signal, dan ready dirutekan', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  c.send(JSON.stringify({ type: 'speaking', slotId: 'a', speaking: true }));
  assert.deepEqual(await next(p, m => m.type === 'speaking'), { type: 'speaking', slotId: 'a', speaking: true });
  c.send(JSON.stringify({ type: 'signal', data: { sdp: 'offer' } }));
  assert.deepEqual((await next(p, m => m.type === 'signal')).data, { sdp: 'offer' });
  p.send(JSON.stringify({ type: 'signal', data: { sdp: 'answer' } }));
  assert.deepEqual((await next(c, m => m.type === 'signal')).data, { sdp: 'answer' });
  p.send(JSON.stringify({ type: 'ready' }));
  await next(c, m => m.type === 'ready');
  p.send(JSON.stringify({ type: 'visible', on: false }));
  assert.deepEqual(await next(c, m => m.type === 'visible'), { type: 'visible', on: false });
  c.close(); p.close(); await srv.close();
});

const within = (p, ms = 1500) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

test('origin asing ditolak, origin lokal dan tanpa origin diterima', async () => {
  const { srv, port } = await setup();
  const bad = new WebSocket(`ws://127.0.0.1:${port}/ws?role=control`, { headers: { Origin: 'https://evil.example' } });
  const outcome = await within(new Promise(res => { bad.on('error', () => res('ditolak')); bad.on('open', () => res('terbuka')); }));
  assert.equal(outcome, 'ditolak');
  const good = new WebSocket(`ws://127.0.0.1:${port}/ws?role=control`, { headers: { Origin: `http://localhost:${port}` } });
  await within(new Promise((res, rej) => { good.on('open', res); good.on('error', rej); }));
  good.close(); await srv.close();
});

test('frame tidak valid tidak mematikan server', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  c.on('error', () => {});
  c._socket.write(Buffer.from([0x81, 0x01, 0x41])); // frame teks tanpa mask dari klien
  await within(new Promise(r => c.on('close', r)));
  const p = await open(port, 'preview');
  await next(p, isLayout);
  p.close(); await srv.close();
});

test('pesan terlalu besar memutus koneksi pengirim saja', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  c.on('error', () => {});
  c.send('x'.repeat(300_000));
  assert.equal(await within(new Promise(r => c.on('close', r))), 1009);
  const p = await open(port, 'preview');
  await next(p, isLayout);
  p.close(); await srv.close();
});

test('gagal menulis layout.json tidak mematikan server dan layout tetap diteruskan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const srv = createServer({ port: 0, layoutFile: path.join(dir, 'tidak-ada', 'layout.json'), logFile: path.join(dir, 'waku.log'), statsEveryMs: 0 });
  const port = await srv.start();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await next(p, isLayout);
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)] } }));
  assert.equal((await next(p, isLayout)).layout.slots[0].id, 'a');
  c.close(); p.close(); await srv.close();
});

test('signal dan ready hanya untuk preview terbaru, layout ke semua preview', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p1 = await open(port, 'preview');
  const p2 = await open(port, 'preview');
  await next(p1, isLayout); await next(p2, isLayout);
  c.send(JSON.stringify({ type: 'signal', data: { sdp: 'offer' } }));
  await next(p2, m => m.type === 'signal');
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)] } }));
  await next(p1, isLayout); await next(p2, isLayout);
  assert.equal(p1.q.filter(m => m.type === 'signal').length, 0);
  p1.send(JSON.stringify({ type: 'ready' }));
  p1.send(JSON.stringify({ type: 'visible', on: false })); // preview lama yang tidak menerima video: diabaikan
  p2.send(JSON.stringify({ type: 'ready' }));
  await next(c, m => m.type === 'ready');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(c.q.filter(m => m.type === 'ready').length, 0);
  assert.equal(c.q.filter(m => m.type === 'visible').length, 0);
  c.close(); p1.close(); p2.close(); await srv.close();
});

test('static: halaman dilayani, path di luar public ditolak', async () => {
  const { srv, port } = await setup();
  const ok = await fetch(`http://127.0.0.1:${port}/preview`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/server.js`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/..%2fserver.js`)).status, 404);
  await srv.close();
});

const openWith = (port, query) =>
  new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
    ws.q = [];
    ws.on('message', m => ws.q.push(JSON.parse(m)));
    ws.on('open', () => resolve(ws));
    ws.on('error', () => {});
  });
const closed = ws => new Promise(r => (ws.readyState === 3 ? r(ws.closeCode) : ws.on('close', code => r(code))));
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('URL request malformed dijawab 400, server tetap hidup', async () => {
  const { srv, port } = await setup();
  const http = await import('node:http');
  const status = await new Promise(res => http.get({ host: '127.0.0.1', port, path: '//' }, r => { r.resume(); res(r.statusCode); }).on('error', () => res('err')));
  assert.equal(status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/preview`)).status, 200);
  await srv.close();
});

test('layout.json rusak disimpan sebagai .bad, bukan ditimpa diam-diam', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const layoutFile = path.join(dir, 'layout.json');
  fs.writeFileSync(layoutFile, '{ rusak');
  const srv = createServer({ port: 0, layoutFile, logFile: path.join(dir, 'waku.log'), statsEveryMs: 0 });
  await srv.start();
  assert.equal(fs.readFileSync(layoutFile + '.bad', 'utf8'), '{ rusak');
  await srv.close();
});

test('banyak pesan layout beruntun ditulis sekali dengan isi terakhir', async () => {
  const { srv, port, layoutFile } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await next(p, isLayout);
  for (const id of ['a', 'b', 'c']) c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot(id, 0)] } }));
  await next(p, m => isLayout(m) && m.layout.slots[0]?.id === 'c');
  assert.equal(fs.existsSync(layoutFile), false); // belum ditulis selama masih ramai
  await sleep(500);
  assert.equal(JSON.parse(fs.readFileSync(layoutFile, 'utf8')).slots[0].id, 'c');
  c.close(); p.close(); await srv.close();
});

test('preview menerima layout tanpa presets dan guides', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await next(p, isLayout);
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)], presets: [{ name: 'x', slots: [newSlot('a', 0)] }], guides: { x: [10], y: [] } } }));
  const m = await next(p, m => isLayout(m) && m.layout.slots.length === 1);
  assert.equal(m.layout.presets, undefined);
  assert.equal(m.layout.guides, undefined);
  c.close(); p.close(); await srv.close();
});

test('preview baru menerima status speaking yang sedang aktif', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  c.send(JSON.stringify({ type: 'speaking', slotId: 'a', speaking: true }));
  c.send(JSON.stringify({ type: 'speaking', slotId: 'b', speaking: true }));
  c.send(JSON.stringify({ type: 'speaking', slotId: 'b', speaking: false }));
  await sleep(50);
  const p = await open(port, 'preview');
  const m = await next(p, m => m.type === 'speaking');
  assert.equal(m.slotId, 'a'); assert.equal(m.speaking, true);
  await sleep(50);
  assert.equal(p.q.filter(m => m.type === 'speaking').length, 0);
  c.close(); p.close(); await srv.close();
});

test('control terakhir putus: semua speaking dimatikan di preview', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  c.send(JSON.stringify({ type: 'speaking', slotId: 'a', speaking: true }));
  await next(p, m => m.type === 'speaking' && m.speaking);
  c.close();
  const m = await next(p, m => m.type === 'speaking');
  assert.equal(m.slotId, 'a'); assert.equal(m.speaking, false);
  p.close(); await srv.close();
});

test('control kedua ditolak (busy) selama control pertama aktif', async () => {
  const { srv, port } = await setup();
  const c1 = await open(port, 'control');
  const c2 = await openWith(port, 'role=control');
  await next(c2, m => m.type === 'busy');
  assert.equal(await closed(c2), 4001);
  // control pertama tetap jadi pengirim layout
  const p = await open(port, 'preview');
  await next(p, isLayout);
  c1.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)] } }));
  await next(p, m => isLayout(m) && m.layout.slots[0]?.id === 'a');
  c1.close(); p.close(); await srv.close();
});

test('control dengan takeover menggantikan control lama', async () => {
  const { srv, port } = await setup();
  const c1 = await open(port, 'control');
  const c2 = await openWith(port, 'role=control&takeover=1');
  assert.equal(await closed(c1), 4000);
  const p = await open(port, 'preview');
  await next(p, isLayout);
  c2.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('b', 0)] } }));
  await next(p, m => isLayout(m) && m.layout.slots[0]?.id === 'b');
  c2.close(); p.close(); await srv.close();
});

test('preview terbaru ditutup: control diminta offer ulang ke preview sebelumnya', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p1 = await open(port, 'preview');
  const p2 = await open(port, 'preview');
  await next(p2, isLayout);
  p2.close();
  await next(c, m => m.type === 'ready');
  c.close(); p1.close(); await srv.close();
});

test('layout besar (di atas 64 KB) tetap diterima', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await next(p, isLayout);
  const slots = Array.from({ length: 16 }, (_, i) => newSlot('s' + i, i));
  const presets = Array.from({ length: 20 }, (_, i) => ({ name: 'preset ' + i, slots }));
  const msg = JSON.stringify({ type: 'layout', layout: { slots, presets } });
  assert.ok(msg.length > 64 * 1024, 'uji butuh pesan > 64 KB, dapat ' + msg.length);
  c.send(msg);
  await next(p, m => isLayout(m) && m.layout.slots.length === 16);
  c.close(); p.close(); await srv.close();
});

test('upload gambar: disimpan dan bisa diambil lagi; jenis lain, terlalu besar, dan origin asing ditolak', async () => {
  const { srv, port, dir } = await setup();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = (body, type, headers = {}) => fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body, headers: { 'content-type': type, ...headers } });
  const r = await up(png, 'image/png');
  assert.equal(r.status, 200);
  const { url } = await r.json();
  assert.match(url, new RegExp("^/uploads/[a-f0-9]{16}[.]png$"));
  assert.ok(fs.existsSync(path.join(dir, 'uploads', path.basename(url))));
  const back = await fetch(`http://127.0.0.1:${port}${url}`);
  assert.equal(back.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await back.arrayBuffer()), png);
  assert.equal((await up('x', 'text/html')).status, 415);
  assert.equal((await up(Buffer.alloc(9 * 1024 * 1024), 'image/png')).status, 413);
  assert.equal((await up(png, 'image/png', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/uploads/..%2fwaku.log`)).status, 404);
  await srv.close();
});

test('control menerima versi; info dan bersihkan gambar unggahan yang tidak dipakai', async () => {
  const { srv, port, dir } = await setup();
  const up = dir + '/uploads';
  fs.mkdirSync(up);
  fs.writeFileSync(up + '/aaaaaaaaaaaaaaaa.png', 'x'.repeat(10)); // dipakai frame virtual
  fs.writeFileSync(up + '/bbbbbbbbbbbbbbbb.png', 'y'.repeat(20)); // dipakai preset
  fs.writeFileSync(up + '/cccccccccccccccc.png', 'z'.repeat(30)); // tidak dipakai
  fs.writeFileSync(up + '/dddddddddddddddd.png', 'w'.repeat(40)); // hanya di daftar virtual frame tersimpan
  const c = await open(port, 'control');
  assert.match((await next(c, m => m.type === 'info')).version, /^[0-9]+[.][0-9]+[.][0-9]+$/);
  const v = name => ({ ...newSlot('v' + name, 0), image: '/uploads/' + name + '.png', imgW: 10, imgH: 10 });
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [v('aaaaaaaaaaaaaaaa')], presets: [{ id: 'p', name: 'p', slots: [v('bbbbbbbbbbbbbbbb')] }], library: [v('dddddddddddddddd')] } }));
  await sleep(50);
  c.send(JSON.stringify({ type: 'uploads_info' }));
  assert.deepEqual(await next(c, m => m.type === 'uploads'), { type: 'uploads', count: 4, bytes: 100, unusedCount: 1, unusedBytes: 30, removed: 0 });
  c.send(JSON.stringify({ type: 'uploads_clean' }));
  assert.deepEqual(await next(c, m => m.type === 'uploads'), { type: 'uploads', count: 3, bytes: 70, unusedCount: 0, unusedBytes: 0, removed: 1 });
  assert.deepEqual(fs.readdirSync(up).sort(), ['aaaaaaaaaaaaaaaa.png', 'bbbbbbbbbbbbbbbb.png', 'dddddddddddddddd.png']);
  c.close(); await srv.close();
});

test('layout.json rusak: control diberi peringatan, dan backup .bad tetap utuh setelah layout baru disimpan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const layoutFile = path.join(dir, 'layout.json');
  fs.writeFileSync(layoutFile, '{ rusak');
  const srv = createServer({ port: 0, layoutFile, logFile: path.join(dir, 'waku.log'), statsEveryMs: 0, persistDelayMs: 0 });
  const port = await srv.start();
  const c = await open(port, 'control');
  assert.match((await next(c, m => m.type === 'notice')).msg, /layout\.json\.bad/);
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)] } }));
  await sleep(50);
  assert.equal(JSON.parse(fs.readFileSync(layoutFile, 'utf8')).slots[0].id, 'a');
  assert.equal(fs.readFileSync(layoutFile + '.bad', 'utf8'), '{ rusak');
  c.close(); await srv.close();
});

test('gagal menyimpan layout: control diberi peringatan (bukan hanya log)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-'));
  const srv = createServer({ port: 0, layoutFile: path.join(dir, 'tidak-ada', 'layout.json'), logFile: path.join(dir, 'waku.log'), statsEveryMs: 0, persistDelayMs: 0 });
  const port = await srv.start();
  const c = await open(port, 'control');
  await next(c, isLayout);
  assert.ok(!c.q.some(m => m.type === 'notice')); // tidak ada peringatan sebelum ada masalah
  c.send(JSON.stringify({ type: 'layout', layout: { slots: [newSlot('a', 0)] } }));
  assert.match((await next(c, m => m.type === 'notice')).msg, /gagal disimpan/);
  c.close(); await srv.close();
});

test('DNS rebinding: Host asing ditolak untuk HTTP dan WebSocket; halaman membawa CSP dan nosniff', async () => {
  const { srv, port } = await setup();
  const http = await import('node:http');
  const get = (p, host) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p, headers: { host } }, r => { r.resume(); res(r); }));
  assert.equal((await get('/preview', `evil.example:${port}`)).statusCode, 403);
  assert.equal((await get('/preview', 'localhost:1')).statusCode, 403); // port lain
  const ok = await get('/control', `localhost:${port}`);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  const evil = new WebSocket(`ws://127.0.0.1:${port}/ws?role=control`, { headers: { host: 'evil.example' } });
  const rejected = await new Promise(r => { evil.on('open', () => r(false)); evil.on('error', () => r(true)); });
  assert.ok(rejected);
  await srv.close();
});

test('kredensial Discord dari tab Atur: disimpan, secret tidak pernah dikirim balik, token lama dibuang saat ID berganti, bisa dihapus', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-dc-'));
  const discordFile = path.join(dir, 'discord.json');
  const tokenFile = path.join(dir, 'discord-token.json');
  fs.writeFileSync(discordFile, JSON.stringify({ clientId: '111111111111111111', clientSecret: 'lama_secret_123' }));
  fs.writeFileSync(tokenFile, '{"access_token":"x"}');
  // pipe yang tidak ada: tes tidak boleh menyentuh Discord sungguhan di PC ini
  const srv = createServer({ port: 0, layoutFile: path.join(dir, 'layout.json'), logFile: path.join(dir, 'waku.log'), statsEveryMs: 0, discordFile, tokenFile, discordPipes: ['\\?\pipe\waku-tidak-ada'] });
  const port = await srv.start();
  const c = await open(port, 'control');
  const isDc = m => m.type === 'discord';
  assert.equal((await next(c, isDc)).clientId, '111111111111111111');

  // tidak valid: diabaikan, file tidak berubah
  c.send(JSON.stringify({ type: 'discord_creds', clientId: 'abc', clientSecret: 'x' }));
  c.send(JSON.stringify({ type: 'discord_creds', clientId: '222222222222222222', clientSecret: '' })); // ID baru wajib secret baru
  // ID sama, secret kosong = secret lama dipakai lagi, token tetap
  c.send(JSON.stringify({ type: 'discord_creds', clientId: '111111111111111111', clientSecret: '' }));
  await new Promise(r => setTimeout(r, 150));
  assert.equal(JSON.parse(fs.readFileSync(discordFile, 'utf8')).clientSecret, 'lama_secret_123');
  assert.ok(fs.existsSync(tokenFile));

  c.q.length = 0;
  c.send(JSON.stringify({ type: 'discord_creds', clientId: '222222222222222222', clientSecret: 'baru_secret_456' }));
  const m = await next(c, m => isDc(m) && m.clientId === '222222222222222222');
  assert.ok(!JSON.stringify(m).includes('baru_secret_456'));
  assert.deepEqual(JSON.parse(fs.readFileSync(discordFile, 'utf8')), { clientId: '222222222222222222', clientSecret: 'baru_secret_456' });
  assert.ok(!fs.existsSync(tokenFile), 'token milik aplikasi Discord lama harus dibuang');
  assert.ok(!fs.readFileSync(path.join(dir, 'waku.log'), 'utf8').includes('baru_secret_456'));

  c.send(JSON.stringify({ type: 'discord_creds', clear: true }));
  assert.equal((await next(c, m => isDc(m) && m.status === 'unset')).clientId, '');
  assert.ok(!fs.existsSync(discordFile));
  c.close(); await srv.close();
});

test('tanpa discord.json: control tetap diberi status unset supaya form kosong tampil', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-dc-'));
  const srv = createServer({ port: 0, layoutFile: path.join(dir, 'layout.json'), logFile: path.join(dir, 'waku.log'), statsEveryMs: 0, discordFile: path.join(dir, 'discord.json'), tokenFile: path.join(dir, 't.json') });
  const port = await srv.start();
  const c = await open(port, 'control');
  const m = await next(c, m => m.type === 'discord');
  assert.equal(m.status, 'unset');
  c.close(); await srv.close();
});

test('port sudah dipakai: start() ditolak dengan EADDRINUSE (tidak menggantung, tidak uncaught)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-port-'));
  const a = createServer({ port: 0, layoutFile: path.join(dir, 'a.json'), logFile: path.join(dir, 'a.log'), statsEveryMs: 0 });
  const port = await a.start();
  const b = createServer({ port, layoutFile: path.join(dir, 'b.json'), logFile: path.join(dir, 'b.log'), statsEveryMs: 0 });
  await assert.rejects(Promise.race([b.start(), new Promise((_, rej) => setTimeout(() => rej(new Error('menggantung')), 2000))]), { code: 'EADDRINUSE' });
  await a.close();
});

test('plugin Stream Deck (role deck): status dari control diteruskan, perintah dirapikan lalu dikirim ke control', async () => {
  const { srv, port } = await setup();
  const d = await open(port, 'deck');
  assert.deepEqual(await next(d, m => m.type === 'state'), { type: 'state', control: false, state: null });
  d.send(JSON.stringify({ type: 'cmd', action: { type: 'detect' } }));
  assert.equal((await next(d, m => m.type === 'error')).error, 'no_control');

  const c = await open(port, 'control');
  await next(c, isLayout);
  c.send(JSON.stringify({ type: 'deck_state', state: { presets: [{ id: 'p1', name: 'Main', slots: [1, 2] }], templates: [{ key: 'neon', name: 'Neon' }], template: 'neon', detect: 1, extra: 'x' } }));
  const s = await next(d, m => m.type === 'state' && m.control);
  assert.deepEqual(s.state, { presets: [{ id: 'p1', name: 'Main' }], templates: [{ key: 'neon', name: 'Neon' }], template: 'neon', detect: true });

  d.send(JSON.stringify({ type: 'cmd', action: { type: 'preset', id: 'p1', evil: 1 } }));
  d.send(JSON.stringify({ type: 'cmd', action: { type: 'preset', id: '../x' } })); // id tidak valid: dibuang
  d.send(JSON.stringify({ type: 'layout', layout: { slots: [] } })); // deck tidak boleh mengubah layout
  d.send(JSON.stringify({ type: 'cmd', action: { type: 'detect', set: 'off' } }));
  assert.deepEqual((await next(c, m => m.type === 'cmd')).action, { type: 'preset', id: 'p1' });
  assert.deepEqual((await next(c, m => m.type === 'cmd')).action, { type: 'detect', set: 'off' });
  assert.equal(c.q.filter(m => m.type === 'cmd' || m.type === 'layout').length, 0);

  c.close();
  assert.equal((await next(d, m => m.type === 'state')).control, false); // control putus: tombol tahu
  d.close(); await srv.close();
});

test('instalasi baru (belum ada layout.json): mulai dengan preset bawaan P2-P7; layout rusak tetap mulai kosong', async () => {
  const { srv, port, dir } = await setup();
  const c = await open(port, 'control');
  const l = (await next(c, m => m.type === 'layout')).layout;
  assert.deepEqual(l.presets.map(p => p.name), [2, 3, 4, 5, 6, 7].map(n => 'P' + n + '-default'));
  assert.deepEqual(l.slots, []);
  c.close(); await srv.close();
  const bad = path.join(dir, 'rusak.json');
  fs.writeFileSync(bad, '{ rusak');
  const srv2 = createServer({ port: 0, layoutFile: bad, logFile: path.join(dir, 'waku2.log'), statsEveryMs: 0 });
  const c2 = await open(await srv2.start(), 'control');
  assert.deepEqual((await next(c2, m => m.type === 'layout')).layout.presets, []);
  c2.close(); await srv2.close();
});
