// Hijau outline Discord ≈ rgb(59,165,93). Aturan longgar supaya tahan kompresi/skala.
export function isGreen(r, g, b) {
  return g > 120 && g > r * 1.4 && g > b * 1.2;
}

export function greenFraction(...strips) {
  let green = 0, total = 0;
  for (const s of strips) {
    for (let i = 0; i + 2 < s.length; i += 4) {
      total++;
      if (isGreen(s[i], s[i + 1], s[i + 2])) green++;
    }
  }
  return total ? green / total : 0;
}

export function createDebouncer(onFrames = 2, offFrames = 3) {
  let state = false, run = 0;
  return raw => {
    if (raw === state) { run = 0; return state; }
    run++;
    if (run >= (raw ? onFrames : offFrames)) { state = raw; run = 0; }
    return state;
  };
}
