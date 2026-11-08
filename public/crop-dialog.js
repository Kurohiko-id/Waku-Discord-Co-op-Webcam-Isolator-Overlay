// Popup Tambah / Edit frame (crop dari capture Discord). Semua slot dikerjakan pada salinan (draft);
// layout baru berubah lewat onSave setelah tombol Simpan. Frame virtual diatur di popup lain dan hanya ikut dibawa.
import { defaultProbe } from '/shared/layout.js';
import { clampRect, resizeCorner } from '/shared/geometry.js';
import { attachDrag } from '/shared/drag.js';
import { original } from '/shared/i18n.js';
import { place, showGuides, showMatch, addCorners } from '/editor-dom.js';

const $ = id => document.getElementById(id);
const MAX_SLOTS = 16;

// video: elemen capture. frame(): ukuran frame capture. slots()/greenMin()/selected(): keadaan layout sekarang.
// makeNewSlot(slots, src): slot baru yang sudah dijepit. discord(): status Discord (null = tidak dipakai).
// onSave({ slots, greenMin, selectedId }): draft yang disimpan; pemanggil yang menggabungkannya ke layout.
export function createCropDialog({ video, frame, slots, greenMin, selected, makeNewSlot, discord, onSave }) {
  const dlg = $('cropDialog');
  let draft = null; // { slots, slot (yang sedang diedit), greenMin }
  let els = null; // { crop, probe, refs }
  let zoom = 1;
  const cropScale = () => $('dlgStage').clientWidth / frame().w; // skala kotak crop di popup
  // Mode deteksi bicara: off = tidak menyala, manual = kotak hijau, discord = akun Discord (Official).
  // Di data: detect=false -> off; detect + discordId -> discord; detect tanpa discordId -> manual.
  // pending = slot yang memilih Official tapi belum memilih akun; saat Simpan jadi Nonaktif.
  const pending = new Set();
  const mode = s => (pending.has(s.id) ? 'discord' : !s.detect ? 'off' : s.discordId ? 'discord' : 'manual');

  // id = slot yang dibuka; tanpa id: slot terpilih, atau slot pertama, atau slot baru bila belum ada.
  function open(id, add = false) {
    const list = structuredClone(slots());
    draft = { slots: list, slot: null, greenMin: greenMin() };
    pending.clear();
    const cams = list.filter(s => !s.image); // frame virtual diatur di popup gambar, bukan di sini
    let cur = add && list.length < MAX_SLOTS ? null : cams.find(s => s.id === id) ?? cams.find(s => s.id === selected()) ?? cams[0];
    if (!cur) { cur = makeNewSlot(list, cams.find(s => s.id === selected()) ?? cams[0]); list.push(cur); } // ukuran ikut slot terpilih
    $('dGreen').value = draft.greenMin;
    $('dGreenVal').textContent = draft.greenMin;
    $('dlgEmpty').hidden = !!video.videoWidth;
    dlg.showModal();
    setZoom(1);
    if (video.videoWidth) draw();
    switchSlot(cur.id);
  }

  function switchSlot(id) {
    const s = (draft.slot = draft.slots.find(x => x.id === id));
    $('dName').value = s.name;
    $('dEnabled').checked = s.enabled;
    $('dRatioLock').checked = s.ratioLocked;
    $('dCropLock').checked = s.cropLocked;
    fillSource();
    resetDelete();
    renderSlots();
    buildStage();
  }

  function renderSlots() {
    const chips = draft.slots.filter(s => !s.image).map(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.name || s.id;
      b.className = (s === draft.slot ? 'sel' : '') + (s.enabled ? '' : ' off');
      if (!s.enabled) b.title = 'Tidak tampil di kanvas';
      b.onclick = () => switchSlot(s.id);
      return b;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Tambah frame';
    add.title = 'Frame baru dengan ukuran sama seperti frame yang sedang dibuka';
    add.disabled = draft.slots.length >= MAX_SLOTS;
    add.onclick = () => { const s = makeNewSlot(draft.slots, draft.slot); draft.slots.push(s); switchSlot(s.id); };
    $('dlgSlots').replaceChildren(add, ...chips); // tombol tambah paling kiri: tidak bergeser saat frame bertambah
  }

  function resetDelete() { $('dlgDelete').classList.remove('armed'); $('dlgDelete').textContent = 'Hapus frame ini'; }

  function draw() {
    const f = frame(), cv = $('dlgCanvas');
    if (cv.width !== f.w || cv.height !== f.h) { cv.width = f.w; cv.height = f.h; setZoom(zoom); } // rasio frame berubah: hitung ulang ukuran pas
    cv.getContext('2d').drawImage(video, 0, 0);
    $('dlgEmpty').hidden = true;
  }

  function position() {
    if (!draft || !els) return;
    const k = cropScale();
    place(els.crop, draft.slot.crop, k);
    if (els.probe) place(els.probe, draft.slot.probe, k);
    for (const r of els.refs) place(r.el, r.rect, k);
  }

  function buildStage() {
    const stage = $('dlgStage'), s = draft.slot;
    stage.querySelectorAll('.box, .probe, .refbox, .guide, .matchbox').forEach(e => e.remove());
    const refs = [];
    const others = draft.slots.filter(o => o !== s && o.enabled && !o.image);
    for (const o of others) { // crop slot lain sebagai acuan ukuran (garis putus-putus)
      const el = document.createElement('div');
      el.className = 'refbox';
      el.innerHTML = '<span></span>';
      el.firstChild.textContent = o.name || o.id;
      stage.append(el);
      refs.push({ el, rect: o.crop });
    }
    const crop = document.createElement('div');
    crop.className = 'box sel' + (s.cropLocked ? ' locked' : '');
    const handles = addCorners(crop);
    stage.append(crop);
    els = { crop, probe: null, refs };
    const clear = () => { showGuides({ x: [], y: [] }, stage, cropScale()); showMatch(stage, 1, null); };
    let ratioStart = 1;
    attachDrag(crop, handles, {
      get: () => s.crop,
      scale: cropScale,
      canResize: () => !s.cropLocked,
      begin: () => { ratioStart = s.crop.w / s.crop.h; },
      move: r => { s.crop = clampRect(r, frame()); position(); },
      resize: (r, alt, corner) => { // Alt: rasio bebas walau terkunci, magnet mati
        const sn = resizeCorner(r, corner, frame(), others.map(o => o.crop), { threshold: alt ? 0 : Math.round(10 / cropScale()), ratio: s.ratioLocked && !alt ? ratioStart : null });
        s.crop = sn.rect;
        showGuides(sn.guides, stage, cropScale());
        showMatch(stage, cropScale(), s.crop, sn.matchIndex === null ? null : others[sn.matchIndex].crop);
        position();
      },
      end: clear,
    });
    if (mode(s) === 'manual') { // wilayah deteksi bicara: kotak hijau berlabel (hanya mode Manual)
      const probe = document.createElement('div');
      probe.className = 'probe sel';
      probe.title = 'Wilayah deteksi bicara: taruh di tempat outline hijau Discord muncul';
      const lab = document.createElement('span');
      lab.className = 'plabel';
      lab.textContent = 'Deteksi bicara';
      const ph = document.createElement('i');
      ph.className = 'h';
      probe.append(lab, ph);
      stage.append(probe);
      els.probe = probe;
      attachDrag(probe, ph, {
        get: () => s.probe,
        scale: cropScale,
        canResize: () => true,
        move: r => { s.probe = clampRect(r, frame()); position(); },
        resize: r => { s.probe = clampRect(r, frame()); position(); },
        end: () => {},
        minW: 8,
        minH: 8,
      });
    }
    position();
  }

  // Zoom popup: stage melebar, #dlgView menggulir; kotak ikut karena semua posisi memakai cropScale().
  // ax, ay: titik di stage (pecahan 0..1) yang harus tetap berada di bawah posisi layar cx, cy (default: tengah area gambar).
  // Posisi dikoreksi dari posisi layar sebenarnya karena popup ditengahkan dan bergeser saat tingginya berubah.
  function setZoom(z, ax, ay, cx, cy) {
    const view = $('dlgView'), stage = $('dlgStage');
    z = Math.min(6, Math.max(1, Math.round(z * 100) / 100));
    if (ax === undefined) {
      const s = stage.getBoundingClientRect(), v = view.getBoundingClientRect();
      cx = v.left + view.clientWidth / 2; cy = v.top + view.clientHeight / 2;
      ax = Math.min(1, Math.max(0, (cx - s.left) / s.width)); ay = Math.min(1, Math.max(0, (cy - s.top) / s.height));
    }
    zoom = z;
    // 100% = seluruh frame muat di area yang terlihat (pas lebar atau pas tinggi, mana yang lebih sempit)
    const f = frame();
    stage.style.width = z * Math.min(view.clientWidth, (view.clientHeight * f.w) / f.h) + 'px';
    const r = stage.getBoundingClientRect();
    view.scrollLeft += r.left + ax * r.width - cx;
    view.scrollTop += r.top + ay * r.height - cy;
    $('zVal').textContent = Math.round(z * 100) + '%';
    $('zRange').value = z;
    position();
  }

  // Tombol mode, pilihan akun (hanya Official), dan kontrol kotak hijau (hanya Manual, lewat CSS .mode-*).
  function fillSource() {
    const s = draft.slot, m = mode(s), dc = discord();
    for (const b of $('dMode').children) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === m));
      b.disabled = b.dataset.mode === 'discord' && !dc && m !== 'discord'; // Discord belum diatur di tab Atur
    }
    const side = $('dSourceRow').parentElement;
    side.classList.remove('mode-off', 'mode-manual', 'mode-discord');
    side.classList.add('mode-' + m);
    $('ratioLabel').textContent = m === 'discord' ? 'Status Discord:' : 'Hijau terbaca:';
    $('dSourceRow').hidden = m !== 'discord';
    if (m !== 'discord') return;
    const opts = [['', dc ? 'Pilih akun...' : 'Discord belum tersambung'], ...(dc?.members ?? []).map(x => [x.id, x.name])];
    if (s.discordId && !opts.some(o => o[0] === s.discordId)) opts.push([s.discordId, (s.discordName || 'User') + ' (tidak di channel)']);
    $('dSource').replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
    $('dSource').value = s.discordId;
  }
  function setMode(m) {
    const s = draft.slot;
    pending.delete(s.id);
    if (m === 'discord') { s.detect = true; if (!s.discordId) pending.add(s.id); } else Object.assign(s, { detect: m === 'manual', discordId: '', discordName: '' });
    fillSource();
    buildStage();
  }

  $('zIn').onclick = () => setZoom(zoom * 1.25);
  $('zOut').onclick = () => setZoom(zoom / 1.25);
  $('zFit').onclick = () => setZoom(1);
  $('zRange').oninput = e => setZoom(Number(e.target.value));
  $('dlgView').addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = $('dlgStage').getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX, e.clientY);
  }, { passive: false });
  new ResizeObserver(() => position()).observe($('dlgStage'));
  new ResizeObserver(() => { if (draft) setZoom(zoom); }).observe($('dlgView')); // jendela di-resize: gambar tetap muat

  $('dName').oninput = e => { draft.slot.name = e.target.value; renderSlots(); };
  $('dEnabled').onchange = e => { draft.slot.enabled = e.target.checked; renderSlots(); };
  for (const b of $('dMode').children) b.onclick = () => setMode(b.dataset.mode);
  $('dRatioLock').onchange = e => { draft.slot.ratioLocked = e.target.checked; };
  $('dCropLock').onchange = e => { draft.slot.cropLocked = e.target.checked; buildStage(); };
  $('dGreen').oninput = e => { draft.greenMin = Number(e.target.value); $('dGreenVal').textContent = e.target.value; };
  $('dProbeReset').onclick = () => {
    draft.slot.probe = clampRect(defaultProbe(draft.slot.crop), frame());
    position();
  };
  $('dSource').onchange = e => {
    const s = draft.slot;
    s.discordId = e.target.value;
    s.discordName = e.target.value ? original(e.target.selectedOptions[0]).replace(' (tidak di channel)', '') : '';
    if (s.discordId) pending.delete(s.id); else pending.add(s.id); // tetap Official, menunggu akun dipilih
    fillSource();
  };
  $('dlgCapture').onclick = () => $('capture').click();
  $('dlgCancel').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { draft = null; els = null; $('ratio').textContent = '-'; });
  $('dlgDelete').onclick = () => {
    const b = $('dlgDelete');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = 'Klik lagi untuk menghapus';
      setTimeout(resetDelete, 3000);
      return;
    }
    const i = draft.slots.indexOf(draft.slot);
    draft.slots.splice(i, 1); // baru benar-benar terhapus setelah Simpan
    const cams = draft.slots.filter(x => !x.image);
    let next = cams[Math.min(i, cams.length - 1)];
    if (!next) { next = makeNewSlot(draft.slots); draft.slots.push(next); }
    switchSlot(next.id);
  };
  $('dlgSave').onclick = () => {
    for (const s of draft.slots) if (pending.has(s.id)) s.detect = false; // Official tanpa akun: Nonaktif
    const saved = { slots: draft.slots, greenMin: draft.greenMin, selectedId: draft.slot.id };
    dlg.close();
    onSave(saved);
  };

  return {
    open,
    isOpen: () => !!draft,
    draw, // gambar frame capture terbaru (dipanggil loop video saat popup terbuka)
    // slot yang sedang diatur + ambang hijau popup, untuk bacaan langsung deteksi; null bila popup tertutup
    current: () => (draft ? { slot: draft.slot, greenMin: draft.greenMin, mode: mode(draft.slot) } : null),
    markHit: hit => els?.probe?.classList.toggle('hit', hit),
    // ukuran frame capture berubah saat popup terbuka: jepit crop dan kotak deteksi semua slot draft
    reclamp(k = 1) { // k: skala ukuran capture baru terhadap yang lama (pindah monitor dengan rasio sama)
      if (!draft) return;
      const sc = r => (k === 1 ? r : { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k });
      for (const d of draft.slots) if (!d.image) { d.probe = clampRect(sc(d.probe), frame()); d.crop = clampRect(sc(d.crop), frame()); }
      position();
    },
    refreshSource: () => { if (draft) fillSource(); }, // status Discord berubah
  };
}
