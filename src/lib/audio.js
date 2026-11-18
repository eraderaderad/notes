// Microphone recording, audio decoding and the local transcription pipeline.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../api.js';

const SR = 16000;

// ---------- tiny event bus so pages refresh when background work finishes ----------
const bus = new EventTarget();
export const emit = (topic) => bus.dispatchEvent(new CustomEvent(topic));
export function useBus(topic, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    bus.addEventListener(topic, h);
    return () => bus.removeEventListener(topic, h);
  }, [topic]);
}

// ---------- decoding ----------
/** Decode any audio the browser engine supports (WAV, MP3, M4A, OGG, WebM, FLAC…) to 16 kHz mono. */
export async function decodeTo16k(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, SR);
  let buf;
  try {
    buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error('This audio file could not be decoded. It may be corrupted or in an unsupported format.');
  }
  let pcm = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) {
    pcm = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) pcm[i] += d[i] / buf.numberOfChannels;
    }
  }
  return { pcm, duration: buf.duration };
}

/** Split into pieces of at most 28 s, cutting at the quietest moment near each boundary so words are not split. */
function cutPoints(pcm) {
  const MAX = 28 * SR;
  const WIN = Math.floor(0.3 * SR);
  const out = [];
  let pos = 0;
  while (pos < pcm.length) {
    let end = Math.min(pos + MAX, pcm.length);
    if (end < pcm.length) {
      let best = end;
      let bestE = Infinity;
      for (let s = end - 6 * SR; s + WIN <= end; s += Math.floor(0.1 * SR)) {
        let e = 0;
        for (let i = s; i < s + WIN; i += 8) e += pcm[i] * pcm[i];
        if (e < bestE) {
          bestE = e;
          best = s + (WIN >> 1);
        }
      }
      end = best;
    }
    out.push([pos, end]);
    pos = end;
  }
  return out;
}

const rms = (pcm, a, b) => {
  let e = 0;
  for (let i = a; i < b; i += 4) e += pcm[i] * pcm[i];
  return Math.sqrt(e / Math.max(1, (b - a) / 4));
};

/** Group timestamped segments into paragraphs using pauses and sentence endings. */
export function paragraphize(segments) {
  let p = 0;
  let chars = 0;
  let prev = null;
  return segments.map((s) => {
    if (prev) {
      const gap = s.start - (prev.end ?? prev.start);
      const sentenceEnd = /[.!?…]["')\]]?\s*$/.test(prev.text);
      if ((gap >= 1.5 && chars >= 200) || (chars >= 600 && sentenceEnd) || chars >= 1200) {
        p++;
        chars = 0;
      }
    }
    chars += s.text.length;
    prev = s;
    return { ...s, p };
  });
}

// ---------- transcription jobs ----------
const jobs = new Map();
const subs = new Set();
const setJob = (id, patch) => {
  jobs.set(id, { ...(jobs.get(id) || {}), ...patch });
  subs.forEach((f) => f());
};
const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const useJob = (id) => useSyncExternalStore(subscribe, () => jobs.get(id) || null);
export const isTranscribing = (id) => {
  const j = jobs.get(id);
  return !!j && j.stage !== 'done' && j.stage !== 'error';
};

/**
 * Transcribe a saved recording with the local Whisper model.
 * Runs in the background; progress is published through useJob(id).
 */
export async function transcribeRecording(id, { settings, aiReady, audio = null }) {
  if (isTranscribing(id)) return;
  setJob(id, { stage: 'audio', progress: 0, message: 'Reading audio…', error: null });
  try {
    await api('recordings.update', { id, status: 'transcribing' });
    emit('recordings');
    if (!audio) audio = (await api('recordings.audio', { id })).data;
    const ab = audio instanceof ArrayBuffer ? audio : audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
    const { pcm, duration } = await decodeTo16k(ab);

    setJob(id, { stage: 'model', message: 'Loading speech model…' });
    const poll = setInterval(async () => {
      try {
        const s = await api('transcribe.status');
        if (s.status === 'loading' && s.total) setJob(id, { message: `Downloading speech model… ${Math.round((s.loaded / s.total) * 100)}%`, progress: s.loaded / s.total });
      } catch {}
    }, 700);
    try {
      await api('transcribe.load', { model: settings.whisperModel });
    } finally {
      clearInterval(poll);
    }

    const cuts = cutPoints(pcm);
    const segments = [];
    for (let i = 0; i < cuts.length; i++) {
      const [a, b] = cuts[i];
      setJob(id, { stage: 'transcribing', progress: i / cuts.length, message: `Transcribing… ${Math.round((i / cuts.length) * 100)}%` });
      if (rms(pcm, a, b) < 0.0015) continue; // silence: skip, Whisper invents text on silent audio
      const out = await api('transcribe.chunk', { pcm: pcm.slice(a, b), language: settings.transcribeLanguage });
      const off = a / SR;
      const len = (b - a) / SR;
      for (const c of out.chunks) {
        const text = c.text.replace(/\[BLANK_AUDIO\]|\(silence\)/gi, '').trim();
        if (!text) continue;
        const start = Math.min(c.start ?? 0, len);
        segments.push({ start: +(off + start).toFixed(2), end: +(off + Math.min(c.end ?? len, len)).toFixed(2), text });
      }
    }
    await api('recordings.update', { id, segments: paragraphize(segments), language: settings.transcribeLanguage, duration: +duration.toFixed(2) });
    emit('recordings');

    let termsAdded = 0;
    if (settings.autoTerms && aiReady && segments.length) {
      setJob(id, { stage: 'terms', progress: 1, message: 'Identifying key terms…' });
      try {
        termsAdded = (await api('glossary.extract', { sourceType: 'recording', sourceId: id })).added.length;
        emit('glossary');
      } catch (e) {
        setJob(id, { termsError: e.message });
      }
    }
    setJob(id, { stage: 'done', progress: 1, message: segments.length ? 'Transcription complete' : 'No speech was detected in this recording', termsAdded, empty: !segments.length });
  } catch (e) {
    setJob(id, { stage: 'error', error: e.message, message: e.message });
    try {
      await api('recordings.update', { id, status: 'error' });
    } catch {}
    emit('recordings');
  }
}

// ---------- recorder inputs ----------
async function openMic(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
  } catch (e) {
    if (deviceId && e.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ audio: true });
    if (e.name === 'NotAllowedError') throw new Error('Microphone access was blocked. Allow microphone access for eradnotes in Windows Settings → Privacy → Microphone.');
    if (e.name === 'NotFoundError') throw new Error('No microphone was found. Plug one in, or record System audio only.');
    throw new Error(`Could not start the microphone: ${e.message}`);
  }
}

