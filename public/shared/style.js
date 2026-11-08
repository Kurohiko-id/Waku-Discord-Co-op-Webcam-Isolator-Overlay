export const RANGE = { radius: [0, 60], borderWidth: [0, 16], shadowAmount: [0, 100], strength: [0, 100] };
export const EFFECTS = ['lift', 'wiggle', 'glow', 'bubble'];
export const POS = ['tl', 'tr', 'bl', 'br'];
const HEX = /^#[0-9a-f]{6}$/i;
const num = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const color = v => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);

export const TEMPLATES = {
  'sticker-night': {
    name: 'Sticker Night',
    style: {
      radius: 20,
      border: { width: 5, color: '#ffffff' },
      shadow: { amount: 40, hard: false, color: '#1f2347' },
      label: { show: false, pos: 'bl' },
      speak: { effects: ['lift', 'wiggle', 'bubble'], strength: 50, glowColor: '#3ddc97' },
    },
  },
  polos: {
    name: 'Polos',
    style: {
      radius: 0,
      border: { width: 0, color: '#ffffff' },
      shadow: { amount: 0, hard: false, color: '#000000' },
      label: { show: false, pos: 'bl' },
      speak: { effects: ['lift'], strength: 30, glowColor: '#3ddc97' },
    },
  },
  neobrutalism: {
    name: 'Neobrutalism',
    style: {
      radius: 0,
      border: { width: 4, color: '#000000' },
      shadow: { amount: 40, hard: true, color: '#000000' },
      label: { show: true, pos: 'tl' },
      speak: { effects: ['lift'], strength: 40, glowColor: '#3ddc97' },
    },
  },
  neon: {
    name: 'Neon',
    style: {
      radius: 14,
      border: { width: 2, color: '#a78bfa' },
      shadow: { amount: 0, hard: false, color: '#000000' },
      label: { show: true, pos: 'bl' },
      speak: { effects: ['glow', 'lift'], strength: 60, glowColor: '#a78bfa' },
    },
  },
};
export const DEFAULT_TEMPLATE = 'sticker-night';
export const defaultStyle = () => structuredClone(TEMPLATES[DEFAULT_TEMPLATE].style);

// Hanya kunci valid yang dikembalikan; sisanya dibuang (mewarisi).
export function validatePartialStyle(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (num(raw.radius)) out.radius = clamp(raw.radius, RANGE.radius);

  const b = raw.border;
  if (b && typeof b === 'object') {
    const g = {};
    if (num(b.width)) g.width = clamp(b.width, RANGE.borderWidth);
    if (color(b.color)) g.color = color(b.color);
    if (Object.keys(g).length) out.border = g;
  }
  const sh = raw.shadow;
  if (sh && typeof sh === 'object') {
    const g = {};
    if (num(sh.amount)) g.amount = clamp(sh.amount, RANGE.shadowAmount);
    if (typeof sh.hard === 'boolean') g.hard = sh.hard;
    if (color(sh.color)) g.color = color(sh.color);
    if (Object.keys(g).length) out.shadow = g;
  }
  const lb = raw.label;
  if (lb && typeof lb === 'object') {
    const g = {};
    if (typeof lb.show === 'boolean') g.show = lb.show;
    if (POS.includes(lb.pos)) g.pos = lb.pos;
    if (Object.keys(g).length) out.label = g;
  }
  const sp = raw.speak;
  if (sp && typeof sp === 'object') {
    const g = {};
    if (Array.isArray(sp.effects)) g.effects = [...new Set(sp.effects.filter(e => EFFECTS.includes(e)))].slice(0, 4);
    if (num(sp.strength)) g.strength = clamp(sp.strength, RANGE.strength);
    if (color(sp.glowColor)) g.glowColor = color(sp.glowColor);
    if (Object.keys(g).length) out.speak = g;
  }
  return out;
}

export function mergeStyle(base, over = {}) {
  return {
    radius: over.radius ?? base.radius,
    border: { ...base.border, ...over.border },
    shadow: { ...base.shadow, ...over.shadow },
    label: { ...base.label, ...over.label },
    speak: { ...base.speak, ...over.speak, effects: [...(over.speak?.effects ?? base.speak.effects)] },
  };
}

export const validateStyle = raw => mergeStyle(defaultStyle(), validatePartialStyle(raw));
export const resolveStyle = (layoutStyle, slotStyle) => mergeStyle(layoutStyle, slotStyle ?? {});
