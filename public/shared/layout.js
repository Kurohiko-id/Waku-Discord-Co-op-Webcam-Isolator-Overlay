import { validateStyle, validatePartialStyle, TEMPLATES, DEFAULT_TEMPLATE } from './style.js';
import { clampRect, ratioHeight } from './geometry.js';

const MAX_SLOTS = 16;
export const FPS_CHOICES = [15, 24, 30, 60];
const DEFAULT_GREEN_MIN = 0.02; // outline Discord yang asli tipis: hanya ~3% kotak deteksi yang hijau
const num = v => Number.isFinite(v);
// ukuran frame capture (px) tempat crop dibuat; 0 = belum diketahui (layout lama)
const frameSize = v => (num(v) && v >= 16 && v <= 16384 ? Math.round(v) : 0);

function rect(r) {
  return r && num(r.x) && num(r.y) && num(r.w) && num(r.h) && r.w > 0 && r.h > 0
    ? { x: r.x, y: r.y, w: r.w, h: r.h }
    : null;
}

// Kotak deteksi hijau: kecil, di sudut kiri atas crop (melintasi tepi, tempat outline Discord biasanya muncul).
export const defaultProbe = crop => ({ x: crop.x - 16, y: crop.y - 16, w: 32, h: 32 }); // kotak deteksi di sudut kiri atas crop

// Guide buatan pengguna (garis bantu dari penggaris): hanya angka valid dalam kanvas, dibulatkan, unik, maks 20 per sumbu.
function validateGuides(g) {
  const pick = (arr, max) => [...new Set((Array.isArray(arr) ? arr : [])
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max)
    .map(Math.round))].sort((a, b) => a - b).slice(0, 20);
  return { x: pick(g?.x, 1920), y: pick(g?.y, 1080) };
}

const IMAGE_PATH = /^[/]uploads[/][a-f0-9]{16}[.](png|jpg|gif|webp)$/;
const virtualImage = s => typeof s.image === 'string' && IMAGE_PATH.test(s.image) && num(s.imgW) && s.imgW > 0 && num(s.imgH) && s.imgH > 0;

// Daftar slot yang valid, atau null bila ada yang rusak, id kembar, atau terlalu banyak.
function validateSlots(list) {
  if (!Array.isArray(list) || list.length > MAX_SLOTS) return null;
  const slots = [];
  for (const s of list) {
    const crop = rect(s?.crop);
    const place = rect(s?.place);
    if (!crop || !place || typeof s.id !== 'string' || !s.id) return null;
    slots.push({
      id: s.id,
      name: typeof s.name === 'string' ? s.name.slice(0, 40) : '',
      crop, baseCrop: rect(s.baseCrop) ?? crop, // baseCrop = crop terakhir dari popup; tombol reset tile kembali ke sini
      cropLocked: !!s.cropLocked, ratioLocked: s.ratioLocked !== false,
      probe: rect(s.probe) ?? defaultProbe(crop), detect: s.detect !== false,
      discordId: typeof s.discordId === 'string' && /^[0-9]{5,25}$/.test(s.discordId) ? s.discordId : '', // '' = kotak hijau
      discordName: typeof s.discordName === 'string' ? s.discordName.slice(0, 40) : '',
      // frame virtual: gambar unggahan (bukan capture) dengan ukuran aslinya; crop memakai piksel gambar
      ...(virtualImage(s) ? { image: s.image, imgW: s.imgW, imgH: s.imgH } : { image: '', imgW: 0, imgH: 0 }),
      bg: s.bg === 'transparent' || (typeof s.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.bg)) ? s.bg : '#000000', // latar frame virtual
      place, placeLocked: !!s.placeLocked,
      enabled: s.enabled !== false,
      style: validatePartialStyle(s.style),
    });
  }
  return new Set(slots.map(s => s.id)).size === slots.length ? slots : null;
}

// Preset = susunan lengkap slot (crop, deteksi, posisi tile, gaya) yang bisa dipanggil lagi, mis. "Duo atas-bawah".
function validatePresets(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const slots = validateSlots(p?.slots);
    if (!slots?.length || typeof p.id !== 'string' || !p.id) continue;
    out.push({
      id: p.id, name: typeof p.name === 'string' ? p.name.slice(0, 40) : '', slots,
      pinned: !!p.pinned, // disematkan: tampil sebagai tombol di bawah kanvas (sisanya di menu Lainnya)
      full: p.full !== false, // nama frame & akun Discord ikut tersimpan; preset lama selalu begitu
      frameW: frameSize(p.frameW), frameH: frameSize(p.frameH), // ukuran capture saat preset disimpan
    });
    if (out.length >= 20) break;
  }
  return out;
}

