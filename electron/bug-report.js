// Teks laporan bug siap tempel ke chat/issue: versi, sistem, GPU/encoder, ringkasan sesi terakhir (logsum), error proses utama.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarize, format } from '../tools/logsum.js';
import { logDir } from './settings.js';

const VENDOR = { 0x10de: 'NVIDIA', 0x8086: 'Intel', 0x1002: 'AMD', 0x1414: 'Microsoft' };
const readJsonl = f => { try { return fs.readFileSync(f, 'utf8').split('\n').flatMap(r => { try { return r ? [JSON.parse(r)] : []; } catch { return []; } }); } catch { return []; } };

export async function bugReport({ port, lang }) {
  const lines = ['waku.log.1', 'waku.log'].flatMap(f => readJsonl(path.join(logDir(), f)));
  const m = lines.findLast(l => l.src === 'control' && l.event === 'metrics' && l.codec);
  const gpu = await app.getGPUInfo('basic').catch(() => null);
  const gpus = (gpu?.gpuDevice ?? []).map(d => (VENDOR[d.vendorId] ?? '0x' + d.vendorId.toString(16)) + ' 0x' + d.deviceId.toString(16)).join(', ');
  const main = readJsonl(path.join(logDir(), 'main.log')).filter(l => l.event !== 'app_start').slice(-8).map(l => `  ${l.t} ${l.event}${l.code !== undefined ? ' kode ' + l.code : ''}${l.reason ? ' ' + l.reason : ''}${l.msg ? ': ' + l.msg.split('\n')[0] : ''}`);
  return [
    `Waku ${app.getVersion()} · Electron ${process.versions.electron} (Chrome ${process.versions.chrome}) · ${os.type()} ${os.release()} ${os.arch()}`,
    `GPU: ${gpus || '?'}`,
    `Encoder: ${m ? `${m.codec} · ${m.enc ?? '?'} · hardware ${m.hwEnc ?? '?'}` : 'belum ada data (capture belum pernah jalan)'}`,
    `Port: ${port} · Bahasa: ${lang}`,
    '',
    format(summarize(lines.slice(-3000))), // beberapa sesi terakhir: setelah crash, sesi yang penting biasanya sebelum restart
    '',
    'Proses utama (terakhir):',
    ...(main.length ? main : ['  tidak ada error']),
  ].join('\n');
}
