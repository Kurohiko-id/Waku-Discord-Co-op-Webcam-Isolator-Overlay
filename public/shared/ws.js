// Kode tutup dari server: 4000 = tab ini diambil alih tab control lain, 4001 = tab control lain sudah aktif.
// Keduanya tidak boleh reconnect otomatis, kalau tidak dua tab saling rebut tanpa henti.
const NO_RETRY = { 4000: 'replaced', 4001: 'busy' };

export function connect(role, onMessage, onState) {
  let ws, takeover = false;
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws?role=${role}${takeover ? '&takeover=1' : ''}`);
    takeover = false;
    ws.onopen = () => onState?.(true);
    ws.onmessage = e => {
      try { onMessage(JSON.parse(e.data)); } catch (err) { console.error('pesan WS gagal diproses:', err); }
    };
    ws.onclose = e => {
      if (NO_RETRY[e.code]) return onState?.(false, NO_RETRY[e.code]);
      onState?.(false);
      setTimeout(open, 1000);
    };
  };
  open();
  return {
    send: m => { if (ws.readyState !== 1) return false; ws.send(JSON.stringify(m)); return true; },
    takeover: () => { if (ws.readyState === 3) { takeover = true; open(); } }, // ambil alih dari tab control lain
  };
}
