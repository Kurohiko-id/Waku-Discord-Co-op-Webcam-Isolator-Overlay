import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encode, decoder, createDiscord } from '../discord.js';

test('paket RPC: encode lalu decode, termasuk paket terpotong dan dua paket sekaligus', () => {
  const got = [];
  const feed = decoder((op, d) => got.push([op, d]));
  const a = encode(1, { cmd: 'X', n: 1 }), b = encode(3, { n: 2 });
  const both = Buffer.concat([a, b]);
  feed(both.subarray(0, 5));
  feed(both.subarray(5, a.length + 3));
  feed(both.subarray(a.length + 3));
  assert.deepEqual(got, [[1, { cmd: 'X', n: 1 }], [3, { n: 2 }]]);
});

// Discord palsu: pipe sendiri (bukan discord-ipc-N) supaya tes tidak menyentuh Discord yang sedang berjalan.
test('alur lengkap: izin, token, channel, anggota, dan kejadian bicara', async () => {
  const pipe = process.platform === 'win32' ? `\\\\?\\pipe\\waku-test-${process.pid}` : path.join(os.tmpdir(), `waku-test-${process.pid}.sock`);
  const tokenFile = path.join(os.tmpdir(), `waku-token-${process.pid}.json`);
  fs.rmSync(tokenFile, { force: true });
  const cmds = [];
  let client;
  const fake = net.createServer(sock => {
    client = sock;
    sock.on('data', decoder((op, m) => {
      if (op === 0) return sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
      cmds.push(m.evt ? `${m.cmd}:${m.evt}` : m.cmd);
      const reply = data => sock.write(encode(1, { cmd: m.cmd, nonce: m.nonce, data }));
      if (m.cmd === 'AUTHORIZE') reply({ code: 'kode123' });
      else if (m.cmd === 'GET_SELECTED_VOICE_CHANNEL') reply({ id: '111111', name: 'Co-op', voice_states: [{ nick: 'Kuro', user: { id: '222222', username: 'kuro' } }] });
      else reply({});
    }));
  });
  await new Promise(r => fake.listen(pipe, r));

  const realFetch = globalThis.fetch;
  let tokenBody;
  globalThis.fetch = async (_url, opt) => { tokenBody = Object.fromEntries(opt.body); return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 600 }) }; };
  const states = [], speaks = [];
  const dc = createDiscord({ clientId: '12345', clientSecret: 's', tokenFile, pipes: [pipe], onState: s => states.push(s), onSpeaking: (id, on) => speaks.push([id, on]) });
  try {
    dc.start();
    const until = async cond => { for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(cond()); };
    await until(() => states.at(-1)?.channel);
    assert.equal(tokenBody.code, 'kode123');
    assert.equal(tokenBody.redirect_uri, 'http://localhost');
    assert.deepEqual(states.at(-1), { status: 'ready', channel: { id: '111111', name: 'Co-op' }, members: [{ id: '222222', name: 'Kuro' }], error: undefined });
    assert.ok(cmds.includes('SUBSCRIBE:SPEAKING_START') && cmds.includes('SUBSCRIBE:SPEAKING_STOP'));
    assert.equal(JSON.parse(fs.readFileSync(tokenFile, 'utf8')).access_token, 'a'); // lain kali tanpa popup izin

    client.write(encode(1, { cmd: 'DISPATCH', evt: 'SPEAKING_START', data: { user_id: '222222' } }));
    client.write(encode(1, { cmd: 'DISPATCH', evt: 'SPEAKING_STOP', data: { user_id: '222222' } }));
    await until(() => speaks.length === 2);
    assert.deepEqual(speaks, [['222222', true], ['222222', false]]);
  } finally {
    globalThis.fetch = realFetch;
    dc.stop();
    fake.close();
    fs.rmSync(tokenFile, { force: true });
  }
});

test('paket RPC dengan panjang negatif atau raksasa dibuang, tidak membekukan server', () => {
  const got = [];
  const feed = decoder((_op, d) => got.push(d));
  const head = len => { const b = Buffer.alloc(8); b.writeInt32LE(1, 0); b.writeInt32LE(len, 4); return b; };
  feed(head(-8)); // dulu: loop tak berujung
  feed(head(0x7fffffff)); // dulu: buffer menunggu 2 GB
  feed(encode(1, { ok: 1 }));
  assert.deepEqual(got, [{ ok: 1 }]);
});

