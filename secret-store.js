// Penyimpanan kecil untuk kredensial/token Discord. Sinkron, satu objek JSON per berkas.
// jsonFile: teks biasa (mode `node server.js`).
// encryptedFile: AES-256-GCM dengan kunci dari aplikasi Electron (kunci itu sendiri dilindungi safeStorage/DPAPI).
import fs from 'node:fs';
import crypto from 'node:crypto';

export function jsonFile(file) {
  return {
    unreadable: false,
    read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    write(obj) { fs.writeFileSync(file, JSON.stringify(obj), { mode: 0o600 }); },
    remove() { fs.rmSync(file, { force: true }); },
  };
}

// Format berkas: iv (12 byte) | tag (16 byte) | ciphertext.
// legacy = berkas teks biasa lama: dienkripsi sekali saat pertama dibaca, lalu dihapus.
export function encryptedFile(file, keyB64, legacy) {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('kunci harus 32 byte');
  const store = {
    unreadable: false, // ada berkas tapi tidak bisa dibuka (kunci beda, mis. data dipindah ke PC lain)
    read() {
      let buf;
      try { buf = fs.readFileSync(file); } catch { return migrate(); }
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
        d.setAuthTag(buf.subarray(12, 28));
        const obj = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
        store.unreadable = false;
        return obj;
      } catch {
        store.unreadable = true;
        return null;
      }
    },
    write(obj) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
      fs.writeFileSync(file, Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 });
      store.unreadable = false;
    },
    remove() { fs.rmSync(file, { force: true }); store.unreadable = false; },
  };
  function migrate() {
    if (!legacy) return null;
    let obj;
    try { obj = JSON.parse(fs.readFileSync(legacy, 'utf8')); } catch { return null; }
    store.write(obj);
    fs.rmSync(legacy, { force: true }); // teks biasa tidak boleh tertinggal
    return obj;
  }
  return store;
}