// Daftar virtual frame tersimpan: frame dari gambar yang pernah dipakai tetap ada walau dihapus dari kanvas.
const MAX_LIBRARY = 50;
function validateLibrary(list) {
  const out = [], ids = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    const s = validateSlots([e])?.[0];
    if (!s?.image || ids.has(s.id)) continue;
    ids.add(s.id);
    out.push(s);
    if (out.length >= MAX_LIBRARY) break;
  }
  return out;
}

// Semua virtual frame yang dikenal, satu per id: dari daftar, preset, dan kanvas (data kanvas paling baru).
// canvas: 'on' (tampil) | 'off' (tersembunyi) | null; presets = jumlah preset yang menyimpannya; saved = ada di daftar.
export function virtualLibrary({ slots = [], library = [], presets = [] }) {
  const m = new Map();
  const at = s => { if (!m.has(s.id)) m.set(s.id, { slot: s, saved: false, canvas: null, presets: 0 }); return m.get(s.id); };
  for (const s of library) at(s).saved = true;
  for (const p of presets) for (const s of p.slots) if (s.image) at(s).presets++;
  for (const s of slots) if (s.image) Object.assign(at(s), { slot: s, canvas: s.enabled ? 'on' : 'off' });
  return [...m.values()];
}

// Simpan atau perbarui virtual frame di daftar (paling baru di depan). Slot asal tidak diubah.
export const rememberVirtual = (library, s) => (s?.image
  ? [{ ...structuredClone(s), enabled: true }, ...library.filter(x => x.id !== s.id)].slice(0, MAX_LIBRARY)
  : library);

// Hapus permanen: dari daftar dan dari semua preset; preset yang jadi kosong ikut hilang.
export const forgetVirtual = ({ library, presets }, id) => ({
  library: library.filter(x => x.id !== id),
  presets: presets.map(p => ({ ...p, slots: p.slots.filter(s => s.id !== id) })).filter(p => p.slots.length),
});

// Virtual frame tanpa sumber bicara (mis. dari preset "susunan saja") memakai sumber yang diingat daftar.
export const withVirtualSources = (slots, library) => slots.map(s => {
  if (!s.image || s.discordId) return s;
  const k = library.find(x => x.id === s.id && x.discordId);
  return k ? { ...s, discordId: k.discordId, discordName: k.discordName, detect: true } : s;
});

// Urutan tombol preset: yang disematkan dulu, lalu urutan simpanan (bisa diubah dengan drag). Tidak bergeser karena dipakai.
export const presetOrder = presets => [...presets].sort((a, b) => b.pinned - a.pinned);

// Isi preset dari slot sekarang. full = nama frame dan akun Discord ikut; tanpa itu hanya susunan
// (crop, posisi, gaya; frame virtual tetap dengan gambar dan namanya). Slot asal tidak diubah.
export function presetSlots(slots, full) {
  const copy = structuredClone(slots);
  return full ? copy : copy.map(s => ({ ...s, discordId: '', discordName: '', ...(s.image ? {} : { name: '', detect: false }) }));
}

// Slot hasil menerapkan preset. Dengan identitas: frame Discord yang tidak ada di preset ikut dibawa (nonaktif).
// Tanpa identitas: mulai kosong, frame kamera bernama DC 1..n dengan deteksi nonaktif.
export function applyPresetSlots(preset, current) {
  const next = presetSlots(preset.slots, preset.full);
  if (preset.full) return carryDiscordSlots(current, next);
  const out = [];
  for (const s of next) out.push(s.image ? s : { ...s, name: nextSlotName(out) });
  return out;
}

// Ganti preset: frame yang terikat akun Discord tapi tidak ada di preset tetap dibawa (nonaktif),
// supaya tinggal diaktifkan lagi tanpa mengatur ulang sumber bicaranya.
export function carryDiscordSlots(current, next) {
  const ids = new Set(next.map(s => s.id)), users = new Set(next.map(s => s.discordId).filter(Boolean));
  const out = [...next];
  for (const s of current) {
    if (out.length >= MAX_SLOTS) break;
    if (!s.discordId || ids.has(s.id) || users.has(s.discordId)) continue;
    out.push({ ...s, enabled: false });
    users.add(s.discordId);
  }
  return out;
}

