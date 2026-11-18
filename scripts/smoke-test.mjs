// Backend smoke test: node scripts/smoke-test.mjs
// Uses a throwaway data folder. AI calls go to a local stand-in endpoint that exists ONLY in this
// test, to prove the request/parse/store plumbing; it is not part of the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import JSZip from 'jszip';
import { createBackend } from '../server/index.js';
import { decode, encode } from '../server/dev-server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eradnotes-test-'));
const be = createBackend({ dataDir: dir });
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
};
const call = async (name, payload) => {
  const r = await be.call(name, payload);
  if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data;
};
const fails = async (name, payload) => (await be.call(name, payload)).error?.code;

// ---- notes / subjects ----
const subj = await call('subjects.create', { name: 'Networking' });
const note = await call('notes.create', { title: 'Subnetting basics', subjectId: subj.id, tags: ['exam', 'week1'] });
await call('notes.update', { id: note.id, html: '<p>A subnet mask splits an IP address. DHCP hands out addresses.</p>', text: 'A subnet mask splits an IP address. DHCP hands out addresses.', folder: 'Week 1' });
const got = await call('notes.get', { id: note.id });
ok('note create/update/get', got.folder === 'Week 1' && got.tags.length === 2 && got.content_text.includes('subnet'));
ok('note list by tag', (await call('notes.list', { tag: 'exam' })).length === 1 && (await call('notes.list', { tag: 'nope' })).length === 0);
ok('facets', (await call('notes.facets')).folders[0].folder === 'Week 1');

// ---- documents ----
const mkDocx = async () => {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>The OSI model has seven layers.</w:t></w:r></w:p><w:p><w:r><w:t>Routers work at layer three.</w:t></w:r></w:p></w:body></w:document>`);
  return z.generateAsync({ type: 'uint8array' });
};
const mkPptx = async () => {
  const z = new JSZip();
  const slide = (t) => `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  z.file('ppt/slides/slide1.xml', slide('TCP &amp; UDP compared'));
  z.file('ppt/slides/slide2.xml', slide('UDP is connectionless'));
  return z.generateAsync({ type: 'uint8array' });
};
const mkPdf = () => {
  const stream = 'BT /F1 18 Tf 72 720 Td (Firewalls filter network traffic.) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
};
const docx = await call('documents.import', { name: 'osi.docx', data: await mkDocx(), subjectId: subj.id });
ok('DOCX text extraction', docx.text.includes('seven layers') && docx.text.includes('layer three'), docx.text);
const pptx = await call('documents.import', { name: 'transport.pptx', data: await mkPptx() });
ok('PPTX text extraction', pptx.text.includes('[Slide 1]') && pptx.text.includes('TCP & UDP') && pptx.text.includes('[Slide 2]'), pptx.text);
const pdf = await call('documents.import', { name: 'firewall.pdf', data: mkPdf() });
ok('PDF text extraction', pdf.text.includes('Firewalls filter network traffic'), pdf.text);
const md = await call('documents.import', { name: 'notes.md', data: new TextEncoder().encode('# VLAN\nA VLAN separates broadcast domains.') });
ok('Markdown import', md.type === 'md' && md.text.includes('VLAN'));
ok('original file preserved', (await call('documents.file', { id: docx.id })).name === 'osi.docx' && fs.readdirSync(path.join(dir, 'documents')).length === 4);
ok('unsupported file rejected', (await fails('documents.import', { name: 'x.exe', data: new Uint8Array(3) })) === 'UNSUPPORTED');

// ---- recordings ----
const rec = await call('recordings.create', { title: 'Lecture 1', data: new Uint8Array([1, 2, 3, 4]), mime: 'audio/webm', ext: 'webm', duration: 65 });
await call('recordings.update', { id: rec.id, language: 'english', segments: [{ start: 0, end: 4, text: ' Today we cover subnetting.', p: 0 }, { start: 4, end: 9, text: ' A subnet mask marks the network part.', p: 0 }, { start: 30, end: 36, text: ' Next, DHCP leases.', p: 1 }] });
const rec2 = await call('recordings.get', { id: rec.id });
ok('recording + transcript saved', rec2.status === 'done' && rec2.transcript_text === 'Today we cover subnetting. A subnet mask marks the network part.\n\nNext, DHCP leases.', rec2.transcript_text);
ok('audio kept alongside transcript', (await call('recordings.audio', { id: rec.id })).data.length === 4);

