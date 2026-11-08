// Preset bawaan untuk instalasi baru (dipakai server saat layout.json belum ada): 2 sampai 7 kamera dalam satu baris
// di tengah kanvas, seperti template "Satu baris (kiri ke kanan)" dengan jarak 32 px.
// "Susunan saja": saat dipakai, frame bernama DC 1, DC 2, ... dengan deteksi bicara nonaktif.
import { newSlot } from './layout.js';
import { autoLayout } from './bulk.js';

export const defaultPresets = () => [2, 3, 4, 5, 6, 7].map(n => ({
  id: 'default-p' + n,
  name: 'P' + n + '-default',
  pinned: false,
  full: false,
  slots: autoLayout(Array.from({ length: n }, (_, i) => newSlot('d' + n + '-' + (i + 1), i)), 'row', 32),
}));
