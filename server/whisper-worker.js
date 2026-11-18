// Runs Whisper locally (ONNX Runtime) in a separate process so the app stays responsive.
// Parent talks to it over IPC with { id, type, ... } messages.
import { pipeline, env } from '@huggingface/transformers';

let asr = null;
let loaded = null;

const send = (m) => process.send?.(m);

async function load(model, cacheDir) {
  if (asr && loaded === model) return;
  env.cacheDir = cacheDir;
  env.allowLocalModels = false;
  asr = null;
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', model, {
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let l = 0;
      let t = 0;
      for (const [a, b] of files.values()) {
        l += a;
        t += b;
      }
      send({ type: 'progress', loaded: l, total: t });
    },
  });
  loaded = model;
}

process.on('message', async (m) => {
  try {
    if (m.type === 'load') {
      await load(m.model, m.cacheDir);
      send({ id: m.id, ok: true });
    } else if (m.type === 'transcribe') {
      if (!asr) throw new Error('Speech model is not loaded');
      const pcm = m.pcm instanceof Float32Array ? m.pcm : new Float32Array(m.pcm);
      const opts = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
      if (m.language && m.language !== 'auto') opts.language = m.language;
      const out = await asr(pcm, opts);
      const chunks = (out.chunks || []).map((c) => ({ start: c.timestamp?.[0] ?? 0, end: c.timestamp?.[1] ?? null, text: c.text }));
      send({ id: m.id, ok: true, result: { text: out.text, chunks } });
    }
  } catch (e) {
    send({ id: m.id, ok: false, error: String(e?.message || e) });
  }
});

send({ type: 'ready' });