// ---- transport encoding (dev shim) ----
const rt = decode(encode({ a: new Float32Array([0.5, -1]), b: new Uint8Array([7]).buffer }));
ok('binary transport round-trip', rt.a instanceof Float32Array && rt.a[1] === -1 && rt.b instanceof ArrayBuffer);

// ---- search ----
const s1 = await call('search.query', { q: 'subnet mask' });
ok('search notes + transcripts (with timestamp)', s1.some((r) => r.type === 'note') && s1.some((r) => r.type === 'recording' && r.at === 4), JSON.stringify(s1));
ok('search filter by type', (await call('search.query', { q: 'layers', types: ['document'] })).length === 1);
ok('search filter by file type', (await call('search.query', { q: '', fileType: 'pptx' })).length === 1);
ok('search filter by subject', (await call('search.query', { q: '', subjectId: subj.id })).length === 2);

// ---- AI not configured ----
ok('AI gated when unconfigured', (await fails('summaries.create', { sourceType: 'note', sourceId: note.id })) === 'AI_NOT_CONFIGURED');
ok('assistant gated when unconfigured', (await fails('assistant.ask', { question: 'hi' })) === 'AI_NOT_CONFIGURED');

// ---- AI plumbing against a local stand-in endpoint (test only) ----
const seen = [];
const stub = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    const body = JSON.parse(b);
    const sys = body.messages[0].content;
    seen.push(body);
    let content;
    if (sys.includes('"terms"')) content = '```json\n{"terms":[{"term":"DHCP","simple":"Assigns IP addresses automatically.","detailed":"Dynamic Host Configuration Protocol.","example":"Your router.","application":"Home networks.","related":["IP address","DNS"]},{"term":"Subnet mask","simple":"Marks the network part.","detailed":"d","example":"e","application":"a","related":[]}]}\n```';
    else if (sys.includes('"cards"')) content = '{"cards":[{"q":"What does DHCP do?","a":"Assigns IP addresses."},{"q":"","a":"dropped"}]}';
    else if (sys.includes('"questions"')) content = '{"questions":[{"type":"mcq","question":"Pick","options":["A","B","C","D"],"answer":"A","explanation":"x"},{"type":"True/False","question":"UDP is reliable","answer":"false","explanation":"y"},{"type":"identification","question":"Name it","answer":"DHCP","explanation":"z"},{"type":"short","question":"Why?","answer":"Because.","explanation":"w"}]}';
    else if (sys.includes('refine a glossary entry')) content = '{"term":"DHCP","simple":"It gives devices an address.","detailed":"dd","example":"ee","application":"aa","related":["Router"]}';
    else if (sys.includes('explain a term')) content = '{"term":"DNS","simple":"Turns names into addresses.","detailed":"d","example":"e","application":"a","related":[]}';
    else if (sys.includes('personal study tutor')) content = 'Subnetting splits a network [S1]. See also [S2] and [S99].';
    else content = '## Summary\nA short summary.';
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
await call('settings.set', { aiProvider: 'openai', openaiBaseUrl: `http://127.0.0.1:${stub.address().port}/v1`, openaiModel: 'test-model' });
const st = await call('ai.status');
ok('local endpoint needs no key and is not flagged external', st.configured && st.external === false);

const ex = await call('glossary.extract', { sourceType: 'note', sourceId: note.id });
ok('term extraction stores terms', ex.added.length === 2 && ex.added[0].related.length === 2);
const ex2 = await call('glossary.extract', { sourceType: 'recording', sourceId: rec.id });
ok('terms are not explained twice', ex2.added.length === 0 && seen.at(-1).messages[1].content.includes('DHCP, Subnet mask'));
const dh = await call('glossary.get', { term: 'dhcp' });
const re = await call('glossary.reexplain', { id: dh.id, mode: 'simpler' });
ok('simpler explanation', re.simple === 'It gives devices an address.');
ok('explain single term', (await call('glossary.explain', { term: 'DNS' })).simple.startsWith('Turns'));
await call('glossary.save', { term: 'VLAN', simple: 'Virtual LAN', related: 'Switch, Trunk' });
ok('manual glossary entry', (await call('glossary.list', { filter: 'saved' })).some((t) => t.term === 'VLAN' && t.related.length === 2));
ok('duplicate term rejected', (await fails('glossary.save', { term: 'vlan' })) === 'BAD_INPUT');

