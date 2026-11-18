// Real transcription check: node scripts/test-whisper.mjs <16k-mono-16bit.wav> [modelsDir]
import fs from 'node:fs';
import path from 'node:path';
import { createTranscriber } from '../server/transcriber.js';

const wav = fs.readFileSync(process.argv[2]);
const dataAt = wav.indexOf(Buffer.from('data')) + 8;
const pcm16 = new Int16Array(wav.buffer, wav.byteOffset + dataAt, Math.floor((wav.length - dataAt) / 2));
const pcm = Float32Array.from(pcm16, (v) => v / 32768);
const t = createTranscriber(path.resolve(process.argv[3] || '.devdata/models'));
const t0 = Date.now();
const timer = setInterval(() => {
  const s = t.status();
  if (s.status === 'loading' && s.total) process.stdout.write(`\rdownloading ${(s.loaded / 1e6).toFixed(0)}/${(s.total / 1e6).toFixed(0)} MB   `);
}, 1000);
await t.load('base');
clearInterval(timer);
console.log(`\nmodel ready in ${((Date.now() - t0) / 1000).toFixed(1)}s; audio ${(pcm.length / 16000).toFixed(1)}s`);
const t1 = Date.now();
const r = await t.transcribe(pcm, 'english');
console.log(`transcribed in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(r, null, 1));
t.dispose();
