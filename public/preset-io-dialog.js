// Popup Export / Import preset (tab Atur). Isi file/teks dibuat dan dibaca oleh shared/preset-io.js;
// di sini: pilih preset, ganti nama, gambar virtual frame (disematkan saat export, diunggah saat import).
// presets(): daftar preset sekarang. onImport(list): preset baru (id, nama unik, alamat gambar baru) untuk ditambahkan.
import { buildExport, parseImport, uniqueName } from '/shared/preset-io.js';

const $ = id => document.getElementById(id);
import { MAX_PRESETS, shownSlots } from '/shared/layout.js';
const blobToDataUrl = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });
const dataUrlToBlob = d => { const [, type, b64] = d.match(/^data:(.*?);base64,(.*)$/); return new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type }); };
const fileSafe = s => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'preset';
const imagesOf = presets => new Set(presets.flatMap(p => p.slots).filter(s => s.image).map(s => s.image));

// Baris preset di popup: centang + nama yang bisa diganti (+ catatan, mis. nama diberi v2).
function presetRows(host, items) {
  const rows = items.map(({ preset, name, note }) => {
    const row = document.createElement('div');
    row.className = 'io-row';
    const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
    check.setAttribute('aria-label', 'Pilih preset');
    const input = Object.assign(document.createElement('input'), { type: 'text', value: name, maxLength: 40 });
    input.setAttribute('aria-label', 'Nama preset');
    const count = document.createElement('small');
    count.textContent = shownSlots(preset.slots).length + ' frame';
    row.append(check, input, count);
    if (note) { const n = document.createElement('small'); n.className = 'note'; n.textContent = note; row.append(n); }
    return { preset, check, input, row };
  });
  host.replaceChildren(...rows.map(r => r.row));
  return rows;
}

export function createPresetIoDialogs({ presets, onImport, log, copyText, fmtBytes }) {
  // ---- export: Simpan file atau Salin teks ----
  let exRows = [];
  $('exOpen').onclick = () => {
    const list = presets();
    exRows = presetRows($('exList'), list.map(p => ({ preset: p, name: p.name || 'Tanpa nama' })));
    $('exAccounts').checked = false;
    $('exInfo').textContent = list.length ? '' : 'Belum ada preset untuk diekspor.';
    $('exSave').disabled = !list.length;
    $('exDlg').showModal();
  };
  $('exClose').onclick = () => $('exDlg').close();
  // Isi export dari pilihan di popup (null bila belum ada yang dicentang).
  async function exportData() {
    const picked = exRows.filter(r => r.check.checked);
    if (!picked.length) { $('exInfo').textContent = 'Pilih minimal satu preset.'; return null; }
    const chosen = picked.map(r => r.preset);
    const names = Object.fromEntries(picked.map(r => [r.preset.id, r.input.value]));
    const images = {};
    for (const url of imagesOf(chosen)) {
      try { const r = await fetch(url); if (r.ok) images[url] = await blobToDataUrl(await r.blob()); } catch { /* gambar hilang: preset tetap diekspor */ }
    }
    const data = buildExport(chosen, { names, includeAccounts: $('exAccounts').checked, images });
    const file = 'waku-preset-' + (picked.length === 1 ? fileSafe(data.presets[0].name) : picked.length + '-preset') + '.json';
    log('preset_export', { count: picked.length, images: Object.keys(images).length, accounts: $('exAccounts').checked });
    return { data, file };
  }
  $('exSave').onclick = async () => {
    const x = await exportData();
    if (!x) return;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(x.data, null, 2)], { type: 'application/json' })), download: x.file });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('exInfo').textContent = 'File dibuat: ' + x.file;
  };
  // teks ringkas (tanpa spasi) supaya pendek saat ditempel di chat; teks panjang otomatis jadi lampiran di Discord
  $('exCopy').onclick = async () => {
    const x = await exportData();
    if (!x) return;
    const text = JSON.stringify(x.data);
    $('exInfo').textContent = (await copyText(text)) ? 'Teks JSON disalin (' + fmtBytes(text.length) + '). Tempel di chat untuk dibagikan.' : 'Gagal menyalin, coba Simpan file.';
  };

  // ---- import: dari file atau teks yang ditempel ----
  let imported = null, imRows = [];
  const resetImport = () => { imported = null; imRows = []; $('imList').replaceChildren(); $('imSave').disabled = true; };
  $('imOpen').onclick = () => {
    resetImport();
    $('imInfo').textContent = '';
    $('imFile').value = '';
    $('imText').value = '';
    $('imDlg').showModal();
  };
  $('imClose').onclick = () => $('imDlg').close();
  $('imPick').onclick = () => $('imFile').click();
  $('imFile').onchange = async () => { const f = $('imFile').files[0]; if (f) loadImport(await f.text()); };
  $('imRead').onclick = () => {
    const t = $('imText').value.trim();
    if (!t) { $('imInfo').textContent = 'Tempel teks JSON dulu.'; return; }
    loadImport(t);
  };
  // Tampilkan daftar preset dari file/teks; nama yang bentrok langsung diberi v2, v3, ...
  function loadImport(text) {
    try { imported = parseImport(text); } catch (e) { resetImport(); $('imInfo').textContent = e.message; return; }
    const taken = new Set(presets().map(p => p.name));
    imRows = presetRows($('imList'), imported.presets.map(p => {
      const name = uniqueName(p.name || 'Preset', taken);
      taken.add(name);
      return { preset: p, name, note: name !== p.name ? 'Nama sudah ada, jadi "' + name + '"' : '' };
    }));
    $('imSave').disabled = false;
    $('imInfo').textContent = imported.presets.length + ' preset terbaca.';
  }
  $('imSave').onclick = async () => {
    const picked = imRows.filter(r => r.check.checked);
    if (!picked.length) { $('imInfo').textContent = 'Pilih minimal satu preset.'; return; }
    const room = MAX_PRESETS - presets().length;
    if (picked.length > room) { $('imInfo').textContent = room > 0 ? 'Hanya bisa menambah ' + room + ' preset lagi (maksimal 50).' : 'Sudah 50 preset. Hapus beberapa dulu.'; return; }
    $('imSave').disabled = true;
    const moved = {}; // gambar dari file diunggah ke server; alamat lama -> alamat baru
    for (const url of imagesOf(picked.map(r => r.preset))) {
      const data = imported.images[url];
      if (!data) continue;
      try {
        const blob = dataUrlToBlob(data);
        const r = await fetch('/upload', { method: 'POST', body: blob, headers: { 'content-type': blob.type } });
        if (r.ok) moved[url] = (await r.json()).url;
      } catch { /* gagal unggah: frame itu nanti dilewati saat preset dipakai */ }
    }
    const taken = new Set(presets().map(p => p.name));
    const added = picked.map(r => {
      const name = uniqueName(r.input.value.trim() || r.preset.name || 'Preset', taken); // nama yang diketik sendiri pun tidak boleh bentrok
      taken.add(name);
      return {
        ...structuredClone(r.preset), name, pinned: false,
        id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        slots: r.preset.slots.map(s => (s.image && moved[s.image] ? { ...s, image: moved[s.image] } : s)),
      };
    });
    $('imDlg').close();
    onImport(added);
    log('preset_import', { count: added.length, images: Object.keys(moved).length });
  };
}
