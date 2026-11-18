// Backend entry: builds the handler table used by both Electron IPC and the dev HTTP shim.
import path from 'node:path';
import { openDb, parseJson } from './db.js';
import { createTranscriber } from './transcriber.js';
import { libraryHandlers } from './handlers-library.js';
import { aiHandlers } from './handlers-ai.js';
import { systemHandlers } from './handlers-system.js';

export const DEFAULT_SETTINGS = {
  theme: 'system',
  micDeviceId: '',
  recordSource: 'mic',
  transcribeLanguage: 'english',
  whisperModel: 'base',
  autoTranscribe: true,
  autoTerms: true,
  aiProvider: 'none',
  anthropicModel: 'claude-opus-5-5',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: '',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: '',
  exportFormat: 'md',
  backupIntervalHours: 24,
  backupKeep: 10,
  lastBackupAt: null,
};

/**
 * @param {{dataDir: string, crypto?: {encrypt(s:string):Buffer, decrypt(b:Buffer):string}}} opts
 * crypto is supplied by Electron (Windows DPAPI via safeStorage). Without it, secrets are kept
 * in memory only and never written to disk.
 */
export function createBackend({ dataDir, crypto = null, version = 'dev' }) {
  let db = openDb(dataDir);
  const memSecrets = new Map();

  const ctx = {
    dataDir,
    version,
    get db() {
      return db;
    },
    reopen() {
      db = openDb(dataDir);
    },
    paths: {
      audio: path.join(dataDir, 'audio'),
      documents: path.join(dataDir, 'documents'),
      backups: path.join(dataDir, 'backups'),
      models: path.join(dataDir, 'models'),
    },
    settings: {
      all() {
        const out = { ...DEFAULT_SETTINGS };
        for (const r of db.all("SELECT key, value FROM settings WHERE key NOT LIKE 'secret.%'")) out[r.key] = parseJson(r.value, null);
        return out;
      },
      set(obj) {
        for (const [k, v] of Object.entries(obj)) {
          if (k.startsWith('secret.')) continue;
          db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
        }
      },
    },
    secrets: {
      persistent: !!crypto,
      has(name) {
        return !!this.get(name);
      },
      get(name) {
        if (!crypto) return memSecrets.get(name) || '';
        const r = db.get('SELECT value FROM settings WHERE key = ?', 'secret.' + name);
        if (!r) return '';
        try {
          return crypto.decrypt(Buffer.from(r.value, 'base64'));
        } catch {
          return '';
        }
      },
      set(name, value) {
        if (!crypto) return void (value ? memSecrets.set(name, value) : memSecrets.delete(name));
        if (!value) return void db.run('DELETE FROM settings WHERE key = ?', 'secret.' + name);
        db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'secret.' + name, crypto.encrypt(value).toString('base64'));
      },
    },
  };
  ctx.transcriber = createTranscriber(ctx.paths.models);

  const handlers = { ...libraryHandlers(ctx), ...aiHandlers(ctx), ...systemHandlers(ctx) };

  return {
    ctx,
    handlers,
    /** Uniform call wrapper: never throws, returns {ok, data} or {ok:false, error}. */
    async call(name, payload) {
      const fn = handlers[name];
      if (!fn) return { ok: false, error: { message: `Unknown action: ${name}`, code: 'UNKNOWN' } };
      try {
        return { ok: true, data: (await fn(payload || {})) ?? null };
      } catch (e) {
        if (!e.code) console.error(`[${name}]`, e);
        return { ok: false, error: { message: e.message || String(e), code: e.code || 'ERROR' } };
      }
    },
    dispose() {
      ctx.transcriber.dispose();
      try {
        db.close();
      } catch {}
    },
  };
}
