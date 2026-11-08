import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../server.js';

async function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-log-'));
  const logFile = path.join(dir, 'logs', 'waku.log');
  const srv = createServer({ port: 0, layoutFile: path.join(dir, 'layout.json'), logFile, statsEveryMs: 0, ...opts });
  const port = await srv.start();
  return { srv, port, logFile };
}
const open = (port, role) =>
  new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`);
    ws.q = [];
    ws.on('message', m => ws.q.push(JSON.parse(m)));
    ws.on('open', () => resolve(ws));
  });
const wait = ms => new Promise(r => setTimeout(r, ms));
const readLog = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

test('pesan log dari control ditulis dengan waktu ISO, src, event, dan data', async () => {
  const { srv, port, logFile } = await setup();
  const c = await open(port, 'control');
  c.send(JSON.stringify({ type: 'log', event: 'speak_on', data: { slot: 'a', delayMs: 120, t: 'palsu', src: 'palsu' } }));
  await wait(100);
  const line = readLog(logFile).find(l => l.event === 'speak_on');
  assert.equal(line.src, 'control');
  assert.equal(line.slot, 'a');
  assert.equal(line.delayMs, 120);
  assert.match(line.t, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  c.close(); await srv.close();
});

test('log tidak valid diabaikan: event kosong/panjang/aneh, data bukan objek, data terlalu besar', async () => {
  const { srv, port, logFile } = await setup();
  const c = await open(port, 'control');
  for (const bad of [
    { type: 'log' },
    { type: 'log', event: '', data: {} },
    { type: 'log', event: 'x'.repeat(41), data: {} },
    { type: 'log', event: 'Ada Spasi', data: {} },
    { type: 'log', event: 'ok_event', data: [1, 2] },
    { type: 'log', event: 'ok_event', data: 'teks' },
    { type: 'log', event: 'ok_event', data: { big: 'x'.repeat(3000) } },
  ]) c.send(JSON.stringify(bad));
  c.send(JSON.stringify({ type: 'log', event: 'valid_event', data: {} }));
  await wait(150);
  const events = readLog(logFile).map(l => l.event);
  assert.ok(events.includes('valid_event'));
  assert.ok(!events.includes('ok_event'));
  assert.equal(events.filter(e => e === 'valid_event').length, 1);
  c.close(); await srv.close();
});

test('banjir log dibatasi per koneksi (token bucket)', async () => {
  const { srv, port, logFile } = await setup();
  const c = await open(port, 'control');
  for (let i = 0; i < 300; i++) c.send(JSON.stringify({ type: 'log', event: 'banjir', data: { i } }));
  await wait(300);
  const n = readLog(logFile).filter(l => l.event === 'banjir').length;
  assert.ok(n >= 1 && n <= 120, 'tertulis ' + n);
  c.close(); await srv.close();
});

test('berkas log dirotasi ke .1 saat melebihi batas', async () => {
  const { srv, port, logFile } = await setup({ logMaxBytes: 400 });
  const c = await open(port, 'control');
  for (let i = 0; i < 12; i++) { c.send(JSON.stringify({ type: 'log', event: 'rotasi', data: { pad: 'x'.repeat(80), i } })); await wait(15); }
  await wait(150);
  assert.ok(fs.existsSync(logFile + '.1'), 'seharusnya ada .1');
  assert.ok(fs.statSync(logFile).size < 1500);
  c.close(); await srv.close();
});

test('rotasi menyimpan beberapa berkas lama (bukan hanya .1), dan server_start mencatat versi', async () => {
  const { srv, port, logFile } = await setup({ logMaxBytes: 300, logKeep: 3 });
  assert.match(fs.readFileSync(logFile, 'utf8'), /"event":"server_start","version":"\d+\.\d+\.\d+"/);
  const c = await open(port, 'control');
  for (let i = 0; i < 30; i++) { c.send(JSON.stringify({ type: 'log', event: 'rotasi', data: { pad: 'x'.repeat(80), i } })); await wait(10); }
  await wait(150);
  assert.ok(fs.existsSync(logFile + '.2'), 'seharusnya ada .2');
  assert.ok(!fs.existsSync(logFile + '.3'), 'logKeep 3: paling banyak .1 dan .2');
  c.close(); await srv.close();
});

test('server mencatat start, koneksi masuk/keluar, dan statistik berkala', async () => {
  const { srv, port, logFile } = await setup({ statsEveryMs: 40 });
  const p = await open(port, 'preview');
  await wait(150);
  p.close();
  await wait(100);
  const lines = readLog(logFile);
  assert.ok(lines.some(l => l.src === 'server' && l.event === 'server_start'));
  assert.ok(lines.some(l => l.event === 'conn_open' && l.role === 'preview'));
  assert.ok(lines.some(l => l.event === 'conn_close' && l.role === 'preview'));
  const st = lines.find(l => l.event === 'server_stats');
  assert.ok(st.rssMB > 0 && st.heapMB > 0 && typeof st.uptimeS === 'number' && st.clients);
  await srv.close();
});

test('speaking meneruskan stempel waktu t (angka) ke preview untuk mengukur latensi', async () => {
  const { srv, port } = await setup();
  const c = await open(port, 'control');
  const p = await open(port, 'preview');
  await wait(50);
  c.send(JSON.stringify({ type: 'speaking', slotId: 'a', speaking: true, t: 12345 }));
  c.send(JSON.stringify({ type: 'speaking', slotId: 'b', speaking: true, t: 'bukan angka' }));
  await wait(150);
  const a = p.q.find(m => m.type === 'speaking' && m.slotId === 'a');
  const b = p.q.find(m => m.type === 'speaking' && m.slotId === 'b');
  assert.equal(a.t, 12345);
  assert.equal(b.t, undefined);
  c.close(); p.close(); await srv.close();
});
