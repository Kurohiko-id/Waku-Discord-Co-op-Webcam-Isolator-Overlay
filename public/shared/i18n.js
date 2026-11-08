// Ganti bahasa ID/EN tanpa reload (reload mematikan capture).
// Teks sumber tetap bahasa Indonesia di HTML/JS; kamus ini memetakan teks ID -> EN.
// MutationObserver menerjemahkan setiap teks yang muncul atau diubah JS, jadi kode UI tidak perlu memanggil t().
// Teks asli (ID) tiap node disimpan, supaya bisa bolak-balik ID <-> EN kapan saja.
// Teks yang tidak ada di kamus tampil apa adanya (ID); test/i18n.test.js menjaga teks halaman kontrol tetap tercakup.

const EN = {
  // bar atas & status
  'Layout': 'Layout', 'Server': 'Server', 'mati': 'off', 'nyala': 'on', 'Deteksi': 'Detection',
  'terhubung': 'connected', 'terputus': 'disconnected',
  'tab lain aktif': 'another tab is active', 'diambil alih tab lain': 'taken over by another tab', 'klik untuk ambil alih': 'click to take over',
  'Salin link preview': 'Copy preview link', 'Tersalin': 'Copied', 'Gagal menyalin, salin manual': 'Copy failed, copy it manually',
  'Koneksi halaman ini ke server lokal. Kalau terputus, perubahan tidak sampai ke OBS dan tidak tersimpan.': 'This page’s connection to the local server. If it drops, changes don’t reach OBS and aren’t saved.',
  'Capture jendela Discord. Kalau mati, OBS tidak menerima video.': 'Capture of the Discord window. When off, OBS receives no video.',
  'Status bicara langsung dari aplikasi Discord di PC ini.': 'Speaking status straight from the Discord app on this PC.',
  'Deteksi bicara untuk semua frame. Klik untuk menyalakan atau mematikan.': 'Speaking detection for all frames. Click to turn on or off.',
  'Jeda pratinjau': 'Pause preview', 'Lanjutkan pratinjau': 'Resume preview',
  'Jeda pratinjau: hemat resource, berhenti menggambar ulang tile di kanvas': 'Pause preview: saves resources by not redrawing tiles on the canvas',
  'Jeda pratinjau: hemat resource, berhenti menggambar ulang tile di kanvas. Stream ke OBS dan deteksi bicara tetap jalan. Menggambar ulang juga berhenti sendiri saat tab ini tersembunyi.': 'Pause preview: saves resources by not redrawing tiles on the canvas. The stream to OBS and speaking detection keep running. Redrawing also stops by itself while this tab is hidden.',
  'Waku sedang dibuka di tab lain': 'Waku is open in another tab', 'Pakai tab ini': 'Use this tab',
  'Tab ini tidak tersambung, jadi layout tidak dimuat dan perubahan tidak tersimpan. Tutup tab lain, atau pakai tab ini (capture di tab lain akan berhenti).': 'This tab is not connected, so the layout isn’t loaded and changes aren’t saved. Close the other tab, or use this one (capture in the other tab will stop).',
  'Tab lain mengambil alih dan capture di tab ini dihentikan. Pakai tab ini lagi bila perlu.': 'Another tab took over and capture in this tab was stopped. Use this tab again if needed.',
  'Bahasa / Language': 'Language / Bahasa',

  // rail & drawer
  'Tema': 'Theme', 'Massal': 'Bulk', 'Atur': 'Settings', 'Umum': 'General',
  'Pengaturan': 'Settings', 'Tema & gaya': 'Theme & style', 'Frame terpilih': 'Selected frame', 'Template & preset': 'Templates & presets', 'Aksi massal': 'Bulk actions',
  'Lipat atau buka panel': 'Collapse or expand panel', 'Lipat / buka panel': 'Collapse / expand panel',

  // tab Tema
  'Theme Template': 'Theme template', 'Pilih template...': 'Choose a template...', 'Coba efek bicara': 'Try speaking effect',
  'Frame terpilih berpura-pura bicara 2 detik di kanvas dan /preview, tanpa Discord dan tanpa deteksi': 'The selected frame pretends to speak for 2 seconds on the canvas and /preview, without Discord or detection',
  'Tambah frame dulu untuk mencoba efek': 'Add a frame first to try the effect',
  'Polos': 'Plain',

  // style-form
  'Naik': 'Rise', 'Goyang': 'Shake', 'Gelembung': 'Bubbles',
  'Kiri atas': 'Top left', 'Kanan atas': 'Top right', 'Kiri bawah': 'Bottom left', 'Kanan bawah': 'Bottom right',
  'Timpa gaya umum untuk frame ini': 'Override the general style for this frame', 'Timpa': 'Override',
  'Sudut': 'Corners', 'Kelengkungan': 'Roundness', 'Tebal': 'Width', 'Warna': 'Color',
  'Bayangan': 'Shadow', 'Jumlah': 'Amount', 'Keras (tanpa blur)': 'Hard (no blur)', 'Label nama': 'Name label',
  'Tampilkan nama': 'Show name', 'Posisi': 'Position', 'Efek saat bicara': 'Speaking effect', 'Kekuatan': 'Strength',
  'Warna glow dan gelembung': 'Glow and bubble color',

  // tab Frame
  'Klik tile di kanvas untuk memilih frame.': 'Click a tile on the canvas to select a frame.',
  'Nama': 'Name', 'Juga dipakai sebagai label di tile': 'Also used as the label on the tile',
  'Kunci resize tile': 'Lock tile resize', 'Aktif': 'Enabled', 'aktif': 'on',
  'Gaya frame (timpa umum)': 'Frame style (overrides general)', 'Kembalikan semua ke umum': 'Reset all to general',
  'Deteksi bicara (Discord dan kotak hijau)': 'Speaking detection (Discord and green box)', 'Animasi saat bicara': 'Speaking animation',
  'Ambang hijau': 'Green threshold', 'Ambang': 'Threshold',

  // tab Preset
  'Template otomatis': 'Auto templates', 'Susunan': 'Arrangement', 'Pilih susunan...': 'Choose an arrangement...',
  'Grid rata': 'Even grid', 'Satu baris (kiri ke kanan)': 'One row (left to right)', 'Satu kolom (atas ke bawah)': 'One column (top to bottom)',
  'Satu besar, sisanya di kanan': 'One large, the rest on the right', 'Satu besar, sisanya di bawah': 'One large, the rest below',
  'Rata bawah (satu baris)': 'Bottom aligned (one row)', 'Rata atas (satu baris)': 'Top aligned (one row)', 'Kiri-kanan (setengah-setengah)': 'Left-right (half and half)',
  'Jarak': 'Gap', 'Urungkan template': 'Undo template',
  'Menata ulang posisi dan ukuran semua tile aktif. Crop tidak berubah.': 'Rearranges the position and size of all active tiles. Crops are unchanged.',
  'Preset layout': 'Layout presets', 'Nama preset': 'Preset name', 'mis. Duo atas-bawah': 'e.g. Duo top-bottom',
  'Simpan susunan sekarang': 'Save current arrangement', 'Urungkan terapkan preset': 'Undo apply preset',
  'Terapkan': 'Apply', 'Hapus': 'Delete', 'Klik lagi': 'Click again', 'Belum ada preset.': 'No presets yet.', 'Belum ada preset': 'No presets yet',
  'Tanpa nama': 'Untitled',
  'Lepas sematan: pindah ke menu Lainnya': 'Unpin: move to the More menu', 'Sematkan: tampil sebagai tombol di bawah kanvas': 'Pin: show as a button below the canvas',
  'Lainnya ▾': 'More ▾', 'Pilih preset ▾': 'Choose preset ▾', 'Preset lainnya': 'More presets',
  'Sematkan preset supaya tampil sebagai tombol di bawah kanvas. Tarik untuk mengubah urutan.': 'Pin a preset to show it as a button below the canvas. Drag to reorder.',
  'Tarik untuk mengubah urutan': 'Drag to reorder', 'dengan akun': 'with accounts', 'Nama frame dan akun Discord ikut tersimpan': 'Frame names and Discord accounts are saved too', 'Hanya susunan; saat dipakai, frame jadi DC 1, DC 2, ...': 'Arrangement only; when applied, frames become DC 1, DC 2, ...', 'susunan saja': 'arrangement only',
  'Klik lagi untuk menimpa': 'Click again to overwrite',
  'Simpan juga nama frame & akun Discord': 'Also save frame names & Discord accounts',
  'Nyalakan untuk teman mabar tetap: nama frame dan akun Discord (deteksi Official) ikut tersimpan. Matikan untuk susunan umum: saat dipakai, frame mulai kosong (DC 1, DC 2, ...) dengan deteksi nonaktif.': 'Turn on for your regular squad: frame names and Discord accounts (Official detection) are saved too. Turn off for a general arrangement: when applied, frames start empty (DC 1, DC 2, ...) with detection off.',
  'Preset yang disematkan (ikon pin) tampil sebagai tombol di bawah kanvas; sisanya di menu': 'Pinned presets (pin icon) show as buttons below the canvas; the rest are in the', 'Lainnya': 'More',
  '. Tarik tombol atau baris preset untuk mengubah urutan.': ' menu. Drag a button or preset row to reorder.',
  'Centang': 'Check', 'untuk teman mabar tetap. Tanpa centang, preset hanya menyimpan susunan.': 'for your regular squad. Unchecked, a preset saves only the arrangement.',
  'Belum ada frame untuk disimpan': 'No frames to save yet', 'Preset diperbarui': 'Preset updated', 'Maksimal 20 preset': 'Maximum 20 presets', 'Preset disimpan': 'Preset saved',

  // tab Massal
  'Lebar tile': 'Tile width', 'Rasio crop': 'Crop ratio', 'Jangan ubah': 'Don’t change', 'Kolom grid': 'Grid columns', 'Urungkan aksi massal': 'Undo bulk action',

  // tab Atur
  'Video ke OBS': 'Video to OBS',
  'Bitrate 8 Mbps dan 30 fps sudah cukup, kecuali PC kamu high-end.': '8 Mbps and 30 fps are enough unless your PC is high-end.',
  'Sekarang: capture mati': 'Now: capture off',
  'Belum diatur. Bicara dideteksi dari kotak hijau di layar.': 'Not set up. Speaking is detected from the green box on screen.',
  'Discord Deteksi Suara': 'Discord Voice Detection',
  'Gambar unggahan': 'Uploaded images', 'Menghitung...': 'Counting...', 'Hapus gambar yang tidak dipakai': 'Delete unused images',
  'Belum ada gambar unggahan.': 'No uploaded images yet.',
  'Klik lagi untuk menghapus': 'Click again to delete',
  'Dukung developer': 'Support the developer', 'Donate': 'Donate',

  // kanvas
  'Kanvas OBS': 'OBS canvas', 'Tambah frame': 'Add frame', 'Jadikan ukuran utama': 'Make main size',
  'Hapus semua guide': 'Remove all guides',
  'Tambah frame baru dan atur crop-nya (ukuran disalin dari frame terpilih). Edit frame yang ada lewat ikon pensil di tile.': 'Add a new frame and set its crop (size copied from the selected frame). Edit existing frames with the pencil icon on the tile.',
  'Tambah frame dari gambar (bukan dari capture): tetap punya border, bayangan, dan efek bicara. Status bicara dari Discord.': 'Add a frame from an image (not from capture): it still has border, shadow, and speaking effects. Speaking status comes from Discord.',
  'Semua tile aktif jadi persis seukuran tile terpilih; rasio crop mereka ikut disamakan supaya video tidak gepeng. Bisa diurungkan.': 'All active tiles become exactly the size of the selected tile; their crop ratios are matched too so video isn’t squashed. Can be undone.',
  'Tarik dari penggaris kiri atau atas untuk membuat guide. Tarik kembali ke penggaris untuk menghapus.': 'Drag from the left or top ruler to create a guide. Drag it back to the ruler to remove it.',
  'Dukung pengembangan Waku': 'Support Waku’s development',
  'Tampil di kanvas': 'Show on canvas', 'Tidak tampil di kanvas': 'Hidden from canvas',
  'Matikan untuk menyembunyikan frame dari kanvas tanpa menghapusnya. Nama dan sumber bicara tetap tersimpan.': 'Turn off to hide the frame from the canvas without deleting it. Its name and speaking source stay saved.',
  'Support developer dalam pengembangan aplikasi.': 'Support the developer in building this app.',
  'Donate: Saweria Kurohiko': 'Donate: Saweria Kurohiko', 'Top up game murah di KurohikoTopUp.com': 'Cheap game top-ups at KurohikoTopUp.com',
  'Tarik ke bawah untuk membuat guide horizontal': 'Drag down to create a horizontal guide', 'Tarik ke kanan untuk membuat guide vertikal': 'Drag right to create a vertical guide',
  'Pengaturan cepat': 'Quick settings', 'Pengaturan cepat: susunan, video, label nama, efek bicara': 'Quick settings: arrangement, video, name labels, speaking effects',
  'Safe zone game': 'Game safe zone',
  'Safe zone game: tampilkan area HUD (minimap, skill, chat, ronde) supaya tile tidak menutupinya': 'Game safe zone: show HUD areas (minimap, skills, chat, rounds) so tiles don’t cover them',
  'Hanya tampil di editor, tidak ikut ke OBS. Posisi perkiraan untuk HUD bawaan.': 'Shown only in the editor, not sent to OBS. Approximate positions for the default HUD.',
  'Mati': 'Off', 'Maksimal 20 guide per sumbu': 'Maximum 20 guides per axis', 'Maksimal 16 frame': 'Maximum 16 frames',
  'Skor & ronde': 'Score & round', 'Pengumuman': 'Announcements', 'Info skill': 'Skill info', 'Daftar senjata': 'Weapon list', 'Kredit': 'Credits',

  // capture
  'menyiapkan...': 'preparing...', 'Pilih jendela Discord...': 'Choose the Discord window...', 'Menyiapkan capture...': 'Preparing capture...',
  'Capture dibatalkan': 'Capture canceled', 'Ukuran jendela Discord berubah. Kembalikan ukurannya, atau atur ulang crop.': 'The Discord window size changed. Restore its size, or set the crops again.', 'Capture berhenti, klik Capture lagi': 'Capture stopped, click Capture again', 'Capture aktif': 'Capture active',

  // bantuan
  'Persiapan sebelum live': 'Before going live', 'Di Discord': 'In Discord', 'Matikan': 'Turn off',
  '(Tampilkan peserta tanpa video), supaya grid hanya berisi tile kamera.': 'so the grid only contains camera tiles.',
  'Bagusnya klik kanan kamera kamu sendiri, lalu hilangkan centang': 'Ideally, right-click your own camera and uncheck',
  'Jangan ganti tema atau ukuran jendela Discord saat live; crop dan kotak deteksi bisa meleset.': 'Don’t change Discord’s theme or window size while live; crops and detection boxes can drift.',
  'Perhatikan Streamer Mode, karena bisa mengubah posisi overlay Discord.': 'Watch out for Streamer Mode, as it can move Discord’s overlay.',
  'Capture dan OBS': 'Capture and OBS', 'Klik': 'Click', ', lalu pilih jendela Discord (bertanda': ', then choose the Discord window (marked',
  '). Jangan di-minimize (capture beku); boleh tertutup jendela lain.': '). Don’t minimize it (capture freezes); other windows may cover it.',
  'Di OBS tambahkan Browser Source 1920x1080 dengan alamat preview di bar atas (tombol salin di sebelahnya).': 'In OBS, add a 1920x1080 Browser Source with the preview address from the top bar (copy button next to it).',
  'Bitrate dan FPS diatur di tab': 'Bitrate and FPS are set in the', '; angka yang benar-benar terkirim ke OBS tampil di sana.': 'tab; the numbers actually sent to OBS are shown there.',
  ': atur kotak crop pas di area kamera orangnya, lalu Simpan. Ikon pensil di tile untuk mengedit lagi.': ': fit the crop box to the person’s camera area, then Save. Use the pencil icon on the tile to edit again.',
  ': frame dari gambar (PNG, JPG, GIF, WebP), tanpa capture. Gambarnya bisa digeser dan di-zoom, dengan latar warna atau transparan.': ': a frame from an image (PNG, JPG, GIF, WebP), without capture. The image can be panned and zoomed, with a colored or transparent background.',
  'Di kanvas: tarik tile untuk memindah, tarik sudutnya untuk ubah ukuran. Tahan Alt sambil menarik sudut atau sisi untuk memotong (crop) tanpa mengubah skala gambar.': 'On the canvas: drag a tile to move it, drag its corner to resize. Hold Alt while dragging a corner or edge to crop without changing the image scale.',
  'Tombol kiri atas tile mengembalikan crop dan ukurannya; tempat sampah menghapus (klik dua kali). Ctrl+Z / Ctrl+Y untuk urungkan dan ulangi.': 'The top-left tile button resets its crop and size; the trash can deletes it (click twice). Ctrl+Z / Ctrl+Y to undo and redo.',
  'Deteksi bicara': 'Speaking detection',
  'Paling akurat: pakai API resmi Discord. Status bicara diambil langsung dari aplikasi Discord di PC ini, jadi tidak terganggu warna baju atau latar. Isi Client ID dan Client Secret sekali saja:': 'Most accurate: use Discord’s official API. Speaking status comes straight from the Discord app on this PC, so clothing or background colors don’t interfere. Enter the Client ID and Client Secret once:',
  'buka pengaturan Discord Deteksi Suara': 'open Discord Voice Detection settings',
  'Sumber bicara': 'Speaking source',
  'Hijau terbaca': 'Green read', 'harus naik dan kotaknya menyala.': 'should rise and the box lights up.', 'Kalau': 'If',
  'tinggi saat orang diam (baju, latar, atau green screen), geser kotaknya atau naikkan ambang di tab Deteksi.': 'is high while the person is silent (clothing, background, or green screen), move the box or raise the threshold in the Detection tab.',
  'Simpan susunan sekarang di tab': 'Save the current arrangement in the', '; tombol preset di bawah kanvas menerapkannya dalam satu klik.': 'tab; the preset buttons below the canvas apply it in one click.',
  'membuat semua frame persis seukuran frame terpilih.': 'makes all frames exactly the size of the selected frame.',

  // popup frame
  'Tambah / Edit Frame': 'Add / Edit Frame', 'Pas': 'Fit', 'Ctrl + scroll untuk zoom': 'Ctrl + scroll to zoom',
  'Perkecil': 'Zoom out', 'Perbesar': 'Zoom in', 'Muat satu layar': 'Fit to screen',
  'Belum ada capture. Capture jendela Discord dulu supaya kotak crop bisa diatur.': 'No capture yet. Capture the Discord window first so the crop box can be set.',
  'Capture jendela Discord': 'Capture Discord window',
  'Nonaktif': 'Off', 'Manual': 'Manual', 'Official': 'Official', 'Akun Discord': 'Discord account', 'Pilih akun...': 'Choose account...',
  'Frame ini tidak menyala saat bicara': 'This frame never lights up when speaking',
  'Kotak hijau: menyala saat outline hijau Discord muncul di layar': 'Green box: lights up when Discord’s green outline appears on screen',
  'Status bicara langsung dari aplikasi Discord, tanpa kotak hijau': 'Speaking status straight from the Discord app, no green box',
  'Status bicara diambil langsung dari Discord untuk akun ini.': 'Speaking status comes straight from Discord for this account.',
  'Deteksi bicara diatur per frame di popup edit frame. Frame baru mulai': 'Speaking detection is set per frame in the edit frame popup. New frames start',
  ': setelah Discord tersambung (pill Discord di bar atas), pilih akun orangnya di voice Discord. Frame virtual hanya bisa lewat cara ini.': ': once Discord is connected (Discord pill in the top bar), choose the person’s account in Discord voice. Virtual frames only work this way.',
  ': geser kotak hijau (kotak deteksi) ke tempat outline hijau Discord muncul. Saat orang itu bicara, angka': ': drag the green box (detection box) to where Discord’s green outline appears. When that person speaks, the',
  'Kunci rasio crop': 'Lock crop ratio', 'Kunci resize crop': 'Lock crop resize', 'Hijau terbaca:': 'Green read:', 'Status Discord:': 'Discord status:',
  'bicara': 'speaking', 'diam': 'silent', 'Taruh kotak deteksi di sudut crop': 'Put detection box in crop corner',
  'Kotak crop = area kamera. Hijau = kotak deteksi, taruh di tepi tile yang menyala saat bicara. Tarik sudut untuk ubah ukuran; tahan Alt untuk rasio bebas dan mematikan magnet.': 'Crop box = camera area. Green = detection box; place it on the tile edge that lights up when speaking. Drag corners to resize; hold Alt for a free ratio and to disable snapping.',
  'Hapus frame': 'Delete frame', 'Hapus frame ini': 'Delete this frame', 'Batal': 'Cancel', 'Simpan': 'Save', '+ Tambah frame': '+ Add frame',
  'Frame baru dengan ukuran sama seperti frame yang sedang dibuka': 'New frame with the same size as the frame being edited',
  'Wilayah deteksi bicara: taruh di tempat outline hijau Discord muncul': 'Speaking detection area: place it where Discord’s green outline appears',

  // virtual frame
  'Pilih virtual frame yang pernah dipakai, atau buat yang baru. Nama, gambar, dan sumber bicaranya ikut kembali.': 'Pick a virtual frame you used before, or create a new one. Its name, image, and speaking source come back too.',
  'Buat virtual frame baru': 'Create a new virtual frame', 'Tanpa sumber bicara': 'No speaking source', 'Sudah di kanvas': 'Already on canvas',
  'Tersembunyi di kanvas': 'Hidden on canvas', 'Gambar hilang': 'Image missing', 'Hapus permanen': 'Delete permanently', 'Klik lagi untuk hapus permanen': 'Click again to delete permanently',
  'Virtual frame ditampilkan lagi': 'Virtual frame shown again', 'Hapus virtual frame tersimpan': 'Delete saved virtual frames',
  'Klik lagi untuk menghapus semua': 'Click again to delete all', 'Tidak ada virtual frame tersimpan di luar kanvas.': 'No saved virtual frames outside the canvas.',
  'Tambah virtual frame': 'Add virtual frame', 'Pilih gambar': 'Choose image',
  'atau seret file ke sini': 'or drop a file here', 'PNG, JPG, GIF bergerak, WebP · maks 8 MB': 'PNG, JPG, animated GIF, WebP · max 8 MB',
  'Ganti gambar': 'Change image', 'Seret gambar untuk menggeser, scroll untuk zoom': 'Drag the image to pan, scroll to zoom',
  'Transparan': 'Transparent', 'Warna background': 'Background color', 'Zoom gambar': 'Image zoom',
  'Seluruh gambar muat di dalam frame': 'Fit the whole image inside the frame',
  'Border, bayangan, dan efek bicara ikut gaya frame. Status bicara diambil dari Discord.': 'Border, shadow, and speaking effects follow the frame style. Speaking status comes from Discord.',
  'Tidak ada (tidak menyala)': 'None (never lights up)', 'Discord belum tersambung': 'Discord not connected',
  'Format harus PNG, JPG, GIF, atau WebP': 'Format must be PNG, JPG, GIF, or WebP', 'Gambar terlalu besar (maks 8 MB)': 'Image too large (max 8 MB)',
  'File ini bukan gambar yang bisa dibaca': 'This file isn’t a readable image', 'Pilih gambar dulu': 'Choose an image first',
  'Server masih versi lama: restart server Waku dulu, lalu coba lagi': 'The server is outdated: restart the Waku server, then try again',
  'Server tidak terhubung': 'Server not connected',

  // Discord
  'Discord belum dibuka': 'Discord isn’t open', 'menyambung...': 'connecting...', 'klik Authorize di Discord': 'click Authorize in Discord',
  'izin ditolak': 'permission denied', 'gagal': 'failed', 'klik coba lagi': 'click to retry',
  'di panggilan': 'in a call', 'belum masuk voice': 'not in voice', 'tersambung': 'connected',
  'Discord tidak berjalan': 'Discord isn’t running', 'koneksi Discord putus': 'Discord connection lost',
  'Opsional. Dengan API resmi dari Discord, Waku bisa memakai fitur pendeteksi suara yang akurat. Aman, karena fitur ini memang disediakan resmi oleh Discord.': 'Optional. With Discord’s official API, Waku can use accurate voice detection. It’s safe, because Discord officially provides this feature.',
  'Buka': 'Open', ', klik': ', click', ', lalu beri nama aplikasinya. Nama tidak boleh mengandung kata "discord".': ', then name your application. The name must not contain the word "discord".',
  'Klik menu': 'Click the', '. Copy': 'menu. Copy', 'dan masukkan ke kolom Client ID di bawah.': 'and paste it into the Client ID field below.',
  ', lalu masukkan ke kolom Client Secret.': ', then paste it into the Client Secret field.',
  'Masih di halaman yang sama, di bagian': 'On the same page, in the', 'klik': 'section click', ', ketik': ', type', ', lalu klik': ', then click',
  'Secret hanya disimpan di PC ini dan tidak pernah ditampilkan lagi.': 'The secret is stored only on this PC and is never shown again.',
  'Tutup': 'Close', 'Simpan & sambungkan': 'Save & connect',
  'tersimpan; isi hanya untuk mengganti': 'saved; fill in only to replace', 'Belum diisi.': 'Not filled in.', 'Menyimpan...': 'Saving...',
  'Client ID harus berupa angka dari Developer Portal.': 'Client ID must be the number from the Developer Portal.',
  'Isi Client Secret juga.': 'Fill in the Client Secret too.',
  'Client Secret tidak valid; salin ulang dari Developer Portal.': 'Invalid Client Secret; copy it again from the Developer Portal.',

  // port server (aplikasi Electron)
  'Port server': 'Server port', 'Cari port kosong': 'Find free port', 'Klik lagi untuk pindah': 'Click again to switch',
  'Ubah kalau port bentrok.': 'Change it if the port conflicts.',
  'Port kosong ditemukan. Klik Terapkan untuk memakainya.': 'Found a free port. Click Apply to use it.',
  'Port harus angka 1024-65535.': 'Port must be a number from 1024 to 65535.',
  'Port ini sudah dipakai sekarang.': 'Waku is already using this port.', 'Port tidak valid.': 'Invalid port.',

  // shortcut global / Stream Deck (aplikasi Electron)
  'Shortcut dan Stream Deck': 'Shortcuts and Stream Deck', 'Atur shortcut': 'Set shortcuts', 'Shortcut': 'Shortcuts',
  'Ganti preset, template, dan deteksi bicara dari keyboard atau Stream Deck.': 'Switch presets, templates, and speaking detection from the keyboard or Stream Deck.',
  'Tambah shortcut, pilih aksinya, lalu klik Atur tombol dan tekan kombinasinya (misalnya Ctrl+Alt+1). Berlaku di mana saja, walau Waku tersembunyi di tray. Untuk Stream Deck, pakai aksi': 'Add a shortcut, pick its action, then click Set key and press the combination (for example Ctrl+Alt+1). Works anywhere, even when Waku is hidden in the tray. For Stream Deck, use a',
  'dengan kombinasi yang sama.': 'action with the same combination.',
  'Template berikutnya': 'Next template', 'Deteksi bicara nyala/mati': 'Speaking detection on/off', 'Tekan kombinasi...': 'Press a combination...',
  'Tambah shortcut': 'Add shortcut', 'Pilih aksi...': 'Choose an action...', 'Aksi': 'Action', 'Atur tombol': 'Set key', 'Hapus shortcut': 'Delete shortcut',
  'Belum ada shortcut.': 'No shortcuts yet.', 'Setiap baris harus punya aksi dan tombol.': 'Every row needs an action and a key.',
  'Preset: (sudah dihapus)': 'Preset: (deleted)', 'Preset untuk shortcut ini sudah dihapus': 'The preset for this shortcut was deleted',
  'Gagal menyimpan.': 'Failed to save.', 'Shortcut disimpan': 'Shortcuts saved',
  'Pasang plugin Stream Deck': 'Install Stream Deck plugin',
  'File plugin tidak ditemukan. Jalankan npm run deck dulu.': 'Plugin file not found. Run npm run deck first.',
  'Gagal membuka plugin. Pastikan aplikasi Stream Deck terpasang.': 'Couldn’t open the plugin. Make sure the Stream Deck app is installed.',
  'Tutup popup Crop dulu sebelum ganti preset': 'Close the Crop popup before switching presets',

  // update aplikasi (aplikasi Electron)
  'Update': 'Update', 'Cek update': 'Check for updates', 'Belum dicek.': 'Not checked yet.', 'Mengecek update...': 'Checking for updates...',
  'Waku sudah versi terbaru.': 'Waku is up to date.', 'Update hanya tersedia di versi installer.': 'Updates are only available in the installed version.',
  'Restart & pasang': 'Restart & install', 'Klik lagi untuk restart': 'Click again to restart', 'siap': 'ready',
  'Ada versi baru Waku. Klik untuk melihat.': 'A new version of Waku is available. Click to view.',
  'Belum ada rilis yang bisa diunduh.': 'No release available to download yet.', 'Tidak bisa terhubung ke GitHub. Cek koneksi internet.': 'Can’t reach GitHub. Check your internet connection.',

  // export / import preset
  'Export / import preset': 'Export / import presets', 'Export preset': 'Export presets', 'Import preset': 'Import presets', 'Export': 'Export', 'Import': 'Import',
  'Bagikan preset ke teman, atau pakai preset dari orang lain. Disimpan sebagai file .json.': 'Share presets with friends, or use presets from others. Saved as a .json file.',
  'Pilih preset yang mau diekspor. Nama bisa diganti dulu; preset kamu sendiri tidak berubah. Simpan sebagai file, atau salin teksnya untuk ditempel di chat. Gambar virtual frame ikut di dalamnya.': 'Choose the presets to export. You can rename them first; your own presets stay unchanged. Save as a file, or copy the text to paste in a chat. Virtual frame images are included.',
  'Sertakan akun Discord (untuk backup sendiri)': 'Include Discord accounts (for your own backup)',
  'Pilih file preset Waku (.json), atau tempel teks JSON-nya. Preset dengan nama yang sudah ada diberi akhiran v2, v3, dan seterusnya.': 'Choose a Waku preset file (.json), or paste its JSON text. Presets whose name already exists get a v2, v3, and so on suffix.',
  'Salin teks': 'Copy text', 'Simpan file': 'Save file', 'atau tempel teks JSON di sini': 'or paste JSON text here', 'Teks JSON preset': 'Preset JSON text',
  'Baca teks': 'Read text', 'Tempel teks JSON dulu.': 'Paste JSON text first.', 'Gagal menyalin, coba Simpan file.': 'Copy failed, try Save file.',
  'Pilih file...': 'Choose file...', 'Pilih preset': 'Select preset', 'Pilih minimal satu preset.': 'Select at least one preset.',
  'Belum ada preset untuk diekspor.': 'No presets to export yet.', 'Sudah 20 preset. Hapus beberapa dulu.': 'You already have 20 presets. Delete some first.',
  'Isinya bukan JSON yang valid.': 'This isn’t valid JSON.', 'Isinya bukan preset Waku.': 'This isn’t a Waku preset.',
  'Tidak ada preset yang bisa dibaca.': 'No readable presets found.',

  // laporan bug (aplikasi Electron)
  'Laporan bug': 'Bug report', 'Salin info': 'Copy info', 'Buka folder log': 'Open log folder',
  'Salin info, lalu kirim ke developer.': 'Copy the info, then send it to the developer.',
  'Log tidak berisi token / secret Discord.': 'Logs contain no Discord token / secret.',
  'Tersalin. Tempel ke chat atau issue.': 'Copied. Paste it into a chat or issue.', 'Gagal membuat laporan.': 'Couldn’t create the report.',
  'Pengaturan Discord tidak bisa dibuka di PC ini (data dipindah?). Isi ulang Client ID dan Client Secret di tab Atur.': 'Discord settings can’t be opened on this PC (data moved?). Re-enter the Client ID and Client Secret in the Settings tab.',
};

