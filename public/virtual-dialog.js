// Popup Tambah / Edit frame virtual: frame dari gambar unggahan, bukan dari capture.
// Gambar baru diunggah saat Simpan; layout baru berubah lewat onSave.
import { nextSlotName } from '/shared/layout.js';
import { virtualBox, placeImage } from '/shared/tile-dom.js';
import { original } from '/shared/i18n.js';

const $ = id => document.getElementById(id);
const UPLOAD_ERR = { 404: 'Server masih versi lama: restart server Waku dulu, lalu coba lagi', 413: 'Gambar terlalu besar (maks 8 MB)', 415: 'Format harus PNG, JPG, GIF, atau WebP' };

// Seluruh gambar muat di dalam frame berasio a, di tengah (sisa ruang = latar).
function fitCrop(a, w, h) {
  const cw = w / h > a ? w : h * a, ch = cw / a;
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}
// Gambar pilihan dipegang sebagai blob: sampai di-revoke; setelah simpan, tile memakai /uploads/..., jadi aman dilepas saat dialog tutup.
const revokeBlob = u => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };

// slots(): slot layout sekarang. ref(): frame acuan rasio frame baru (atau null). discord(): status Discord (null = tidak dipakai).
// onSave({ id (null = baru), image, imgW, imgH, crop, bg, name, discordId, discordName }) setelah gambar terunggah.
export function createVirtualDialog({ slots, ref, discord, onSave }) {
  // edit.crop = jendela pandang frame dalam piksel gambar; boleh melewati tepi gambar (di sana terlihat latar).
  let edit = null; // { id (null = baru), file, url, w, h, crop }
  const error = msg => { $('vErr').textContent = msg; $('vErr').hidden = !msg; };
  const box = virtualBox();
  $('vStage').append(box);

  function render() {
    const has = !!edit.url;
    $('vStage').hidden = !has; $('vDrop').hidden = has; $('vTools').hidden = !has;
    if (!has) return;
    const view = $('vView'), a = edit.crop.w / edit.crop.h;
    let w = view.clientWidth - 24, h = w / a; // sisakan tepi supaya bingkai frame terlihat
    if (h > view.clientHeight - 24) { h = view.clientHeight - 24; w = h * a; }
    Object.assign($('vStage').style, { width: w + 'px', height: h + 'px' });
    placeNow();
  }
  // Hanya posisi gambar (dan latar): cukup ini saat menggeser/zoom, tanpa menghitung ulang ukuran area.
  function placeNow() {
    placeImage(box, { image: edit.url, imgW: edit.w, imgH: edit.h, crop: edit.crop, bg: $('vBgNone').checked ? 'transparent' : $('vBg').value });
    $('vZoom').value = fitCrop(edit.crop.w / edit.crop.h, edit.w, edit.h).w / edit.crop.w;
  }
  // Mouse gaming mengirim ratusan pointermove/wheel per detik: gambar ulang paling sering sekali per frame layar.
  let raf = 0;
  const placeSoon = () => { raf ||= requestAnimationFrame(() => { raf = 0; placeNow(); }); };
  // zoom z relatif terhadap "Pas"; titik (fx, fy) di frame (0..1) tetap di tempat
  function zoomTo(z, fx = 0.5, fy = 0.5) {
    const c = edit.crop, a = c.w / c.h;
    const w = fitCrop(a, edit.w, edit.h).w / Math.min(5, Math.max(0.2, z)), h = w / a;
    edit.crop = { x: c.x + fx * (c.w - w), y: c.y + fy * (c.h - h), w, h };
    placeSoon();
  }

  function open(id) {
    const s = slots().find(x => x.id === id);
    edit = s ? { id: s.id, file: null, url: s.image, w: s.imgW, h: s.imgH, crop: { ...s.crop } } : { id: null, file: null, url: '', w: 0, h: 0, crop: null };
    $('vTitle').textContent = s ? 'Edit virtual frame' : 'Tambah virtual frame';
    $('vName').value = s ? s.name : nextSlotName(slots());
    const cur = s?.discordId ?? '', dc = discord();
    const opts = [['', dc ? 'Tidak ada (tidak menyala)' : 'Discord belum tersambung'], ...(dc?.members ?? []).map(m => [m.id, m.name])];
    if (cur && !opts.some(o => o[0] === cur)) opts.push([cur, (s.discordName || 'User') + ' (tidak di channel)']);
    $('vSource').replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
    $('vSource').value = cur;
    $('vBgNone').checked = s?.bg === 'transparent';
    $('vBg').value = s && s.bg !== 'transparent' ? s.bg : '#000000';
    $('vBg').disabled = $('vBgNone').checked;
    $('vFile').value = '';
    error('');
    $('vDialog').showModal();
    render();
  }

  function useFile(f) {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.type)) return error('Format harus PNG, JPG, GIF, atau WebP');
    if (f.size > 8 * 1024 * 1024) return error('Gambar terlalu besar (maks 8 MB)');
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      // frame baru ikut rasio frame acuan; frame lama mempertahankan rasionya dan gambar baru dimuatkan di dalamnya
      const r = ref();
      const a = edit.crop ? edit.crop.w / edit.crop.h : r ? r.place.w / r.place.h : 16 / 9;
      revokeBlob(edit.url); // gambar yang diganti: lepas salinannya dari memori
      Object.assign(edit, { file: f, url, w: img.naturalWidth, h: img.naturalHeight, crop: fitCrop(a, img.naturalWidth, img.naturalHeight) });
      error('');
      render();
    };
    img.onerror = () => { revokeBlob(url); error('File ini bukan gambar yang bisa dibaca'); };
    img.src = url;
  }

  $('vDialog').addEventListener('close', () => revokeBlob(edit?.url));
  $('vCancel').onclick = () => $('vDialog').close();
  $('vDrop').onclick = $('vReplace').onclick = () => $('vFile').click();
  $('vFile').onchange = () => useFile($('vFile').files[0]);
  $('vView').addEventListener('dragover', e => { e.preventDefault(); $('vView').classList.add('over'); });
  $('vView').addEventListener('dragleave', () => $('vView').classList.remove('over'));
  $('vView').addEventListener('drop', e => { e.preventDefault(); $('vView').classList.remove('over'); useFile(e.dataTransfer.files[0]); });
  $('vBg').oninput = () => placeSoon();
  $('vBgNone').onchange = () => { $('vBg').disabled = $('vBgNone').checked; render(); };
  $('vZoom').oninput = e => zoomTo(Number(e.target.value));
  $('vZoomIn').onclick = () => zoomTo(Number($('vZoom').value) * 1.2);
  $('vZoomOut').onclick = () => zoomTo(Number($('vZoom').value) / 1.2);
  $('vFit').onclick = () => { const c = edit.crop; edit.crop = fitCrop(c.w / c.h, edit.w, edit.h); render(); };
  $('vStage').addEventListener('wheel', e => {
    e.preventDefault();
    const r = $('vStage').getBoundingClientRect();
    zoomTo(Number($('vZoom').value) * (e.deltaY < 0 ? 1.1 : 1 / 1.1), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  { // geser gambar di dalam frame
    let drag = null;
    $('vStage').addEventListener('pointerdown', e => {
      const r = $('vStage').getBoundingClientRect(); // ukuran area dibaca sekali per tarikan, bukan tiap gerakan
      drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, crop: { ...edit.crop } };
      e.currentTarget.setPointerCapture(e.pointerId);
    });
    $('vStage').addEventListener('pointermove', e => {
      if (!drag) return;
      const c = drag.crop;
      edit.crop = { ...c, x: c.x - ((e.clientX - drag.x) * c.w) / drag.w, y: c.y - ((e.clientY - drag.y) * c.h) / drag.h };
      placeSoon();
    });
    for (const ev of ['pointerup', 'pointercancel']) $('vStage').addEventListener(ev, () => { drag = null; });
  }
  new ResizeObserver(() => { if ($('vDialog').open && edit?.url) render(); }).observe($('vView'));

  $('vSave').onclick = async () => {
    if (!edit.url) return error('Pilih gambar dulu');
    let url = edit.url;
    if (edit.file) {
      $('vSave').disabled = true;
      try {
        const r = await fetch('/upload', { method: 'POST', body: edit.file, headers: { 'content-type': edit.file.type } });
        if (!r.ok) throw new Error(UPLOAD_ERR[r.status] ?? 'Upload gagal (' + r.status + ')');
        url = (await r.json()).url;
      } catch (e) { return error(e.message === 'Failed to fetch' ? 'Server tidak terhubung' : e.message); } finally { $('vSave').disabled = false; }
    }
    const sel = $('vSource').selectedOptions[0];
    const saved = {
      id: edit.id, image: url, imgW: edit.w, imgH: edit.h, crop: { ...edit.crop },
      bg: $('vBgNone').checked ? 'transparent' : $('vBg').value,
      name: $('vName').value.trim(), discordId: $('vSource').value, discordName: $('vSource').value ? original(sel).replace(' (tidak di channel)', '') : '',
    };
    $('vDialog').close();
    onSave(saved);
  };

  return { open };
}
