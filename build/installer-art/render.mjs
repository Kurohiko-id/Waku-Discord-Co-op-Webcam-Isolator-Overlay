// Re-render the installer art from art.html into 24-bit BMPs (NSIS loads BMP only):
//   build/installerSidebar.bmp            side panel (electron-builder picks it up by name)
//   build/installer-art/<id>.bmp          finish-page cards, used by build/installer.nsh
// Run: node build/installer-art/render.mjs   (needs Google Chrome; output is committed, the build does not render)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9347;
const SHOTS = [
  ['side', 164, 314, path.join(DIR, '..', 'installerSidebar.bmp')],
  ...['support-en', 'topup-en', 'support-id', 'topup-id'].map(id => [id, 292, 40, path.join(DIR, id + '.bmp')]),
];

// 24-bit bottom-up BMP from RGBA pixels.
function bmp(rgba, w, h) {
  const row = Math.ceil(w * 3 / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = 54 + (h - 1 - y) * row + x * 3;
    buf[d] = rgba[s + 2]; buf[d + 1] = rgba[s + 1]; buf[d + 2] = rgba[s];
  }
  return buf;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'waku-art-'));
const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank']);
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await new Promise(r => setTimeout(r, 200));
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json()).then(l => l.find(t => t.type === 'page')).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.once('open', r));
  let id = 0;
  const send = (method, params = {}) => new Promise(res => {
    const my = ++id;
    ws.on('message', function h(m) { const d = JSON.parse(m); if (d.id === my) { ws.off('message', h); res(d.result); } });
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 400, deviceScaleFactor: 1, mobile: false });
  for (const [name, w, h, out] of SHOTS) {
    await send('Page.navigate', { url: pathToFileURL(path.join(DIR, 'art.html')).href + '?' + name + '#' + name });
    await new Promise(r => setTimeout(r, 600));
    await ev('document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode())))');
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    // Decode the PNG in the page itself, no image library needed.
    const px = await ev(`(async () => {
      const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
      const c = new OffscreenCanvas(${w}, ${h}).getContext('2d'); c.drawImage(img, 0, 0);
      const a = c.getImageData(0, 0, ${w}, ${h}).data; let s = '';
      for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192));
      return btoa(s);
    })()`);
    fs.writeFileSync(out, bmp(Buffer.from(px, 'base64'), w, h));
    fs.writeFileSync(path.join(os.tmpdir(), 'waku-art-' + name + '.png'), Buffer.from(data, 'base64')); // preview
    console.log('wrote', path.relative(process.cwd(), out));
  }
  ws.close();
} finally {
  chrome.kill();
}
