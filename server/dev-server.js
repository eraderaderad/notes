// Development-only HTTP shim so the UI can be run and tested in a plain browser.
// The packaged app does NOT use this: Electron talks to the backend over IPC and opens no ports.
import http from 'node:http';
import { createBackend } from './index.js';

const TYPED = { Float32Array, Uint8Array };

export const encode = (v) =>
  JSON.stringify(v, (_k, val) => {
    if (val instanceof ArrayBuffer) return { __bin: Buffer.from(val).toString('base64'), t: 'ArrayBuffer' };
    if (ArrayBuffer.isView(val) && !Buffer.isBuffer(val)) return { __bin: Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('base64'), t: val.constructor.name };
    return val;
  });

export const decode = (s) =>
  JSON.parse(s, (_k, val) => {
    if (val && typeof val === 'object' && typeof val.__bin === 'string') {
      const b = Buffer.from(val.__bin, 'base64');
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      return val.t === 'ArrayBuffer' ? ab : new (TYPED[val.t] || Uint8Array)(ab);
    }
    return val;
  });

export function startDevServer({ dataDir, port = 5174 }) {
  const backend = createBackend({ dataDir });
  const server = http.createServer((req, res) => {
    const m = req.url.match(/^\/api\/([\w.]+)$/);
    if (req.method !== 'POST' || !m) {
      res.writeHead(404).end();
      return;
    }
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', async () => {
      let out;
      try {
        const body = Buffer.concat(parts).toString('utf8');
        out = await backend.call(m[1], body ? decode(body) : {});
      } catch (e) {
        out = { ok: false, error: { message: e.message, code: 'ERROR' } };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(encode(out));
    });
  });
  server.listen(port, '127.0.0.1');
  setInterval(() => backend.call('backup.auto'), 30 * 60e3).unref();
  return { backend, server };
}
