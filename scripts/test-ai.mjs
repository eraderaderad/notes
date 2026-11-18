// Runs every AI feature against a REAL model using a throwaway data folder.
// Usage: node scripts/test-ai.mjs [ollama-model]   (default llama3.1:8b, Ollama at localhost:11434)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackend } from '../server/index.js';

const model = process.argv[2] || 'llama3.1:8b';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eradnotes-aitest-'));
const be = createBackend({ dataDir: dir });
const call = async (name, payload) => {
  const t = Date.now();
  const r = await be.call(name, payload);
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (!r.ok) throw new Error(`${name} failed after ${secs}s: ${r.error.message}`);
  return { data: r.data, secs };
};

let failed = 0;
async function step(label, fn) {
  try {
    console.log(`\n== ${label}`);
    await fn();
  } catch (e) {
    failed++;
    console.log(`FAILED: ${e.message}`);
  }
}

await call('settings.set', { aiProvider: 'ollama', ollamaModel: model });
const lecture = `Today we will talk about computer networking. The Dynamic Host Configuration Protocol, or DHCP, automatically assigns IP addresses to devices on a network. Next, we compare TCP and UDP. TCP is connection-oriented and reliable, while UDP is faster but does not guarantee delivery. Finally, subnetting divides a large network into smaller networks using a subnet mask.`;
const note = (await call('notes.create', { title: 'Networking lecture notes', html: `<p>${lecture}</p>`, text: lecture })).data;

await step('connection test', async () => {
  const r = await call('ai.test');
  console.log(`${r.secs}s -> ${r.data.reply}`);
});
await step('term extraction', async () => {
  const r = await call('glossary.extract', { sourceType: 'note', sourceId: note.id });
  console.log(`${r.secs}s -> ${r.data.added.length} terms: ${r.data.added.map((t) => t.term).join(', ')}`);
  if (r.data.added[0]) console.log(`   e.g. ${r.data.added[0].term}: ${r.data.added[0].simple}`);
  if (!r.data.added.length) throw new Error('no terms found');
});
await step('simpler explanation', async () => {
  const t = (await call('glossary.list')).data[0];
  const r = await call('glossary.reexplain', { id: t.id, mode: 'simpler' });
  console.log(`${r.secs}s -> ${r.data.term}: ${r.data.simple}`);
});
await step('summary (quick)', async () => {
  const r = await call('summaries.create', { sourceType: 'note', sourceId: note.id, style: 'quick' });
  console.log(`${r.secs}s ->\n${r.data.content.slice(0, 500)}`);
});
await step('flashcards', async () => {
  const r = await call('study.generate', { type: 'flashcards', sources: [{ type: 'note', id: note.id }], count: 5 });
  const s = (await call('study.get', { id: r.data.id })).data;
  console.log(`${r.secs}s -> ${s.data.cards.length} cards, e.g. Q: ${s.data.cards[0].q} / A: ${s.data.cards[0].a}`);
});
await step('quiz', async () => {
  const r = await call('study.generate', { type: 'quiz', sources: [{ type: 'note', id: note.id }], count: 4 });
  const s = (await call('study.get', { id: r.data.id })).data;
  console.log(`${r.secs}s -> ${s.data.questions.length} questions: ${s.data.questions.map((q) => q.type).join(', ')}`);
});
await step('assistant', async () => {
  const r = await call('assistant.ask', { question: 'What is the difference between TCP and UDP?' });
  console.log(`${r.secs}s -> sources cited: ${r.data.message.sources.length}\n${r.data.message.content.slice(0, 400)}`);
});

be.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} step(s) failed` : 'All AI steps passed'}`);
process.exit(failed ? 1 : 0);
