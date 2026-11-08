import { styleToVars, labelPos } from './tile-style.js';

export function updateTile(el, slot, style) {
  for (const [k, v] of Object.entries(styleToVars(style))) el.style.setProperty(k, v);
  const name = el.querySelector('.kname');
  const pos = labelPos(style);
  name.hidden = !(pos && slot.name);
  name.textContent = slot.name || '';
  name.className = 'kname ' + (pos ?? 'bl');
  el.querySelector('.kbubble').hidden = !style.speak.effects.includes('bubble');
  updateImage(el, slot);
}

// Frame virtual: gambar di dalam kotak berlatar. crop = jendela pandang dalam piksel gambar dan boleh melewati
// tepi gambar (di sana terlihat latar). Posisi dalam persen, jadi sama di editor, popup, dan OBS. GIF tetap bergerak.
export function updateImage(el, slot) {
  let box = el.querySelector('.kvirt');
  el.classList.toggle('virtual', !!slot.image);
  if (!slot.image) { box?.remove(); return; }
  if (!box) { box = virtualBox(); el.prepend(box); }
  placeImage(box, slot);
}
export function virtualBox() {
  const box = document.createElement('div');
  box.className = 'kvirt';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  box.append(img);
  return box;
}
export function placeImage(box, s) {
  const img = box.firstChild, c = s.crop;
  if (img.getAttribute('src') !== s.image) img.src = s.image;
  Object.assign(img.style, { left: (-c.x / c.w) * 100 + '%', top: (-c.y / c.h) * 100 + '%', width: (s.imgW / c.w) * 100 + '%', height: (s.imgH / c.h) * 100 + '%' });
  box.style.background = s.bg || '#000000';
}

export function buildTile(slot, style) {
  const el = document.createElement('div');
  el.className = 'ktile';
  const canvas = document.createElement('canvas');
  const name = document.createElement('span');
  name.className = 'kname';
  const bubble = document.createElement('i');
  bubble.className = 'kbubble';
  el.append(canvas, name, bubble);
  updateTile(el, slot, style);
  return { el, canvas };
}
