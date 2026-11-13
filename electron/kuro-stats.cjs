// Kuro Stats client: salin file ini ke aplikasi (Node 18+ / proses utama Electron). Tanpa dependency.
//   const stats = require('./kuro-stats.cjs')({ app: 'waku', version: app.getVersion(), dir: app.getPath('userData') });
//   stats.start();                         // install / update / ping harian otomatis
//   stats.track('preset_apply', { n: 4 });  // event bebas (jangan isi data pribadi)
//   stats.error(err);                      // laporan error, path user disamarkan
//   stats.setEnabled(false);               // matikan saat runtime (opsional)
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const ENDPOINT = 'https://dash.kurohiko.id';
const today = () => new Date().toISOString().slice(0, 10);

function osName() {
  const r = os.release();
  if (process.platform === 'win32') return Number(r.split('.')[2]) >= 22000 ? 'Windows 11' : r.startsWith('10.') ? 'Windows 10' : 'Windows ' + r;
  if (process.platform === 'darwin') return 'macOS ' + (Number(r.split('.')[0]) - 9);
  return process.platform + ' ' + r.split('-')[0];
}

// Path bisa memuat nama asli (folder user, folder pasang pilihan sendiri): sisakan nama filenya saja.
const PATH = /(?:file:\/\/\/)?[A-Za-z]:[\\/][^\n'"()<>]*?(?=[\n'"()<>]|$|:\d)/g;
const dec = t => { try { return decodeURIComponent(t); } catch { return t; } };
function scrub(s, user) {
  let out = String(s || '').replace(PATH, m => path.win32.basename(dec(m)));
  if (user) out = out.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<user>');
  return out;
}

module.exports = function kuroStats({ app, version, dir, endpoint = ENDPOINT, enabled = true, lang }) {
  const file = path.join(dir, 'kuro-stats.json');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!st.uid) st.uid = crypto.randomUUID();
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(st)); } catch {} };
  save();
  let on = enabled;
  const base = {
    app, uid: st.uid, ver: version, os: osName(), arch: process.arch,
    lang: lang || Intl.DateTimeFormat().resolvedOptions().locale,
  };
  const send = (ev, props) => on
    ? fetch(endpoint + '/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, ev, props }), signal: AbortSignal.timeout(8000) })
        .then(r => r.ok, () => false)
    : Promise.resolve(false);
  const ping = async () => { if (st.day !== today() && await send('ping')) { st.day = today(); save(); } };
  let user = ''; try { user = os.userInfo().username; } catch {}

  return {
    async start() {
      if (!on) return;
      let ok = true;
      if (!st.installed) { if (await send('install')) st.installed = 1; }
      else if (st.ver && st.ver !== version) ok = await send('update', { from: st.ver });
      if (ok) { st.ver = version; save(); } // offline: update dikirim lagi saat dibuka berikutnya
      await ping();
      setInterval(ping, 3600e3).unref(); // aplikasi yang nyala lewat tengah malam tetap terhitung di hari berikutnya
    },
    track: send,
    error: e => send('error', { msg: scrub((e && e.message) || e, user).slice(0, 300), stack: scrub(e && e.stack, user).split('\n').slice(1, 4).join('\n').slice(0, 600) }),
    setEnabled: v => { on = !!v; },
    get uid() { return st.uid; },
  };
};
module.exports.scrub = scrub;
