// Export/import preset sebagai file JSON. Gambar virtual frame disematkan sebagai data URI, jadi satu file sudah cukup.
import { validateLayout } from './layout.js';

export const FILE_TYPE = 'waku-presets';
const IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_DATA = 12 * 1024 * 1024; // data URI gambar 8 MB (batas unggah) setelah base64

// Isi file export. names: nama baru per id preset (ganti nama saat export, preset asli tidak berubah).
// Tanpa includeAccounts, akun Discord dibuang (akun teman tidak berguna di PC orang lain). images: url -> data URI.
export function buildExport(presets, { names = {}, includeAccounts = false, images = {} } = {}) {
  return {
    type: FILE_TYPE,
    version: 1,
    presets: presets.map(p => ({
      name: String(names[p.id] ?? p.name).trim().slice(0, 40) || 'Preset',
      full: p.full,
      frameW: p.frameW, frameH: p.frameH,
      slots: includeAccounts ? p.slots : p.slots.map(s => ({ ...s, discordId: '', discordName: '' })),
    })),
    images,
  };
}

// Baca file import. Preset divalidasi sama seperti layout biasa; gambar hanya data URI gambar.
// Gagal: Error dengan pesan untuk pengguna.
export function parseImport(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('Isinya bukan JSON yang valid.'); }
  if (j?.type !== FILE_TYPE || !Array.isArray(j.presets)) throw new Error('Isinya bukan preset Waku.');
  const presets = validateLayout({ slots: [], presets: j.presets.map((p, i) => ({ ...p, id: 'import-' + i, pinned: false })) }).presets;
  if (!presets.length) throw new Error('Tidak ada preset yang bisa dibaca.');
  const images = {};
  for (const [url, data] of Object.entries(j.images && typeof j.images === 'object' ? j.images : {})) {
    if (typeof data === 'string' && data.length <= MAX_IMAGE_DATA && IMAGE_DATA.test(data)) images[url] = data;
  }
  return { presets, images };
}

// Nama yang belum dipakai: "P5" bentrok -> "P5 v2", lalu "P5 v3", ... ("P5 v2" yang bentrok jadi "P5 v3", bukan "P5 v2 v2").
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const base = name.replace(/ v\d+$/, '').slice(0, 34);
  let n = 2;
  while (taken.has(base + ' v' + n)) n++;
  return base + ' v' + n;
}
