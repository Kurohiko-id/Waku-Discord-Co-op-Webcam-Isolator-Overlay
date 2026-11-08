// Plugin Stream Deck untuk Waku. Dua sambungan WebSocket:
//  - ke Stream Deck (port dari argumen -port): event tombol masuk, judul/status tombol keluar;
//  - ke Waku (127.0.0.1, port dari %APPDATA%\Waku\settings.json): perintah keluar, status masuk.
// Perintah dijalankan halaman kontrol Waku (sama seperti shortcut global), jadi Waku harus sedang jalan.
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const arg = name => process.argv[process.argv.indexOf('-' + name) + 1];
const UUID = 'id.kurohiko.waku';
const ACT = { preset: UUID + '.preset', template: UUID + '.template', detect: UUID + '.detect' };

// ---- pengaturan Waku (port dan bahasa), dibaca ulang tiap menyambung ----
const settingsFile = path.join(process.env.APPDATA || '', 'Waku', 'settings.json');
const wakuSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
let lang = wakuSettings().lang === 'id' ? 'id' : 'en';
const T = {
  id: { offline: 'Waku\nmati', noControl: 'Buka\nWaku', pick: 'Pilih\npreset', gone: 'Preset\ndihapus', next: 'Berikutnya', on: 'Deteksi\nNYALA', off: 'Deteksi\nMATI' },
  en: { offline: 'Waku\noff', noControl: 'Open\nWaku', pick: 'Pick a\npreset', gone: 'Preset\ndeleted', next: 'Next', on: 'Detect\nON', off: 'Detect\nOFF' },
};
const t = key => T[lang][key];

// ---- Stream Deck ----
const sd = new WebSocket('ws://127.0.0.1:' + arg('port'));
const sdSend = msg => sd.readyState === 1 && sd.send(JSON.stringify(msg));
sd.on('open', () => sdSend({ event: arg('registerEvent'), uuid: arg('pluginUUID') }));
sd.on('close', () => process.exit(0)); // Stream Deck ditutup / plugin dihentikan

const keys = new Map(); // context -> { action, settings }
let waku = null, status = { control: false, state: null }; // status terakhir dari Waku

// Teks tombol dipecah per baris supaya nama preset yang panjang tetap terbaca di tombol 72 px.
const wrap = s => s.split(' ').reduce((lines, w) => {
  const last = lines.at(-1);
  if (last && (last + ' ' + w).length <= 9) lines[lines.length - 1] = last + ' ' + w; else lines.push(w);
  return lines;
}, []).slice(0, 3).join('\n');

function title(k) {
  const st = status.state;
  if (!waku || waku.readyState !== 1) return t('offline');
  if (!status.control || !st) return t('noControl');
  if (k.action === ACT.preset) {
    if (!k.settings.presetId) return t('pick');
    const p = st.presets.find(x => x.id === k.settings.presetId);
    return p ? wrap(p.name) : t('gone');
  }
  if (k.action === ACT.template) {
    const key = k.settings.template || st.template;
    const name = st.templates.find(x => x.key === key)?.name ?? key;
    return k.settings.template ? wrap(name) : t('next') + '\n' + wrap(name);
  }
  if (k.action === ACT.detect) return st.detect ? t('on') : t('off');
  return '';
}
function refresh(context) {
  const k = keys.get(context);
  if (!k) return;
  sdSend({ event: 'setTitle', context, payload: { title: title(k), target: 0 } });
  if (k.action === ACT.detect && status.state) sdSend({ event: 'setState', context, payload: { state: status.state.detect ? 0 : 1 } });
}
const refreshAll = () => { for (const c of keys.keys()) refresh(c); };

// Isi dropdown di panel pengaturan tombol (property inspector).
const piData = context => ({ lang, connected: !!(waku?.readyState === 1 && status.control), presets: status.state?.presets ?? [], templates: status.state?.templates ?? [], settings: keys.get(context)?.settings ?? {} });
const toPi = context => sdSend({ event: 'sendToPropertyInspector', context, payload: piData(context) });
let piContext = null; // tombol yang panelnya sedang terbuka

function press(context) {
  const k = keys.get(context);
  if (!k) return;
  let action = null;
  if (k.action === ACT.preset && k.settings.presetId) action = { type: 'preset', id: k.settings.presetId };
  else if (k.action === ACT.template) action = k.settings.template ? { type: 'template', key: k.settings.template } : { type: 'template' };
  else if (k.action === ACT.detect) action = ['on', 'off'].includes(k.settings.mode) ? { type: 'detect', set: k.settings.mode } : { type: 'detect' };
  if (!action || waku?.readyState !== 1 || !status.control) return sdSend({ event: 'showAlert', context });
  waku.send(JSON.stringify({ type: 'cmd', action }));
}

sd.on('message', raw => {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  const { event, context } = m;
  if (event === 'willAppear') { keys.set(context, { action: m.action, settings: m.payload?.settings ?? {} }); refresh(context); }
  else if (event === 'willDisappear') keys.delete(context);
  else if (event === 'didReceiveSettings') {
    const k = keys.get(context);
    if (k) { k.settings = m.payload?.settings ?? {}; refresh(context); }
  } else if (event === 'keyDown') press(context);
  else if (event === 'propertyInspectorDidAppear') { piContext = context; toPi(context); }
  else if (event === 'propertyInspectorDidDisappear') { if (piContext === context) piContext = null; }
  else if (event === 'sendToPlugin') toPi(context); // panel baru siap dan minta data
});

// ---- Waku ----
function connectWaku() {
  const s = wakuSettings();
  lang = s.lang === 'id' ? 'id' : 'en';
  const port = Number(s.port) || 6966;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=deck`);
  waku = ws;
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'state') {
      status = { control: !!m.control, state: m.state ?? status.state };
      refreshAll();
      if (piContext) toPi(piContext);
    }
  });
  ws.on('error', () => {}); // Waku belum jalan: dicoba lagi lewat 'close'
  ws.on('close', () => {
    if (waku === ws) { status = { control: false, state: status.state }; refreshAll(); }
    setTimeout(connectWaku, 2000);
  });
}
connectWaku();
