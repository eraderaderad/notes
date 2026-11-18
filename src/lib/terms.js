// Glossary term matching used for highlighting in notes, transcripts and documents.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One case-insensitive regex matching any known term as a whole word (longest first). */
export function buildTermRegex(terms) {
  const list = [...new Set(terms.map((t) => t.term.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
}

/** Split text into plain and term pieces: [{text, term?: true}] */
export function splitByTerms(text, regex) {
  if (!regex || !text) return [{ text }];
  const out = [];
  let last = 0;
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], term: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) regex.lastIndex++;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
