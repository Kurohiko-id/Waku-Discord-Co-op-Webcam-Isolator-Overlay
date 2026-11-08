// Jembatan ke aplikasi Discord di PC ini lewat RPC lokal resmi Discord (pipe discord-ipc-N).
// Hasilnya: siapa saja di voice channel yang sedang kamu ikuti, dan kapan masing-masing mulai/berhenti bicara.
import net from 'node:net';
import { jsonFile } from './secret-store.js';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const REDIRECT = 'http://localhost'; // harus sama dengan Redirect di Developer Portal
// Cukup 'rpc' untuk channel, anggota, dan event bicara.
// rpc.voice.read khusus partner yang disetujui Discord dan bisa membuat izin gagal untuk app biasa.
const SCOPES = ['rpc'];

const MAX_PACKET = 1024 * 1024; // paket RPC Discord hanya beberapa KB

// Paket RPC: [op int32 LE][panjang int32 LE][JSON]
export const encode = (op, obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};
export function decoder(onPacket) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const len = buf.readInt32LE(4);
      // panjang negatif membuat loop ini tak pernah maju (server beku); raksasa membuat buffer tumbuh tanpa batas
      if (len < 0 || len > MAX_PACKET) { buf = Buffer.alloc(0); return; }
      if (buf.length < 8 + len) break;
      const op = buf.readInt32LE(0);
      const body = buf.subarray(8, 8 + len);
      buf = buf.subarray(8 + len);
      let data;
      try { data = JSON.parse(body); } catch { continue; }
      onPacket(op, data);
    }
  };
}

const pipePath = i => (process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-${i}`
  : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'}/discord-ipc-${i}`);

function openPipe(paths) {
  return new Promise((resolve, reject) => {
    const tryAt = i => {
      if (i >= paths.length) return reject(new Error('Discord tidak berjalan'));
      const sock = net.createConnection(paths[i]);
      sock.once('connect', () => { sock.removeAllListeners('error'); resolve(sock); });
      sock.once('error', () => tryAt(i + 1));
    };
    tryAt(0);
  });
}

export const memberName = v => v.nick || v.user?.global_name || v.user?.username || v.user?.id;