// Discord palsu yang bisa diatur jawabannya per perintah; mengembalikan daftar koneksi yang masuk.
async function fakeDiscord(name, answer) {
  const pipe = process.platform === 'win32' ? `\\\\?\\pipe\\waku-${name}-${process.pid}` : path.join(os.tmpdir(), `waku-${name}-${process.pid}.sock`);
  const socks = [];
  const srv = net.createServer(sock => {
    socks.push(sock);
    sock.on('error', () => {});
    sock.on('data', decoder((op, m) => {
      if (op === 0) return sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
      const reply = data => sock.write(encode(1, { cmd: m.cmd, nonce: m.nonce, data }));
      answer(m, reply);
    }));
  });
  await new Promise(r => srv.listen(pipe, r));
  return { pipe, socks, close: () => { for (const s of socks) s.destroy(); srv.close(); } };
}
const until = async cond => { for (let i = 0; i < 150 && !cond(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(cond()); };
const freshToken = () => {
  const f = path.join(os.tmpdir(), `waku-token-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600_000 }));
  return f;
};

test('perintah RPC yang tidak dijawab berakhir error (bukan menggantung), lalu coba lagi tersambung ulang', async () => {
  const fake = await fakeDiscord('timeout', (m, reply) => { if (m.cmd !== 'GET_SELECTED_VOICE_CHANNEL') reply({}); }); // yang ini tidak pernah dijawab
  const tokenFile = freshToken();
  const states = [];
  const dc = createDiscord({ clientId: '1', clientSecret: 's', tokenFile, pipes: [fake.pipe], timeoutMs: 50, onState: s => states.push(s), onSpeaking: () => {} });
  try {
    dc.start();
    await until(() => states.at(-1)?.status === 'error');
    assert.match(states.at(-1).error, /GET_SELECTED_VOICE_CHANNEL/);
    dc.retry();
    await until(() => fake.socks.length === 2);
  } finally { dc.stop(); fake.close(); fs.rmSync(tokenFile, { force: true }); }
});

test('coba lagi saat popup Authorize masih menggantung: socket lama diputus dan tersambung ulang', async () => {
  const fake = await fakeDiscord('authorize', (m, reply) => { if (m.cmd !== 'AUTHORIZE') reply({}); }); // pengguna tidak pernah klik
  const tokenFile = path.join(os.tmpdir(), `waku-token-none-${process.pid}.json`);
  fs.rmSync(tokenFile, { force: true });
  const states = [];
  const dc = createDiscord({ clientId: '1', clientSecret: 's', tokenFile, pipes: [fake.pipe], timeoutMs: 50, onState: s => states.push(s), onSpeaking: () => {} });
  try {
    dc.start();
    await until(() => states.at(-1)?.status === 'authorize');
    await new Promise(r => setTimeout(r, 120)); // AUTHORIZE tidak kena timeout: tetap menunggu klik
    assert.equal(states.at(-1).status, 'authorize');
    dc.retry();
    await until(() => fake.socks.length === 2);
  } finally { dc.stop(); fake.close(); }
});

test('pindah channel cepat: jawaban channel lama yang telat tidak menimpa channel baru', async () => {
  const fake = await fakeDiscord('race', (m, reply) => {
    if (m.cmd === 'GET_CHANNEL') {
      const id = m.args.channel_id;
      setTimeout(() => reply({ id, name: id, voice_states: [{ user: { id: 'u' + id } }] }), id === 'A' ? 150 : 10); // A dijawab paling akhir
    } else if (m.cmd === 'GET_SELECTED_VOICE_CHANNEL') reply(null);
    else reply({});
  });
  const tokenFile = freshToken();
  const states = [], speaks = [];
  const dc = createDiscord({ clientId: '1', clientSecret: 's', tokenFile, pipes: [fake.pipe], onState: s => states.push(s), onSpeaking: (id, on) => speaks.push([id, on]) });
  try {
    dc.start();
    await until(() => states.at(-1)?.status === 'ready');
    const sel = id => fake.socks[0].write(encode(1, { cmd: 'DISPATCH', evt: 'VOICE_CHANNEL_SELECT', data: { channel_id: id } }));
    sel('A'); sel('B');
    await until(() => states.at(-1)?.channel?.id === 'B');
    await new Promise(r => setTimeout(r, 250)); // jawaban A datang sekarang
    assert.deepEqual(states.at(-1).channel, { id: 'B', name: 'B' });
    assert.deepEqual(states.at(-1).members, [{ id: 'uB', name: 'uB' }]);
    const speak = (ch, on) => fake.socks[0].write(encode(1, { cmd: 'DISPATCH', evt: on ? 'SPEAKING_START' : 'SPEAKING_STOP', data: { user_id: 'x', channel_id: ch } }));
    speak('A', true); speak('B', true);
    await until(() => speaks.some(([id]) => id === 'x'));
    await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(speaks.filter(([id]) => id === 'x'), [['x', true]]); // hanya dari channel B
  } finally { dc.stop(); fake.close(); fs.rmSync(tokenFile, { force: true }); }
});
