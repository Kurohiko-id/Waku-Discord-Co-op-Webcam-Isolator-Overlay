const round = v => Math.round(v * 100) / 100;

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function styleToVars(st) {
  const { radius, border, shadow, speak } = st;
  const ring = border.width > 0 ? `0 0 0 ${border.width}px ${border.color}` : null;

  let drop = null;
  if (shadow.amount > 0) {
    const a = shadow.amount;
    drop = shadow.hard
      ? `${round(a * 0.25)}px ${round(a * 0.25)}px 0 ${shadow.color}`
      : `0 ${round(a * 0.2)}px ${round(a * 0.45)}px ${rgba(shadow.color, round(Math.min(0.6, a * 0.00875)))}`;
  }

  const s = speak.strength;
  const has = e => speak.effects.includes(e);
  const glow = has('glow') && s > 0 ? `0 0 ${round(s * 0.6)}px ${round(s * 0.12)}px ${speak.glowColor}` : null;

  const tf = [];
  if (has('lift') && s > 0) tf.push(`translateY(${round(-s * 0.32)}px)`);
  if (has('wiggle') && s > 0) tf.push(`rotate(${round(-s * 0.04)}deg)`);
  if (has('lift') && s > 0) tf.push(`scale(${round(1 + s * 0.0008)})`);

  const join = list => list.filter(Boolean).join(', ') || 'none';
  return {
    '--r': `${radius}px`,
    '--sh-idle': join([ring, drop]),
    '--sh-speak': join([ring, drop, glow]),
    '--sh-glow': join([glow]), // hanya cahaya bicara: dilukis sekali di ::after, lalu dimunculkan lewat opacity
    '--tf-speak': tf.join(' ') || 'none',
    '--bubble-on': has('bubble') ? '1' : '0',
    '--glow': speak.glowColor,
  };
}

export const labelPos = st => (st.label.show ? st.label.pos : null);
