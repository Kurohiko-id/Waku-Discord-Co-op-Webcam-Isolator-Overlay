// Update aplikasi (hanya di aplikasi Electron; unduh/pasang di versi installer): kotak di tab Atur, chip di bar atas,
// dan popup dengan catatan rilis dari GitHub.
import { getLang } from '/shared/i18n.js';

const $ = id => document.getElementById(id);

export async function initUpdates({ armed }) {
  if (!window.wakuApp?.update) return;
  $('updBox').hidden = false;
  const show = s => {
    const v = s.version ?? '';
    const info = {
      dev: 'Update hanya tersedia di versi installer.', idle: 'Belum dicek.', checking: 'Mengecek update...', none: 'Waku sudah versi terbaru.',
      available: 'Versi ' + v + ' tersedia.', downloading: 'Mengunduh versi ' + v + '... ' + (s.percent ?? 0) + '%',
      ready: 'Versi ' + v + ' siap dipasang. Waku akan ditutup sebentar lalu terbuka lagi; capture perlu diulang.',
      error: 'Gagal: ' + (s.msg ?? ''),
    };
    $('updInfo').textContent = info[s.status] ?? '';
    const b = $('updBtn');
    b.hidden = s.status === 'dev';
    b.disabled = s.status === 'checking' || s.status === 'downloading';
    b.classList.remove('armed');
    b.textContent = s.status === 'available' ? 'Lihat versi ' + v : s.status === 'ready' ? 'Restart & pasang' : 'Cek update';
    $('updChip').hidden = !['available', 'downloading', 'ready'].includes(s.status) || (s.status === 'available' && s.skipped);
    $('updState').textContent = s.status === 'downloading' ? (s.percent ?? 0) + '%' : s.status === 'ready' ? 'siap' : 'v' + v;
    $('updState').className = s.status === 'ready' ? 'on' : 'wait';
    if ($('updDlg').open) updPopup(s);
    if (s.prompt) { updPopup(s); $('updDlg').showModal(); window.wakuApp.update('seen'); }
  };
  // Popup update: versi sekarang, versi terbaru, dan catatan rilis dari GitHub (bagian bahasa yang aktif).
  let last = {};
  const updPopup = s => {
    last = s;
    const v = s.version ?? '', has = ['available', 'downloading', 'ready'].includes(s.status);
    $('updCur').textContent = s.current ? 'v' + s.current : '-';
    $('updNew').textContent = has ? 'v' + v : s.status === 'none' && s.current ? 'v' + s.current : '-';
    $('updNew').className = has ? 'new' : '';
    $('updMsg').textContent = {
      checking: 'Mengecek update...', none: 'Waku sudah versi terbaru.', available: 'Versi ' + v + ' tersedia.',
      downloading: 'Mengunduh versi ' + v + '... ' + (s.percent ?? 0) + '%',
      ready: 'Versi ' + v + ' siap dipasang. Waku akan ditutup sebentar lalu terbuka lagi; capture perlu diulang.',
      error: 'Gagal: ' + (s.msg ?? ''), dev: 'Update hanya tersedia di versi installer.',
    }[s.status] ?? '';
    $('updBar').hidden = s.status !== 'downloading';
    $('updBarFill').style.width = (s.percent ?? 0) + '%';
    const { hl, all } = has ? releaseNotes(s.notes) : { hl: [], all: null };
    $('updHlList').replaceChildren(...hl);
    $('updHl').hidden = !hl.length;
    $('updNotes').replaceChildren(...(all ? [all] : []));
    $('updAll').hidden = !all;
    if (!hl.length) $('updAll').open = true; // tanpa highlight: langsung tampilkan semua perubahan
    const go = $('updGo');
    go.hidden = !['available', 'downloading', 'ready', 'error'].includes(s.status);
    go.disabled = s.status === 'downloading';
    go.classList.remove('armed');
    go.textContent = s.status === 'ready' ? 'Restart & pasang' : s.status === 'error' ? 'Coba lagi' : 'Update';
    $('updSkip').hidden = s.status !== 'available' || !!s.skipped;
    $('updLater').textContent = has ? 'Nanti' : 'Tutup';
  };
  // restart menghentikan capture: klik dua kali
  $('updGo').onclick = () => {
    if (last.status === 'available') window.wakuApp.update('download');
    else if (last.status === 'ready') armed($('updGo'), 'Restart & pasang', 'Klik lagi untuk restart', () => window.wakuApp.update('install'));
    else if (last.status === 'error') window.wakuApp.update('check');
  };
  $('updSkip').onclick = () => { window.wakuApp.update('skip'); $('updDlg').close(); };
  $('updLater').onclick = () => $('updDlg').close();
  const openUpd = async () => {
    const s = await window.wakuApp.update('state');
    updPopup(s);
    $('updDlg').showModal();
    if (['idle', 'none', 'error'].includes(s.status)) window.wakuApp.update('check');
  };
  $('updChip').onclick = openUpd;
  $('updBtn').onclick = openUpd;
  window.wakuApp.onUpdate(show);
  show(await window.wakuApp.update('state'));
}


// Catatan rilis GitHub berupa HTML: hanya tag teks sederhana yang dipakai, sisanya jadi teks biasa.
// Catatan ditulis dua bahasa dengan judul "English" / "Bahasa Indonesia"; tampilkan bagian bahasa yang aktif.
// Daftar di bawah judul "### Highlight" dikumpulkan dari semua versi ke kotak "Alasan kenapa harus update" di atas.
// list = [{ version, note }] semua versi yang terlewat, terbaru dulu.
function releaseNotes(list) {
  const hl = [], all = document.createElement('div');
  for (const { version, note } of Array.isArray(list) ? list : []) {
    const part = noteHtml(note);
    if (!part) continue;
    hl.push(...part.hl);
    if (!part.body.textContent.trim()) continue;
    if (version) { const h = document.createElement('h2'); h.textContent = 'v' + version; all.append(h); }
    all.append(part.body);
  }
  return { hl, all: all.childNodes.length ? all : null };
}
function noteHtml(html) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const OK = new Set(['P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'CODE', 'BR', 'H3']);
  const clean = n => {
    if (n.nodeType === 3) return document.createTextNode(n.data);
    if (n.nodeType !== 1) return null;
    const tag = /^H[2-6]$/.test(n.nodeName) ? 'H3' : n.nodeName;
    const out = OK.has(tag) ? document.createElement(tag) : document.createDocumentFragment();
    for (const c of n.childNodes) { const x = clean(c); if (x) out.append(x); }
    return out;
  };
  const want = getLang() === 'id' ? /indonesia/i : /english/i;
  const head = [...doc.body.querySelectorAll('h2')].find(h => want.test(h.textContent));
  const nodes = [];
  if (head) for (let n = head.nextSibling; n && n.nodeName !== 'H2'; n = n.nextSibling) nodes.push(n);
  else nodes.push(...doc.body.childNodes);
  const hl = [], body = document.createDocumentFragment();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (/^H[3-6]$/.test(n.nodeName) && /highlight/i.test(n.textContent)) {
      let k = i + 1;
      while (k < nodes.length && nodes[k].nodeType !== 1) k++;
      if (nodes[k]?.nodeName === 'UL' || nodes[k]?.nodeName === 'OL') {
        for (const li of nodes[k].children) hl.push(clean(li));
        i = k;
      }
      continue;
    }
    const x = clean(n);
    if (x) body.append(x);
  }
  return { hl, body };
}
