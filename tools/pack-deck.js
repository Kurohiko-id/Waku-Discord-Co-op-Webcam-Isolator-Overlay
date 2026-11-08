// Membungkus plugin Stream Deck menjadi dist/deck/id.kurohiko.waku.streamDeckPlugin (zip berisi folder .sdPlugin).
// File itu ikut di installer Waku; tombol "Pasang plugin Stream Deck" di tab Atur membukanya, lalu aplikasi Stream Deck memasangnya.
// Paket ws (tanpa dependensi) disalin ke dalam plugin karena Node bawaan Stream Deck tidak punya WebSocket client.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAME = 'id.kurohiko.waku';
const out = path.join(root, 'dist', 'deck');
const stage = path.join(out, 'stage');
const plugin = path.join(stage, NAME + '.sdPlugin');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'streamdeck', NAME + '.sdPlugin'), plugin, { recursive: true });
fs.cpSync(path.join(root, 'node_modules', 'ws'), path.join(plugin, 'node_modules', 'ws'), {
  recursive: true,
  filter: src => !/README\.md$/.test(src),
});

const zip = path.join(out, NAME + '.zip');
// tar.exe bawaan Windows 10+ (bsdtar) membuat zip dari ekstensi. Path relatif: GNU tar (Git Bash) membaca huruf drive ("C:") sebagai nama host.
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', path.relative(stage, zip), NAME + '.sdPlugin'], { cwd: stage });
const file = path.join(out, NAME + '.streamDeckPlugin');
fs.renameSync(zip, file);
fs.rmSync(stage, { recursive: true, force: true });
console.log(path.relative(root, file), Math.round(fs.statSync(file).size / 1024) + ' KB');
