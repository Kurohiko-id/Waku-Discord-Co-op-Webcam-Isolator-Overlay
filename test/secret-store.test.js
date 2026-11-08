import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { encryptedFile } from '../secret-store.js';
import { createServer } from '../server.js';

const key = () => crypto.randomBytes(32).toString('base64');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kdc-sec-'));

test('encryptedFile: isi tidak tersimpan sebagai teks biasa, bisa dibaca lagi dengan kunci yang sama', () => {
  const dir = tmp(), k = key(), f = path.join(dir, 'x.enc');
  encryptedFile(f, k).write({ clientId: '123', clientSecret: 'rahasia_sekali_123' });
  assert.ok(!fs.readFileSync(f).includes('rahasia_sekali_123'));
  assert.deepEqual(encryptedFile(f, k).read(), { clientId: '123', clientSecret: 'rahasia_sekali_123' });
});

test('encryptedFile: kunci lain = unreadable (bukan error), berkas rusak juga', () => {
  const dir = tmp(), f = path.join(dir, 'x.enc');
  encryptedFile(f, key()).write({ a: 1 });
  const other = encryptedFile(f, key());
  assert.equal(other.read(), null);
  assert.equal(other.unreadable, true);
  fs.writeFileSync(f, 'sampah');
  const s = encryptedFile(f, key());
  assert.equal(s.read(), null);
  assert.equal(s.unreadable, true);
});

test('encryptedFile: berkas JSON lama dienkripsi sekali lalu dihapus', () => {
  const dir = tmp(), k = key(), legacy = path.join(dir, 'discord.json'), f = path.join(dir, 'discord.enc');
  fs.writeFileSync(legacy, JSON.stringify({ clientId: '1', clientSecret: 'lama_lama_lama' }));
  assert.deepEqual(encryptedFile(f, k, legacy).read(), { clientId: '1', clientSecret: 'lama_lama_lama' });
  assert.ok(!fs.existsSync(legacy));
  assert.ok(fs.existsSync(f));
  assert.deepEqual(encryptedFile(f, k).read(), { clientId: '1', clientSecret: 'lama_lama_lama' });
});

const open = port => new Promise(resolve => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=control`);
  ws.q = [];
  ws.on('message', m => ws.q.push(JSON.parse(m)));
  ws.on('open', () => resolve(ws));
});
const next = async (ws, pred) => {
  for (let i = 0; i < 100; i++) { const m = ws.q.find(pred); if (m) return m; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('timeout');
};
const serverIn = (dir, secretKey) => createServer({
  port: 0, layoutFile: path.join(dir, 'layout.json'), logFile: path.join(dir, 'waku.log'), statsEveryMs: 0,
  discordFile: path.join(dir, 'discord.json'), tokenFile: path.join(dir, 'discord-token.json'),
  discordPipes: ['\\\\?\\pipe\\waku-tidak-ada'], secretKey,
});

test('server dengan secretKey: discord.json/token lama dimigrasi ke .enc, tidak ada teks biasa tersisa', async () => {
  const dir = tmp(), k = key();
  fs.writeFileSync(path.join(dir, 'discord.json'), JSON.stringify({ clientId: '111111111111111111', clientSecret: 'lama_secret_123' }));
  fs.writeFileSync(path.join(dir, 'discord-token.json'), JSON.stringify({ access_token: 'tok_rahasia' }));
  const srv = serverIn(dir, k);
  const port = await srv.start();
  const c = await open(port);
  assert.equal((await next(c, m => m.type === 'discord')).clientId, '111111111111111111');
  await new Promise(r => setTimeout(r, 300)); // token dibaca saat Discord mencoba menyambung
  c.close(); await srv.close();
  assert.ok(!fs.existsSync(path.join(dir, 'discord.json')));
  assert.ok(fs.existsSync(path.join(dir, 'discord.enc')));
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) for (const s of ['lama_secret_123', 'tok_rahasia']) assert.ok(!fs.readFileSync(p).includes(s), f + ' berisi ' + s);
  }
});

test('server dengan kunci lain (data dipindah ke PC lain): kredensial kosong + pemberitahuan isi ulang', async () => {
  const dir = tmp();
  encryptedFile(path.join(dir, 'discord.enc'), key()).write({ clientId: '111111111111111111', clientSecret: 'lama_secret_123' });
  const srv = serverIn(dir, key());
  const port = await srv.start();
  const c = await open(port);
  assert.equal((await next(c, m => m.type === 'discord')).status, 'unset');
  assert.match((await next(c, m => m.type === 'notice')).msg, /Isi ulang Client ID/);
  // isi ulang menghapus pemberitahuan dan menyimpan dengan kunci baru
  c.send(JSON.stringify({ type: 'discord_creds', clientId: '222222222222222222', clientSecret: 'baru_secret_456' }));
  await next(c, m => m.type === 'notice' && m.msg === '');
  c.close(); await srv.close();
});
