// Setiap teks UI (bahasa Indonesia) di halaman kontrol harus punya terjemahan EN di shared/i18n.js.
// Teks diambil statis: isi teks dan atribut title/aria-label/placeholder di control.html, plus string literal
// yang ditulis JS ke layar (textContent, title, setStatus, pesan error). Teks dinamis lain tidak tercakup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.localStorage ??= { getItem: () => 'en', setItem() {} }; // paksa EN untuk tr()
const { translates } = await import('../public/shared/i18n.js');
const read = f => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

// Bukan kalimat: angka, simbol, nama produk/teknis yang sama di dua bahasa.
// Menu Discord / Developer Portal ditulis persis seperti di aplikasinya (bahasa Inggris).
const KEEP = new Set([
  'OBS', 'Discord', 'Stream Deck', 'ID', 'EN', 'Client ID', 'Client Secret', 'Saweria', 'px', 'fps', 'Mbps', 'URL',
  'Waku', 'WAKU', 'Waku /', 'Waku — Discord Co-op Camera Isolator by Kurohiko', 'Support Dev', 'Support Developer',
  'Capture', 'Frame', 'Preset', 'Template', 'Bitrate', 'FPS', 'Port', 'Window', 'Background', 'Zoom', 'Hotkey',
  'Virtual frame', 'Edit frame...', 'Edit virtual frame',
  'Show Non-Video Participants', 'Show My Own Camera', 'Discord Developer Portal', 'New Application', 'OAuth2',
  'Reset Secret', 'Yes, do it!', 'Redirects', 'Add Redirect', 'Save Changes',
]);
// Potongan yang disambung JS dengan nama/angka ('Edit frame ' + nama) diperiksa lewat PATTERNS, bukan di sini.
const fragment = s => s !== s.trim() || /[("]$|^[,.;:]/.test(s);
const needsText = s => /[a-z]{2}/i.test(s) && !KEEP.has(s) && !fragment(s) && !/^https?:|^[\w.-]+\.(com|co|id)$/i.test(s);

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&minus;/g, '−');

function htmlTexts(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const out = [];
  for (const [, t] of body.matchAll(/>([^<]+)</g)) out.push(decode(t).replace(/\s+/g, ' ').trim());
  for (const [, , v] of body.matchAll(/\s(title|aria-label|placeholder)="([^"]*)"/g)) out.push(decode(v).trim());
  return out;
}

function jsTexts(src) {
  const out = [];
  const lit = `'((?:[^'\\\\\\n]|\\\\.)*)'`;
  const sinks = [
    `(?:textContent|title|placeholder)\\s*=\\s*${lit}`,
    `(?:setStatus|error|vError)\\(${lit}`,
    `(?:textContent|title)\\s*=\\s*[^;\\n]*?\\?\\s*${lit}\\s*:\\s*${lit}`,
  ];
  for (const re of sinks) for (const m of src.matchAll(new RegExp(re, 'g'))) out.push(...m.slice(1).filter(Boolean));
  return out.map(s => s.replace(/\\'/g, "'"));
}

test('semua teks UI halaman kontrol punya terjemahan EN', () => {
  const texts = [
    ...htmlTexts(read('control.html')),
    ...['control.js', 'crop-dialog.js', 'virtual-dialog.js', 'style-form.js'].flatMap(f => jsTexts(read(f))),
  ];
  const missing = [...new Set(texts.filter(needsText).filter(s => !translates(s)))];
  assert.deepEqual(missing, [], 'Tambahkan entri di EN atau PATTERNS (public/shared/i18n.js):\n' + missing.join('\n'));
});
