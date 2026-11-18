// Manages the local Whisper worker process.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const WHISPER_MODELS = {
  tiny: { id: 'Xenova/whisper-tiny', label: 'Tiny — fastest, least accurate', size: '~75 MB' },
  base: { id: 'Xenova/whisper-base', label: 'Base — good balance (recommended)', size: '~110 MB' },
  small: { id: 'Xenova/whisper-small', label: 'Small — more accurate, slower', size: '~360 MB' },
};

export function createTranscriber(modelsDir) {
  let child = null;
  let seq = 0;
  const pending = new Map();
  const state = { status: 'idle', model: null, loaded: 0, total: 0, error: null };

  function ensureChild() {
    if (child && child.connected) return child;
    child = fork(path.join(here, 'whisper-worker.js'), [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    child.on('message', (m) => {
      if (m.type === 'progress') {
        state.loaded = m.loaded;
        state.total = m.total;
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new AppError(m.error, 'TRANSCRIBE_FAILED'));
    });
    child.on('exit', (code) => {
      for (const p of pending.values()) p.reject(new AppError(`The speech engine stopped unexpectedly (code ${code}). ${stderr.split('\n').slice(-3).join(' ')}`, 'TRANSCRIBE_FAILED'));
      pending.clear();
      child = null;
      if (state.status !== 'error') Object.assign(state, { status: 'idle', model: null });
    });
    return child;
  }

  const call = (msg) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ensureChild().send({ ...msg, id });
    });

  let loading = null;

  return {
    status() {
      const cached = {};
      for (const [k, m] of Object.entries(WHISPER_MODELS)) cached[k] = fs.existsSync(path.join(modelsDir, ...m.id.split('/'), 'onnx'));
      return { ...state, cached, models: WHISPER_MODELS };
    },
    async load(modelKey) {
      const m = WHISPER_MODELS[modelKey] || WHISPER_MODELS.base;
      if (state.status === 'ready' && state.model === modelKey) return;
      if (loading) await loading.catch(() => {});
      if (state.status === 'ready' && state.model === modelKey) return;
      Object.assign(state, { status: 'loading', model: modelKey, loaded: 0, total: 0, error: null });
      loading = call({ type: 'load', model: m.id, cacheDir: modelsDir });
      try {
        await loading;
        state.status = 'ready';
      } catch (e) {
        const offline = /fetch failed|ENOTFOUND|network|getaddrinfo|ECONN/i.test(e.message);
        state.status = 'error';
        state.error = offline
          ? `The ${modelKey} speech model has not been downloaded yet and the internet is unreachable. Connect once to download it (${m.size}); after that transcription works offline.`
          : e.message;
        throw new AppError(state.error, 'TRANSCRIBE_FAILED');
      } finally {
        loading = null;
      }
    },
    transcribe(pcm, language) {
      if (state.status !== 'ready') throw new AppError('The speech model is not loaded yet.', 'TRANSCRIBE_FAILED');
      return call({ type: 'transcribe', pcm, language });
    },
    dispose() {
      child?.kill();
      child = null;
    },
  };
}
