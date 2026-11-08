// Posisi jendela popup tanpa import electron (bisa dites di Node).
// box: jendela induk (atau area kerja bila induk tersembunyi); area: area kerja monitor tempat box berada.
// Popup di tengah box, ukurannya tidak melebihi area, dan seluruhnya tetap di dalam area.
export function centerIn(box, area, width, height) {
  const w = Math.min(width, area.width), h = Math.min(height, area.height);
  const x = Math.min(Math.max(box.x + (box.width - w) / 2, area.x), area.x + area.width - w);
  const y = Math.min(Math.max(box.y + (box.height - h) / 2, area.y), area.y + area.height - h);
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}
