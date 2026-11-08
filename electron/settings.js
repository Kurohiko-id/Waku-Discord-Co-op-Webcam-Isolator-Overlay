// Pengaturan aplikasi (userData/settings.json) dan log proses utama (userData/logs/main.log).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Log proses utama (crash, server mati, error tak tertangani), JSON per baris.
// Terpisah dari waku.log milik server supaya rotasi keduanya tidak saling ganggu. Tidak pernah berisi token/secret.
export const logDir = () => path.join(app.getPath('userData'), 'logs');
export function mainLog(event, data = {}) {
  try {
    const file = path.join(logDir(), 'main.log');
    fs.mkdirSync(logDir(), { recursive: true });
    try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.1'); } catch { /* belum ada */ }
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), src: 'main', event, ...data }) + '\n');
  } catch { /* log tidak boleh mengganggu aplikasi */ }
}
export const errMsg = e => String(e?.stack ?? e).slice(0, 500);

// Dibaca dari disk sekali, lalu dari memori; hanya aplikasi ini yang menulis berkasnya.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let cache = null;
export const readSettings = () => {
  if (!cache) try { cache = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { cache = {}; }
  return cache;
};
export const saveSettings = s => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const next = { ...readSettings(), ...s };
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  cache = next; // baru dipakai setelah berhasil ditulis
};