// Teks yang dirangkai dengan angka/nama. Hasil EN boleh fungsi (argumen seperti String.replace).
const plural = (n, w) => n + ' ' + w + (Number(n) === 1 ? '' : 's');
const PATTERNS = [
  [/^(\d+) frame$/, (_, n) => plural(n, 'frame')],
  [/^Terapkan preset \((\d+) frame\)$/, (_, n) => `Apply preset (${plural(n, 'frame')})`],
  [/^Preset "(.*)" diterapkan · (\d+) virtual frame gambarnya hilang$/s, (_, p, n) => `Preset "${p}" applied · ${n} virtual frame${n === '1' ? '' : 's'} missing an image`],
  [/^Preset "(.*)" diterapkan$/s, 'Preset "$1" applied'],
  [/^Bicara: (.*)$/s, 'Speaking: $1'],
  [/^Dipakai di (\d+) preset · klik lagi untuk hapus permanen$/, (_, n) => `Used in ${n} preset${n === '1' ? '' : 's'} · click again to delete permanently`],
  [/^(\d+) virtual frame tersimpan di daftar \(tidak di kanvas\)\.$/, (_, n) => `${n} saved virtual frame${n === '1' ? '' : 's'} (not on canvas).`],
  [/^Capture gagal: (.*)$/s, 'Capture failed: $1'],
  [/^Hapus frame (.+) \(klik dua kali untuk memastikan\)$/s, 'Delete frame $1 (click twice to confirm)'],
  [/^Reset (.+): crop kembali ke yang diatur di popup, ukuran tile ke bawaan$/s, 'Reset $1: crop back to the popup setting, tile size to default'],
  [/^(.+) \(tidak di channel\)$/s, '$1 (not in channel)'],
  [/^Upload gagal \((.*)\)$/s, 'Upload failed ($1)'],
  [/^(\d+) gambar, ([\d.]+ [KM]B)\. Semua dipakai frame atau preset\.$/, (_, n, s) => `${plural(n, 'image')}, ${s}. All are used by frames or presets.`],
  [/^(\d+) gambar, ([\d.]+ [KM]B)\. (\d+) tidak dipakai \(([\d.]+ [KM]B)\)$/, (_, n, s, u, us) => `${plural(n, 'image')}, ${s}. ${u} unused (${us})`],
  [/^(\d+) gambar dihapus$/, (_, n) => `${plural(n, 'image')} deleted`],
  [/^Sekarang: (.*)$/s, 'Now: $1'],
  [/^Status: (.*)$/s, (_, s) => 'Status: ' + tr(s)],
  [/^Aktif · (.*)$/s, (_, s) => 'Active · ' + tr(s)],
  [/^Gagal menyimpan pengaturan Discord: (.*)$/s, 'Failed to save Discord settings: $1'],
  [/^Layout gagal disimpan ke disk \((.*)\): perubahan hilang saat Waku ditutup\.$/s, 'Layout could not be saved to disk ($1): changes will be lost when Waku closes.'],
  [/^(.+) rusak dan tidak bisa dibaca, jadi editor mulai kosong\. Isi lamanya disalin ke (.+)\.$/s, '$1 is corrupt and unreadable, so the editor started empty. Its old content was copied to $2.'],
  [/^(\w+) tidak dijawab Discord$/, 'Discord did not answer $1'],
  [/^Alamat OBS sekarang: (.*)$/s, 'Current OBS address: $1'],
  [/^Halaman dimuat ulang dan capture berhenti; capture lagi setelah pindah\. Ganti juga alamat di OBS ke (.*)$/s, 'The page reloads and capture stops; capture again after switching. Also change the OBS address to $1'],
  [/^Memindahkan Waku ke port (\d+)\.\.\.$/, 'Moving Waku to port $1...'],
  [/^Sudah dipakai program lain: (.*)$/s, (_, s) => 'Already used by another program: ' + s.split(', ').map(tr).join(', ')],
  [/^(.+) dipindah dari baris (\d+)$/s, '$1 moved from row $2'],
  [/^Template: (.*)$/s, 'Template: $1'],
  [/^Preset: (.*)$/s, 'Preset: $1'],
  [/^Port (\d+) sedang dipakai program lain\.$/, 'Port $1 is in use by another program.'],
  [/^Versi (.+) tersedia\.$/, 'Version $1 is available.'],
  [/^Unduh versi (.+)$/, 'Download version $1'],
  [/^Mengunduh versi (.+)\.\.\. (\d+)%$/, 'Downloading version $1... $2%'],
  [/^Versi (.+) siap dipasang\. Waku akan ditutup sebentar lalu terbuka lagi; capture perlu diulang\.$/, 'Version $1 is ready to install. Waku will close briefly and reopen; you’ll need to capture again.'],
  [/^Gagal: (.*)$/s, (_, m) => 'Failed: ' + tr(m)],
  [/^Nama sudah ada, jadi "(.*)"$/s, 'Name already exists, renamed to "$1"'],
  [/^(\d+) preset terbaca\.$/, (_, n) => `${n} preset${n === '1' ? '' : 's'} found.`],
  [/^Hanya bisa menambah (\d+) preset lagi \(maksimal 20\)\.$/, 'You can add only $1 more presets (max 20).'],
  [/^File dibuat: (.*)$/s, 'File created: $1'],
  [/^Teks JSON disalin \((.+)\)\. Tempel di chat untuk dibagikan\.$/s, 'JSON text copied ($1). Paste it in a chat to share.'],
  [/^(\d+) preset diimpor$/, (_, n) => `${n} preset${n === '1' ? '' : 's'} imported`],
];

