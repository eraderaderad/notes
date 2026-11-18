// Text extraction for imported documents. Everything runs locally.
import path from 'node:path';
import { AppError } from './ai.js';

export const DOC_TYPES = ['pdf', 'docx', 'pptx', 'txt', 'md'];
export const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'ogg', 'oga', 'webm', 'flac', 'aac', 'mp4', 'opus'];

export function fileKind(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (ext === 'markdown') return { kind: 'document', type: 'md' };
  if (DOC_TYPES.includes(ext)) return { kind: 'document', type: ext };
  if (AUDIO_EXT.includes(ext)) return { kind: 'audio', type: ext };
  return { kind: 'unknown', type: ext };
}

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

async function extractPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    let lastY = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
      else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
    }
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text) pages.push(`[Page ${i}]\n${text}`);
  }
  await task.destroy();
  return pages.join('\n\n');
}

async function extractDocx(buf) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPptx(buf) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x) => x.m)
    .sort((a, b) => +a.m[1] - +b.m[1]);
  const out = [];
  for (const { n, m } of slides) {
    const xml = await zip.files[n].async('string');
    const paras = [];
    for (const p of xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || []) {
      const line = (p.match(/<a:t[^>]*>[\s\S]*?<\/a:t>/g) || []).map((t) => decodeXml(t.replace(/<[^>]+>/g, ''))).join('');
      if (line.trim()) paras.push(line.trim());
    }
    let notes = '';
    const noteFile = zip.files[`ppt/notesSlides/notesSlide${m[1]}.xml`];
    if (noteFile) {
      const nx = await noteFile.async('string');
      notes = (nx.match(/<a:t[^>]*>[\s\S]*?<\/a:t>/g) || [])
        .map((t) => decodeXml(t.replace(/<[^>]+>/g, '')))
        .filter((t) => !/^\d+$/.test(t.trim()))
        .join(' ')
        .trim();
    }
    if (paras.length || notes) out.push(`[Slide ${m[1]}]\n${paras.join('\n')}${notes ? `\nSpeaker notes: ${notes}` : ''}`);
  }
  return out.join('\n\n');
}

export async function extractText(type, buf) {
  try {
    if (type === 'pdf') return await extractPdf(buf);
    if (type === 'docx') return await extractDocx(buf);
    if (type === 'pptx') return await extractPptx(buf);
    if (type === 'txt' || type === 'md') return Buffer.from(buf).toString('utf8').replace(/^﻿/, '').trim();
  } catch (e) {
    throw new AppError(`Could not read this ${type.toUpperCase()} file: ${e.message}`, 'EXTRACT_FAILED');
  }
  throw new AppError(`Unsupported document type: .${type}`, 'UNSUPPORTED');
}