// status: off (Discord tidak berjalan) | connecting | authorize (menunggu klik Authorize) | ready | denied | error
// tokenStore: { read, write } (secret-store.js); tokenFile = pintasan untuk berkas JSON biasa.
export function createDiscord({ clientId, clientSecret, tokenFile, tokenStore = jsonFile(tokenFile), onState, onSpeaking, log = () => {}, pipes = [...Array(10).keys()].map(pipePath), timeoutMs = 10000 }) {
  let sock = null, stopped = false, retryTimer = null, nonce = 0, retryNow = false;
  let chSeq = 0; // pindah channel beruntun: hanya permintaan terakhir yang boleh mengisi state
  const pending = new Map();
  const state = { status: 'connecting', channel: null, members: [], error: undefined };
  const members = new Map(); // userId -> nama
  const emit = () => { state.members = [...members].map(([id, name]) => ({ id, name })); onState({ ...state }); };
  const setStatus = (status, error) => { state.status = status; state.error = error; emit(); };

  const send = (op, obj) => sock?.write(encode(op, obj));
  const command = (cmd, args, evt) => new Promise((resolve, reject) => {
    const n = String(++nonce);
    // AUTHORIZE menunggu klik pengguna di Discord; perintah lain yang tak dijawab tidak boleh menggantung selamanya
    const timer = cmd === 'AUTHORIZE' ? null : setTimeout(() => { pending.delete(n); reject(new Error(cmd + ' tidak dijawab Discord')); }, timeoutMs);
    timer?.unref();
    const done = f => v => { clearTimeout(timer); f(v); };
    pending.set(n, { resolve: done(resolve), reject: done(reject) });
    send(OP.FRAME, { cmd, args, evt, nonce: n });
  });

  const readToken = () => tokenStore.read();
  const saveToken = t => {
    const tok = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
    try { tokenStore.write(tok); } catch { /* izin diminta lagi lain kali */ }
    return tok;
  };
  const tokenRequest = async params => {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('token: ' + (j.error_description || j.error || r.status));
    return saveToken(j);
  };

  async function authenticate() {
    let tok = readToken();
    if (tok?.refresh_token && tok.expires_at < Date.now() + 60_000) {
      try { tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }); } catch { tok = null; }
    }
    if (tok) {
      try { return await command('AUTHENTICATE', { access_token: tok.access_token }); } catch { /* token dicabut: minta izin lagi */ }
    }
    setStatus('authorize');
    const { code } = await command('AUTHORIZE', { client_id: clientId, scopes: SCOPES });
    tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
    return command('AUTHENTICATE', { access_token: tok.access_token });
  }

  const CH_EVENTS = ['SPEAKING_START', 'SPEAKING_STOP', 'VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE'];
  async function selectChannel(ch, seq = ++chSeq) {
    if (seq !== chSeq) return; // sudah ada pindah channel yang lebih baru
    const old = state.channel;
    if (old) {
      for (const e of CH_EVENTS) command('UNSUBSCRIBE', { channel_id: old.id }, e).catch(() => {});
      for (const id of members.keys()) onSpeaking(id, false); // pindah channel: jangan ada glow yang tertinggal
    }
    members.clear();
    state.channel = ch ? { id: ch.id, name: ch.name } : null;
    for (const v of ch?.voice_states ?? []) if (v.user?.id) members.set(v.user.id, memberName(v));
    for (const e of ch ? CH_EVENTS : []) {
      if (seq !== chSeq) return; // channel berganti selagi berlangganan: pemanggil yang baru mengurus sisanya
      await command('SUBSCRIBE', { channel_id: ch.id }, e).catch(err => log('discord_sub_error', { evt: e, msg: err.message }));
    }
    if (seq === chSeq) emit();
  }

  function onDispatch(msg) {
    const d = msg.data ?? {};
    switch (msg.evt) {
      case 'READY': {
        const mine = sock;
        authenticate()
          .then(async () => {
            await command('SUBSCRIBE', {}, 'VOICE_CHANNEL_SELECT');
            state.status = 'ready'; state.error = undefined;
            log('discord_ready', {});
            const seq = ++chSeq;
            await selectChannel(await command('GET_SELECTED_VOICE_CHANNEL', {}), seq);
          })
          .catch(e => {
            if (sock !== mine) return; // koneksi ini sudah putus/diganti: status diurus handler close
            const msg = String(e.message).slice(0, 200);
            log('discord_auth_error', { msg });
            // ditolak/gagal: jangan coba sendiri (popup berulang mengganggu); tombol di /control mencoba lagi
            setStatus(/denied|cancel|5000/i.test(msg) ? 'denied' : 'error', msg);
            sock?.destroy();
          });
        break;
      }
      case 'VOICE_CHANNEL_SELECT':
        if (!d.channel_id) selectChannel(null);
        else { const seq = ++chSeq; command('GET_CHANNEL', { channel_id: d.channel_id }).then(ch => selectChannel(ch, seq)).catch(() => {}); }
        break;
      case 'VOICE_STATE_CREATE':
      case 'VOICE_STATE_UPDATE':
        if (d.user?.id) { members.set(d.user.id, memberName(d)); emit(); }
        break;
      case 'VOICE_STATE_DELETE':
        if (d.user?.id && members.delete(d.user.id)) { onSpeaking(d.user.id, false); emit(); }
        break;
      case 'SPEAKING_START':
      case 'SPEAKING_STOP':
        // langganan channel lama yang belum sempat dilepas tidak boleh menyalakan glow
        if (d.user_id && (!d.channel_id || d.channel_id === state.channel?.id)) onSpeaking(d.user_id, msg.evt === 'SPEAKING_START');
        break;
    }
  }

  function onPacket(op, msg) {
    if (op === OP.PING) return send(OP.PONG, msg);
    if (op === OP.CLOSE) {
      log('discord_closed', { code: msg.code, msg: String(msg.message).slice(0, 200) });
      if (state.status === 'connecting') setStatus('error', String(msg.message).slice(0, 200)); // mis. Client ID salah
      return;
    }
    if (op !== OP.FRAME) return;
    if (msg.cmd === 'DISPATCH') return onDispatch(msg);
    const p = pending.get(msg.nonce);
    if (!p) return;
    pending.delete(msg.nonce);
    if (msg.evt === 'ERROR') p.reject(new Error(`${msg.data?.code} ${msg.data?.message}`));
    else p.resolve(msg.data);
  }

  async function connect() {
    retryTimer = null;
    if (stopped || sock) return;
    setStatus('connecting');
    let s;
    try { s = await openPipe(pipes); } catch { setStatus('off'); return schedule(5000); }
    if (stopped) return s.destroy();
    sock = s;
    sock.on('data', decoder(onPacket));
    sock.on('error', () => {});
    sock.on('close', () => {
      sock = null;
      for (const p of pending.values()) p.reject(new Error('koneksi Discord putus'));
      pending.clear();
      for (const id of members.keys()) onSpeaking(id, false);
      members.clear();
      state.channel = null;
      if (stopped) return;
      if (retryNow) { retryNow = false; return connect(); } // tombol "coba lagi" saat socket masih terbuka
      if (state.status === 'denied' || state.status === 'error') return emit(); // tunggu tombol "coba lagi"
      setStatus('off');
      schedule(5000);
    });
    send(OP.HANDSHAKE, { v: 1, client_id: clientId });
  }
  const schedule = ms => { if (!stopped && !retryTimer) retryTimer = setTimeout(connect, ms); };

  return {
    start: connect,
    // socket masih terbuka (mis. popup Authorize ditutup tanpa jawaban): putuskan dulu, lalu sambung ulang
    retry: () => {
      clearTimeout(retryTimer); retryTimer = null;
      if (sock) { retryNow = true; sock.destroy(); } else connect();
    },
    stop: () => { stopped = true; clearTimeout(retryTimer); sock?.destroy(); },
  };
}
