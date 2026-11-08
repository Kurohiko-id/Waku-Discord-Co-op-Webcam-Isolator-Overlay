// Area HUD game di kanvas 1920x1080: hanya panduan visual di editor (tidak dikirim ke OBS).
// Valorant: diukur dari screenshot 1920x1080 dengan HUD bawaan. Kill feed, chat, dan pengumuman tidak tampil
// di screenshot itu, jadi masih perkiraan.
export const SAFE_ZONES = {
  valorant: {
    name: 'Valorant',
    zones: [
      { label: 'Minimap', x: 15, y: 15, w: 470, h: 495 }, // termasuk nama area ("A Site") di atasnya
      { label: 'Skor & ronde', x: 395, y: 12, w: 1140, h: 128 }, // dua bar tim + timer + panah di bawahnya
      { label: 'Pengumuman', x: 610, y: 150, w: 700, h: 100 }, // perkiraan
      { label: 'Kill feed', x: 1545, y: 70, w: 370, h: 230 }, // perkiraan
      { label: 'Aim', x: 920, y: 500, w: 80, h: 80 },
      { label: 'Chat', x: 15, y: 660, w: 520, h: 220 }, // perkiraan
      { label: 'Info skill', x: 740, y: 855, w: 440, h: 115 }, // slot skill aktif + bar
      { label: 'HP', x: 535, y: 985, w: 200, h: 80 },
      { label: 'Skill & ult', x: 740, y: 970, w: 440, h: 110 },
      { label: 'Ammo', x: 1185, y: 985, w: 205, h: 80 },
      { label: 'Daftar senjata', x: 1690, y: 710, w: 220, h: 205 },
      { label: 'Kredit', x: 1690, y: 1025, w: 225, h: 55 },
    ],
  },
};
