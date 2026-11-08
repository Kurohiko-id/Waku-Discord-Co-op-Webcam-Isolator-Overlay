// Alat developer (npm run app:check): codec apa yang dipakai WebRTC dan apakah encoder-nya hardware.
// Hanya dimuat saat dev; tidak ikut ke installer (lihat build.files di package.json).
import { app, BrowserWindow } from 'electron';
import http from 'node:http';

// Loopback WebRTC dari canvas.
const ENCODER_PROBE = `(async () => {
  const cam = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null); // tetap hidup selama cek
  const c = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 });
  const g = c.getContext('2d');
  let i = 0;
  const t = setInterval(() => { g.fillStyle = 'hsl(' + (i++ % 360) + ' 70% 45%)'; g.fillRect(0, 0, 1920, 1080); g.fillStyle = '#fff'; g.font = '200px sans-serif'; g.fillText(i, 100 + (i * 7) % 1400, 600); }, 33);
  const stream = c.captureStream(30);
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate);
  const tr = a.addTransceiver(stream.getVideoTracks()[0], { direction: 'sendonly' });
  const caps = RTCRtpSender.getCapabilities('video').codecs;
  const h264 = caps.filter(x => x.mimeType === 'video/H264');
  if (h264.length) tr.setCodecPreferences([...h264, ...caps.filter(x => x.mimeType !== 'video/H264')]);
  await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
  await new Promise(r => setTimeout(r, 5000));
  const st = [...(await a.getStats()).values()];
  const o = st.find(x => x.type === 'outbound-rtp');
  const mc = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: 'video/H264;profile-level-id=42e01f;packetization-mode=1', width: 1920, height: 1080, bitrate: 8e6, framerate: 30 } }).catch(e => ({ error: String(e) }));
  clearInterval(t); a.close(); b.close(); cam?.getTracks().forEach(x => x.stop());
  return {
    codecsAvailable: [...new Set(caps.map(x => x.mimeType))],
    codecUsed: st.find(x => x.id === o?.codecId)?.mimeType,
    encoderImplementation: o?.encoderImplementation, powerEfficientEncoder: o?.powerEfficientEncoder,
    fps: o?.framesPerSecond, framesEncoded: o?.framesEncoded, qualityLimitationReason: o?.qualityLimitationReason,
    h264EncodingInfo: mc,
  };
})()`;

export async function encoderCheck() {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  // localhost = secure context (about:blank tidak punya mediaDevices)
  const blank = http.createServer((_q, s) => s.end('<!doctype html><title>cek</title>'));
  await new Promise(r => blank.listen(0, '127.0.0.1', r));
  await w.loadURL(`http://localhost:${blank.address().port}/`);
  const result = await w.webContents.executeJavaScript(ENCODER_PROBE);
  blank.close();
  const gpu = await app.getGPUInfo('basic').catch(() => null);
  console.log(JSON.stringify({
    electron: process.versions.electron, chrome: process.versions.chrome,
    gpu: gpu?.gpuDevice?.map(d => ({ vendor: d.vendorId, device: d.deviceId, active: d.active, desc: d.driverVendor ?? d.description })),
    gpuFeatures: Object.fromEntries(Object.entries(app.getGPUFeatureStatus()).filter(([k]) => /video|webrtc|gpu_compositing/i.test(k))),
    ...result,
  }, null, 2));
  app.exit(0);
}