const sum = await call('summaries.create', { sourceType: 'recording', sourceId: rec.id, style: 'exam' });
ok('summary stored', sum.content.startsWith('## Summary') && (await call('summaries.list', { sourceType: 'recording', sourceId: rec.id })).length === 1);
ok('summary prompt forbids invention', seen.at(-1).messages[0].content.includes('Do not invent'));

const ans = await call('assistant.ask', { question: 'Where was subnetting discussed?', scope: { mode: 'all' } });
ok('assistant returns cited sources only', ans.message.sources.length === 2 && ans.message.sources.every((s) => s.title), JSON.stringify(ans.message.sources));
ok('assistant context has timestamps', seen.at(-1).messages[0].content.includes('[0:04]'));
const scoped = await call('assistant.ask', { chatId: ans.chatId, question: 'And DHCP?', scope: { mode: 'sources', sources: [{ type: 'recording', id: rec.id }] } });
ok('assistant scope + history', scoped.usedChunks === 1 && seen.at(-1).messages.length === 4);
ok('chat persisted', (await call('chats.get', { id: ans.chatId })).messages.length === 4);

const fc = await call('study.generate', { type: 'flashcards', sources: [{ type: 'note', id: note.id }] });
ok('flashcards generated + invalid card dropped', (await call('study.get', { id: fc.id })).data.cards.length === 1);
const qz = await call('study.generate', { type: 'quiz', sources: [{ type: 'recording', id: rec.id }, { type: 'document', id: docx.id }] });
const quiz = await call('study.get', { id: qz.id });
ok('quiz normalised (4 types)', quiz.data.questions.length === 4 && quiz.data.questions[1].type === 'truefalse' && quiz.data.questions[1].answer === 'False' && quiz.sources.length === 2);
const rv = await call('study.generate', { type: 'reviewer', sources: [{ type: 'note', id: note.id }] });
ok('reviewer generated', (await call('study.get', { id: rv.id })).data.content.length > 5);
ok('search finds glossary + study', (await call('search.query', { q: 'DHCP' })).some((r) => r.type === 'glossary') && (await call('search.query', { q: 'DHCP' })).some((r) => r.type === 'study'));
stub.close();

// ---- trash ----
await call('trash.move', { type: 'note', id: note.id });
ok('trash hides note', (await call('notes.list')).length === 0 && (await call('trash.list')).length === 1);
await call('trash.restore', { type: 'note', id: note.id });
ok('restore', (await call('notes.list')).length === 1);
await call('trash.move', { type: 'recording', id: rec.id });
await call('trash.empty');
ok('purge removes audio file', fs.readdirSync(path.join(dir, 'audio')).length === 0);

// ---- stats / backup / export / wipe ----
const stats = await call('dashboard.stats');
ok('dashboard stats', stats.notes === 1 && stats.documents === 4 && stats.terms === 4 && stats.recentTerms.length === 4);
const auto = await call('backup.auto');
ok('automatic backup created', !!auto.name && (await call('backup.auto')).skipped === true);
await call('notes.update', { id: note.id, title: 'CHANGED' });
await call('backup.restore', { name: auto.name });
ok('restore from backup', (await call('notes.get', { id: note.id })).title === 'Subnetting basics' && (await call('backup.list')).length === 2);
const zip = await JSZip.loadAsync((await call('export.all')).data);
ok('export zip', !!zip.file('eradnotes.db') && !!zip.file('notes/Subnetting basics.html') && Object.keys(zip.files).some((f) => f.startsWith('documents/')));
ok('wipe needs confirmation', (await fails('data.wipe', { confirm: 'no' })) === 'BAD_INPUT');
await call('data.wipe', { confirm: 'DELETE' });
ok('wipe deletes everything', (await call('dashboard.stats')).notes === 0 && fs.readdirSync(path.join(dir, 'documents')).length === 0 && (await call('settings.get')).settings.aiProvider === 'none');

be.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
