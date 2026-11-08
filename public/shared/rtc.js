// Loopback tanpa STUN/TURN: pengumpulan kandidat selesai hampir instan, jadi kirim satu SDP lengkap
// alih-alih trickle candidate (tidak ada race kandidat-tiba-sebelum-SDP yang bisa hilang diam-diam).
export function iceDone(pc, timeoutMs = 2000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const t = setTimeout(resolve, timeoutMs); // kirim kandidat yang sudah terkumpul
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}
