// One function for every backend call. In the desktop app it goes over Electron IPC;
// in browser dev mode (npm run dev:web) it goes to the local development shim.

const TYPED = { Float32Array, Uint8Array };

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const encode = (v) =>
  JSON.stringify(v, (_k, val) => {
    if (val instanceof ArrayBuffer) return { __bin: toB64(new Uint8Array(val)), t: 'ArrayBuffer' };
    if (ArrayBuffer.isView(val)) return { __bin: toB64(new Uint8Array(val.buffer, val.byteOffset, val.byteLength)), t: val.constructor.name };
    return val;
  });
const decode = (s) =>
  JSON.parse(s, (_k, val) => {
    if (val && typeof val === 'object' && typeof val.__bin === 'string') {
      const bytes = fromB64(val.__bin);
      return val.t === 'ArrayBuffer' ? bytes.buffer : new (TYPED[val.t] || Uint8Array)(bytes.buffer);
    }
    return val;
  });

export const isDesktop = typeof window !== 'undefined' && !!window.erad;

export async function api(name, payload = {}) {
  let res;
  if (isDesktop) {
    res = await window.erad.invoke(name, payload);
  } else {
    let r;
    try {
      r = await fetch(`/api/${name}`, { method: 'POST', body: encode(payload) });
    } catch {
      throw Object.assign(new Error('The eradnotes backend is not running.'), { code: 'OFFLINE' });
    }
    if (!r.ok) throw Object.assign(new Error('The eradnotes backend is not responding.'), { code: 'OFFLINE' });
    res = decode(await r.text());
  }
  if (!res.ok) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data;
}

/** Desktop-only helpers (folder picker, open data folder). Returns null in browser dev mode. */
export const native = (action, arg) => (isDesktop ? window.erad.native(action, arg) : Promise.resolve(null));