const KEY = 'waku.lang';
// Aplikasi Electron: bahasa disimpan di pengaturan aplikasi (dipakai juga oleh dialog, tray, picker).
// Browser biasa: pilihan tombol di localStorage, bawaan ikut bahasa browser (Indonesia -> ID, selain itu EN).
const fromBrowser = () => (navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en');
const app = globalThis.wakuApp;
let lang = 'en';
try { lang = app?.lang || localStorage.getItem(KEY) || fromBrowser(); } catch { lang = app?.lang || fromBrowser(); }
if (lang !== 'id' && lang !== 'en') lang = 'en';
export const getLang = () => lang;

export function tr(s) {
  if (!s || lang === 'id') return s;
  if (Object.hasOwn(EN, s)) return EN[s];
  for (const [re, out] of PATTERNS) if (re.test(s)) return s.replace(re, out);
  if (s.includes(' · ')) { // status bertingkat: "izin ditolak · klik coba lagi", "tersambung · Nama channel"
    const parts = s.split(' · ');
    const out = parts.map(tr);
    if (out.some((p, i) => p !== parts[i])) return out.join(' · '); // minimal satu bagian dikenal (kamus atau pola)
  }
  return s;
}

// Teks ini dikenal kamus (termasuk yang EN-nya sama, mis. "Layout"); dipakai tes cakupan terjemahan.
export const translates = s => Object.hasOwn(EN, s) || tr(s) !== s;

const ATTRS = ['title', 'aria-label', 'placeholder'];
const srcText = new WeakMap(); // text node -> teks asli (ID)
const srcAttr = new WeakMap(); // element -> { attr: teks asli }
const mineText = new WeakMap(); // text node -> nilai terakhir yang ditulis i18n (abaikan mutasi milik sendiri)
const mineAttr = new WeakMap(); // element -> { attr: nilai terakhir yang ditulis i18n }
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);