/** Capture everything Windows is playing (speakers or headphones). In the desktop app this needs no prompt. */
async function openSystemAudio() {
  let s;
  try {
    // Chromium only offers system audio as part of a screen capture; the video track is dropped right away.
    s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('System audio capture was cancelled or blocked.');
    throw new Error(`Could not capture system audio: ${e.message}`);
  }
  s.getVideoTracks().forEach((t) => {
    t.stop();
    s.removeTrack(t);
  });
  if (!s.getAudioTracks().length) throw new Error('No system audio was shared. In the browser picker, choose your entire screen and turn on “Share system audio”.');
  return s;
}

// ---------- recorder ----------
export function useRecorder() {
  const [state, setState] = useState('idle'); // idle | recording | paused
  const [elapsed, setElapsed] = useState(0);
  const [analyser, setAnalyser] = useState(null);
  const r = useRef({});

  const tick = () => {
    const x = r.current;
    setElapsed(x.acc + (x.startedAt ? (performance.now() - x.startedAt) / 1000 : 0));
  };

  /**
   * source: 'mic' (microphone), 'system' (what plays through your speakers/headphones), or 'both' (mixed together).
   */
  async function start(deviceId, source = 'mic') {
    const inputs = [];
    try {
      if (source === 'system' || source === 'both') inputs.push(await openSystemAudio());
      if (source === 'mic' || source === 'both') inputs.push(await openMic(deviceId));
    } catch (e) {
      inputs.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      throw e;
    }
    // Mix every input into one stream, so a single recording holds both your voice and the computer's audio.
    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    for (const s of inputs) {
      const node = ac.createMediaStreamSource(s);
      node.connect(dest);
      node.connect(an);
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stream = { getTracks: () => inputs.flatMap((s) => s.getTracks()) };
    r.current = { rec, stream, chunks, ac, acc: 0, startedAt: performance.now(), timer: setInterval(tick, 200), mime: rec.mimeType || 'audio/webm' };
    rec.start(1000);
    setAnalyser(an);
    setElapsed(0);
    setState('recording');
  }
  function pause() {
    const x = r.current;
    if (x.rec?.state !== 'recording') return;
    x.rec.pause();
    x.acc += (performance.now() - x.startedAt) / 1000;
    x.startedAt = null;
    tick();
    setState('paused');
  }
  function resume() {
    const x = r.current;
    if (x.rec?.state !== 'paused') return;
    x.rec.resume();
    x.startedAt = performance.now();
    setState('recording');
  }
  function cleanup() {
    const x = r.current;
    clearInterval(x.timer);
    x.stream?.getTracks().forEach((t) => t.stop());
    x.ac?.close().catch(() => {});
    setAnalyser(null);
    setState('idle');
  }
  function stop() {
    const x = r.current;
    if (!x.rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      const duration = x.acc + (x.startedAt ? (performance.now() - x.startedAt) / 1000 : 0);
      x.rec.onstop = () => {
        const blob = new Blob(x.chunks, { type: x.mime });
        cleanup();
        r.current = {};
        resolve({ blob, duration, mime: x.mime.split(';')[0], ext: x.mime.includes('ogg') ? 'ogg' : 'webm' });
      };
      x.rec.stop();
    });
  }
  function cancel() {
    const x = r.current;
    if (!x.rec) return;
    x.rec.onstop = null;
    try {
      x.rec.stop();
    } catch {}
    cleanup();
    r.current = {};
    setElapsed(0);
  }
  useEffect(() => () => cancel(), []);
  return { state, elapsed, analyser, start, pause, resume, stop, cancel };
}