// Simpan popup crop: slot hasil popup (draft) digabung ke slot sekarang. Slot lama hanya ditimpa bidang
// yang diatur di popup, supaya gaya dan posisi tile tidak hilang; frame virtual diatur di popup lain, jadi tetap.
// Crop dijepit ke frame capture, tinggi tile mengikuti rasio crop. Slot asal tidak diubah.
const CROP_FIELDS = ['name', 'enabled', 'detect', 'ratioLocked', 'cropLocked', 'discordId', 'discordName'];
export function mergeDraft(current, draftSlots, frame, canvas = { w: 1920, h: 1080 }) {
  return draftSlots.map(d => {
    const orig = current.find(s => s.id === d.id);
    if (d.image) return orig ?? d;
    const crop = clampRect(d.crop, frame);
    const t = { ...(orig ?? d), ...Object.fromEntries(CROP_FIELDS.map(k => [k, d[k]])), crop, baseCrop: { ...crop }, probe: clampRect(d.probe, frame) };
    t.place = clampRect({ ...t.place, h: ratioHeight(t.place.w, crop) }, canvas);
    return t;
  });
}

// Ukuran frame capture berubah (mis. jendela Discord pindah ke monitor beresolusi lain): crop, baseCrop, dan kotak deteksi
// ikut diskalakan selama rasionya sama, karena Discord menskalakan isinya. Rasio berbeda (isi Discord tersusun ulang),
// ukuran sama, atau ukuran lama tidak diketahui: slot dikembalikan apa adanya. Frame virtual tidak bergantung capture.
export function rescaleSlots(slots, from, to) {
  if (!from?.w || !from?.h || !to?.w || !to?.h || (from.w === to.w && from.h === to.h)) return slots;
  if (Math.abs(from.w / from.h - to.w / to.h) > 0.01 * (to.w / to.h)) return slots;
  const k = to.w / from.w;
  const sc = r => ({ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
  return slots.map(s => (s.image ? s : { ...s, crop: sc(s.crop), baseCrop: sc(s.baseCrop ?? s.crop), probe: sc(s.probe) }));
}

export function validateLayout(l) {
  const slots = validateSlots(l?.slots);
  if (!slots) return null;
  const g = l.settings?.greenMin;
  return {
    slots,
    settings: {
      animate: l.settings?.animate !== false,
      detectEnabled: l.settings?.detectEnabled !== false,
      greenMin: num(g) ? Math.min(1, Math.max(0.005, g)) : DEFAULT_GREEN_MIN,
      // video ke OBS: bitrate maksimum encoder (Mbps) dan frame per detik capture
      bitrate: num(l.settings?.bitrate) ? Math.min(20, Math.max(2, Math.round(l.settings.bitrate))) : 8,
      fps: FPS_CHOICES.includes(l.settings?.fps) ? l.settings.fps : 30,
      frameW: frameSize(l.settings?.frameW), frameH: frameSize(l.settings?.frameH), // ukuran capture tempat crop dibuat
    },
    style: validateStyle(l.style),
    template: TEMPLATES[l.template] ? l.template : l.style ? '' : DEFAULT_TEMPLATE,
    guides: validateGuides(l.guides),
    presets: validatePresets(l.presets),
    library: validateLibrary(l.library),
  };
}

// crop 16:9 di frame Discord, place 16:9 di kanvas 1920x1080 (grid 4 kolom)
export function newSlot(id, index) {
  const col = index % 4, row = Math.floor(index / 4);
  const crop = { x: 40 + col * 20, y: 40 + col * 20, w: 480, h: 270 };
  return {
    id, name: '',
    crop, cropLocked: false, ratioLocked: true,
    probe: defaultProbe(crop), detect: false, // deteksi bicara dipilih sendiri: Manual atau Official
    discordId: '', discordName: '', image: '', imgW: 0, imgH: 0,
    place: { x: col * 480 + 16, y: row * 270 + 16, w: 448, h: 252 }, placeLocked: false,
    enabled: true,
    style: {},
  };
}

// Nama otomatis untuk slot baru: "DC 1", "DC 2", ... memakai nomor terkecil yang belum dipakai.
export function nextSlotName(slots) {
  const used = new Set(slots.map(s => s.name));
  let n = 1;
  while (used.has('DC ' + n)) n++;
  return 'DC ' + n;
}

// Slot baru dengan ukuran (crop dan tile) disalin dari slot lain; posisi mengikuti grid.
export function newSlotFrom(id, index, src) {
  const s = newSlot(id, index);
  s.crop.w = src.crop.w; s.crop.h = src.crop.h;
  s.place.w = src.place.w; s.place.h = src.place.h;
  return s;
}