function textNode(n, fresh) {
  if (SKIP.has(n.parentNode?.nodeName)) return;
  if (fresh || !srcText.has(n)) srcText.set(n, n.data);
  const orig = srcText.get(n);
  const core = orig.trim();
  if (!core) return;
  const out = orig.replace(core, () => tr(core));
  if (out !== n.data) { mineText.set(n, out); n.data = out; }
}
function attrs(el, only, fresh) {
  for (const a of only ?? ATTRS) {
    if (!el.hasAttribute(a)) continue;
    let src = srcAttr.get(el), mine = mineAttr.get(el);
    if (!src) srcAttr.set(el, (src = {}));
    if (!mine) mineAttr.set(el, (mine = {}));
    if (fresh || !(a in src)) src[a] = el.getAttribute(a);
    const out = tr(src[a]);
    if (out !== el.getAttribute(a)) { mine[a] = out; el.setAttribute(a, out); }
  }
}
function walk(root) {
  if (root.nodeType === 3) return textNode(root);
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
  attrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? textNode(n) : attrs(n);
}

// Teks asli (ID) dari elemen, untuk kode yang membaca teks UI (mis. nama di <option>).
export const original = el => [...el.childNodes].map(n => (n.nodeType === 3 ? srcText.get(n) ?? n.data : n.textContent)).join('');

let srcTitle = '';
const apply = () => {
  document.documentElement.lang = lang;
  walk(document.body);
  document.title = tr(srcTitle);
};
export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* hanya untuk sesi ini */ }
  app?.setLang(l);
  apply();
}

// Dipanggil sekali setelah UI selesai dibangun.
export function startI18n() {
  srcTitle = document.title;
  new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === 'characterData') { if (mineText.get(r.target) !== r.target.data) textNode(r.target, true); }
      else if (r.type === 'attributes') { if (mineAttr.get(r.target)?.[r.attributeName] !== r.target.getAttribute(r.attributeName)) attrs(r.target, [r.attributeName], true); }
      else for (const n of r.addedNodes) walk(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (lang !== 'id') apply();
}
