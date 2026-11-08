import { RANGE, EFFECTS, POS } from '/shared/style.js';

const EFFECT_LABEL = { lift: 'Naik', wiggle: 'Goyang', glow: 'Glow', bubble: 'Gelembung' };
const POS_LABEL = { tl: 'Kiri atas', tr: 'Kanan atas', bl: 'Kiri bawah', br: 'Kanan bawah' };

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

export function createStyleForm(host, { onChange, withOverride = false }) {
  const groups = {}; // key -> { box, override }
  const range = (min, max, step = 1) => Object.assign(document.createElement('input'), { type: 'range', min, max, step });
  const color = () => Object.assign(document.createElement('input'), { type: 'color' });
  const check = () => Object.assign(document.createElement('input'), { type: 'checkbox' });
  const row = (label, input) => el('label', { className: 'sf-row' }, el('span', { textContent: label }), input);
  const vals = []; // [input, <b>, satuan] agar angka di samping label ikut berubah
  const rangeRow = (label, input, unit = '') => {
    const b = el('b');
    vals.push([input, b, unit]);
    input.addEventListener('input', () => { b.textContent = input.value + unit; });
    return el('label', { className: 'sf-row' }, el('span', {}, label, b), input);
  };
  const colorRow = (label, input) => {
    const hex = el('code');
    input.addEventListener('input', () => { hex.textContent = input.value; });
    vals.push([input, hex, '']);
    return el('label', { className: 'sf-row sf-color' }, el('span', { textContent: label }), el('span', { className: 'sf-swatch' }, input, hex));
  };

  function group(key, title, ...rows) {
    const box = el('fieldset', { className: 'sf-group' });
    const legend = el('legend');
    let override = null;
    if (withOverride) {
      override = check();
      override.className = 'sf-override';
      override.title = 'Timpa gaya umum untuk frame ini';
      override.onchange = () => onChange(key, override.checked ? '__override__' : null);
      legend.append(override, ' ', title);
    } else {
      legend.append(title);
    }
    box.dataset.key = key; // supaya panel cepat bisa menampilkan sebagian grup saja
    box.append(legend, ...rows);
    groups[key] = { box, override };
    host.append(box);
  }

  const radius = range(...RANGE.radius);
  group('radius', 'Sudut', rangeRow('Kelengkungan', radius, ' px'));
  radius.oninput = () => onChange('radius', Number(radius.value));

  const bw = range(...RANGE.borderWidth);
  const bc = color();
  group('border', 'Border', rangeRow('Tebal', bw, ' px'), colorRow('Warna', bc));
  bw.oninput = () => onChange('border', { width: Number(bw.value) });
  bc.oninput = () => onChange('border', { color: bc.value });

  const sa = range(...RANGE.shadowAmount);
  const sh = check();
  const sc = color();
  group('shadow', 'Bayangan', rangeRow('Jumlah', sa), row('Keras (tanpa blur)', sh), colorRow('Warna', sc));
  sa.oninput = () => onChange('shadow', { amount: Number(sa.value) });
  sh.onchange = () => onChange('shadow', { hard: sh.checked });
  sc.oninput = () => onChange('shadow', { color: sc.value });

  const ls = check();
  // posisi label: kisi 2x2 sudut, bukan dropdown
  const lp = el('div', { className: 'sf-corners', role: 'radiogroup' });
  const corner = {};
  for (const p of POS) {
    const b = el('button', { type: 'button', title: POS_LABEL[p], className: 'c-' + p });
    b.setAttribute('aria-label', POS_LABEL[p]);
    b.onclick = () => onChange('label', { pos: p });
    corner[p] = b;
    lp.append(b);
  }
  const lpName = el('b');
  group('label', 'Label nama', row('Tampilkan nama', ls), el('div', { className: 'sf-row sf-pos' }, el('span', {}, 'Posisi', lpName), lp));
  ls.onchange = () => onChange('label', { show: ls.checked });

  const effectBoxes = {};
  const effectRow = el('div', { className: 'sf-effects' });
  for (const e of EFFECTS) {
    const c = check();
    effectBoxes[e] = c;
    c.onchange = () => onChange('speak', { effects: EFFECTS.filter(x => effectBoxes[x].checked) });
    effectRow.append(el('label', {}, c, ' ' + EFFECT_LABEL[e]));
  }
  const st = range(...RANGE.strength);
  const gc = color();
  group('speak', 'Efek saat bicara', effectRow, rangeRow('Kekuatan', st), colorRow('Warna glow dan gelembung', gc));
  st.oninput = () => onChange('speak', { strength: Number(st.value) });
  gc.oninput = () => onChange('speak', { glowColor: gc.value });

  return {
    update(style, overridden = null) {
      radius.value = style.radius;
      bw.value = style.border.width; bc.value = style.border.color;
      sa.value = style.shadow.amount; sh.checked = style.shadow.hard; sc.value = style.shadow.color;
      ls.checked = style.label.show;
      for (const p of POS) corner[p].setAttribute('aria-pressed', String(style.label.pos === p));
      lpName.textContent = POS_LABEL[style.label.pos] ?? '';
      for (const e of EFFECTS) effectBoxes[e].checked = style.speak.effects.includes(e);
      st.value = style.speak.strength; gc.value = style.speak.glowColor;
      for (const [key, g] of Object.entries(groups)) {
        const on = overridden ? !!overridden[key] : true;
        if (g.override) g.override.checked = on;
        for (const i of g.box.querySelectorAll('input, select, button')) if (i !== g.override) i.disabled = !on;
      }
      for (const [i, b, unit] of vals) b.textContent = i.value + unit;
    },
  };
}
