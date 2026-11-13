import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { scrub } = createRequire(import.meta.url)('../electron/kuro-stats.cjs');

test('scrub: path absolut jadi nama file saja (huruf besar/kecil, file:///, di luar home, nama ter-encode)', () => {
  const out = scrub([
    'at f (file:///C:/Users/Jos%C3%A9%20M/AppData/Local/Programs/Waku/resources/app.asar/server.js:10:5)',
    String.raw`EPERM: open 'c:\users\budi santoso\appdata\roaming\Waku\layout.json'`,
    String.raw`at g (D:\Andi Wijaya\Waku\resources\app.asar\electron\main.js:3:1)`,
  ].join('\n'), 'budi santoso');
  for (const bad of ['Jos', 'budi', 'Andi', 'Users', 'users', 'AppData', 'appdata']) assert.ok(!out.includes(bad), bad + ' bocor: ' + out);
  for (const keep of ['server.js:10:5', 'layout.json', 'main.js:3:1', 'EPERM']) assert.ok(out.includes(keep), keep);
});
