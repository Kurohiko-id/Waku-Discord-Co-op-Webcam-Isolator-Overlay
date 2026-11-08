// Panel pengaturan tombol (property inspector) di aplikasi Stream Deck. Satu skrip untuk ketiga aksi:
// halaman HTML menentukan <select id="pick" data-key="..."> dan jenis isinya lewat data-kind.
const TXT = {
  id: {
    preset: 'Preset', template: 'Template', mode: 'Aksi', next: 'Template berikutnya', choose: 'Pilih preset...',
    toggle: 'Nyala/mati bergantian', on: 'Selalu nyalakan', off: 'Selalu matikan',
    offline: 'Waku belum jalan atau halaman kontrolnya tertutup. Buka Waku, daftar akan terisi sendiri.',
    empty: 'Belum ada preset. Simpan preset di Waku dulu.',
  },
  en: {
    preset: 'Preset', template: 'Template', mode: 'Action', next: 'Next template', choose: 'Choose a preset...',
    toggle: 'Toggle on/off', on: 'Always turn on', off: 'Always turn off',
    offline: 'Waku is not running or its control page is closed. Open Waku and the list fills in by itself.',
    empty: 'No presets yet. Save a preset in Waku first.',
  },
};
const pick = document.getElementById('pick');
const kind = pick.dataset.kind; // preset | template | detect
let sock, piUuid, action, settings = {};

function render(d) {
  const tx = TXT[d.lang] ?? TXT.en;
  settings = d.settings ?? settings;
  document.getElementById('label').textContent = tx[kind === 'detect' ? 'mode' : kind];
  let opts;
  if (kind === 'preset') opts = [['', tx.choose], ...d.presets.map(p => [p.id, p.name])];
  else if (kind === 'template') opts = [['', tx.next], ...d.templates.map(x => [x.key, x.name])];
  else opts = [['toggle', tx.toggle], ['on', tx.on], ['off', tx.off]];
  const cur = settings[pick.dataset.key] ?? opts[0][0];
  // Pilihan tersimpan yang tidak ada lagi di Waku tetap ditampilkan supaya tidak diam-diam berganti.
  if (!opts.some(([v]) => v === cur)) opts.push([cur, cur]);
  pick.replaceChildren(...opts.map(([v, text]) => new Option(text, v)));
  pick.value = cur;
  const note = !d.connected ? tx.offline : kind === 'preset' && !d.presets.length ? tx.empty : '';
  document.getElementById('note').textContent = note;
}

pick.onchange = () => {
  settings = { ...settings, [pick.dataset.key]: pick.value };
  sock.send(JSON.stringify({ event: 'setSettings', context: piUuid, payload: settings }));
};

// Dipanggil aplikasi Stream Deck setelah halaman dimuat.
window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
  piUuid = uuid;
  const ai = JSON.parse(actionInfo);
  action = ai.action;
  settings = ai.payload?.settings ?? {};
  sock = new WebSocket('ws://127.0.0.1:' + port);
  sock.onopen = () => {
    sock.send(JSON.stringify({ event: registerEvent, uuid }));
    sock.send(JSON.stringify({ event: 'sendToPlugin', action, context: uuid, payload: { type: 'hello' } })); // minta daftar preset/template
  };
  sock.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.event === 'sendToPropertyInspector') render(m.payload);
  };
};
