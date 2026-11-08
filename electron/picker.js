// Picker capture Waku: pilih jendela Discord (atau jendela/layar lain). Klik dua kali / Enter = pilih, Esc = batal.
const T = {
  id: {
    title: 'Pilih jendela untuk di-capture', hint: 'Pilih jendela Discord. Jangan di-minimize selama live (capture beku); boleh tertutup jendela lain.',
    windows: 'Jendela', screens: 'Layar', refresh: 'Muat ulang', cancel: 'Batal', ok: 'Capture', none: 'Tidak ada jendela.', recommended: 'Discord',
  },
  en: {
    title: 'Choose a window to capture', hint: 'Choose the Discord window. Don’t minimize it while live (capture freezes); other windows may cover it.',
    windows: 'Windows', screens: 'Screens', refresh: 'Refresh', cancel: 'Cancel', ok: 'Capture', none: 'No windows.', recommended: 'Discord',
  },
};
const lang = new URLSearchParams(location.search).get('lang') === 'id' ? 'id' : 'en';
document.documentElement.lang = lang;
for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[lang][el.dataset.t];

const $ = id => document.getElementById(id);
let chosen = null;

function select(btn) {
  for (const b of document.querySelectorAll('.src')) b.setAttribute('aria-pressed', String(b === btn));
  chosen = btn.dataset.id;
  $('ok').disabled = false;
}

function card(s) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'src'; b.dataset.id = s.id; b.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img');
  img.className = 'thumb'; img.alt = ''; if (s.thumb) img.src = s.thumb;
  const name = document.createElement('span');
  name.className = 'name';
  if (s.icon) { const i = document.createElement('img'); i.src = s.icon; i.alt = ''; name.append(i); }
  const label = document.createElement('span');
  label.textContent = s.name; b.title = s.name;
  name.append(label);
  if (s.discord) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = T[lang].recommended; name.append(t); }
  b.append(img, name);
  b.onclick = () => select(b);
  b.ondblclick = () => { select(b); window.picker.choose(chosen); };
  return b;
}

// Thumbnail semua jendela butuh waktu: tampilkan kartu kosong yang berkilau selama daftar dimuat.
const skeleton = n => Array.from({ length: n }, () => Object.assign(document.createElement('div'), { className: 'skel' }));
async function load() {
  $('refresh').disabled = true;
  $('windows').replaceChildren(...skeleton(4));
  $('screens').replaceChildren(...skeleton(1));
  document.querySelector('main').setAttribute('aria-busy', 'true');
  const { sources, last } = await window.picker.sources();
  document.querySelector('main').setAttribute('aria-busy', 'false');
  $('refresh').disabled = false;
  const fill = (el, list) => {
    el.replaceChildren(...list.map(card));
    if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = T[lang].none; el.append(p); }
  };
  fill($('windows'), sources.filter(s => !s.screen));
  fill($('screens'), sources.filter(s => s.screen));
  // pilihan terakhir (id sama, atau nama sama setelah Discord dibuka ulang), kalau tidak ada: jendela Discord pertama
  const pick = sources.find(s => s.id === last?.id) ?? sources.find(s => s.name === last?.name) ?? sources.find(s => s.discord);
  const btn = pick && document.querySelector(`.src[data-id="${CSS.escape(pick.id)}"]`);
  if (btn) { select(btn); btn.focus(); } else { chosen = null; $('ok').disabled = true; }
}

$('ok').onclick = () => chosen && window.picker.choose(chosen);
$('cancel').onclick = () => window.picker.choose(null);
$('refresh').onclick = load;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.picker.choose(null);
  else if (e.key === 'Enter' && chosen && !e.target.closest?.('#cancel, #refresh')) { e.preventDefault(); window.picker.choose(chosen); }
});
load();
