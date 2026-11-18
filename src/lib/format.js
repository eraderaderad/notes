import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

export const cn = (...a) => a.filter(Boolean).join(' ');

export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400 && d.getDate() === new Date().getDate()) return `today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (diff < 172800) return `yesterday, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function fmtBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const wordCount = (text) => (text.trim().match(/\S+/g) || []).length;

marked.setOptions({ gfm: true, breaks: false });
export const mdToHtml = (md) => DOMPurify.sanitize(marked.parse(md || ''));
export const sanitize = (html) => DOMPurify.sanitize(html || '');

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.addRule('taskItem', {
  filter: (node) => node.nodeName === 'LI' && node.hasAttribute('data-checked'),
  replacement: (content, node) => `- [${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim()}\n`,
});
turndown.addRule('mark', { filter: 'mark', replacement: (c) => `==${c}==` });
export const htmlToMd = (html) => turndown.turndown(html || '');

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const textToHtml = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

export const safeFileName = (s) => String(s || 'untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);

export function download(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Export a piece of rich text in the chosen format (md | html | txt). */
export function exportContent({ title, html, text }, format) {
  const base = safeFileName(title);
  if (format === 'html') download(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><h1>${escapeHtml(title)}</h1>\n${html}`, `${base}.html`, 'text/html');
  else if (format === 'txt') download(`${title}\n\n${text}`, `${base}.txt`, 'text/plain');
  else download(`# ${title}\n\n${htmlToMd(html)}\n`, `${base}.md`, 'text/markdown');
}

export const TYPE_LABEL = { note: 'Note', recording: 'Recording', document: 'Document', glossary: 'Term', study: 'Study set' };
