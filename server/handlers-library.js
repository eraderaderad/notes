// Notes, subjects, recordings, documents, trash, search and dashboard stats.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { now, parseJson } from './db.js';
import { AppError } from './ai.js';
import { extractText, fileKind } from './extract.js';

export const toBuffer = (x) => {
  if (!x) throw new AppError('No file data received.', 'BAD_INPUT');
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  throw new AppError('Unreadable file data.', 'BAD_INPUT');
};

const tagsOf = (v) => (Array.isArray(v) ? [...new Set(v.map((t) => String(t).trim()).filter(Boolean))] : []);
const like = (q) => '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

export function segmentsToText(segments) {
  const paras = [];
  let cur = null;
  for (const s of segments) {
    if (cur === null || s.p !== cur.p) {
      cur = { p: s.p, parts: [] };
      paras.push(cur);
    }
    cur.parts.push(String(s.text).trim());
  }
  return paras.map((p) => p.parts.join(' ')).join('\n\n');
}

function snippet(text, q, len = 180) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ');
  if (!q) return flat.slice(0, len);
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, len);
  const start = Math.max(0, i - 60);
  return (start > 0 ? '…' : '') + flat.slice(start, start + len) + (start + len < flat.length ? '…' : '');
}

/** Readable text of a study set, for search snippets. */
const studyText = (d) =>
  [...(d.cards || []).map((c) => `Q: ${c.q} A: ${c.a}`), ...(d.questions || []).map((x) => `Q: ${x.question} A: ${x.answer}`), d.content || ''].filter(Boolean).join(' · ');

const TABLES = { note: 'notes', recording: 'recordings', document: 'documents', study: 'study_sets' };

export function libraryHandlers(ctx) {
  const db = () => ctx.db;

  const noteRow = (r) => r && { ...r, tags: parseJson(r.tags, []), favorite: !!r.favorite };
  const recRow = (r, full) => {
    if (!r) return r;
    const o = { ...r, tags: parseJson(r.tags, []), favorite: !!r.favorite };
    if (full) o.segments = parseJson(r.segments, []);
    else delete o.segments;
    return o;
  };
  const docRow = (r) => r && { ...r, tags: parseJson(r.tags, []), favorite: !!r.favorite };

  /** Resolve any library item to plain text for AI features. */
  ctx.sourceText = (type, id) => {
    if (type === 'note') {
      const r = db().get('SELECT id, title, content_text, subject_id FROM notes WHERE id = ?', id);
      if (!r) throw new AppError('That note no longer exists.', 'NOT_FOUND');
      return { type, id, title: r.title, text: r.content_text, subjectId: r.subject_id };
    }
    if (type === 'recording') {
      const r = db().get('SELECT id, title, transcript_text, segments, subject_id FROM recordings WHERE id = ?', id);
      if (!r) throw new AppError('That recording no longer exists.', 'NOT_FOUND');
      return { type, id, title: r.title, text: r.transcript_text, segments: parseJson(r.segments, []), subjectId: r.subject_id };
    }
    if (type === 'document') {
      const r = db().get('SELECT id, title, text, subject_id FROM documents WHERE id = ?', id);
      if (!r) throw new AppError('That document no longer exists.', 'NOT_FOUND');
      return { type, id, title: r.title, text: r.text, subjectId: r.subject_id };
    }
    throw new AppError('Unknown source type.', 'BAD_INPUT');
  };

  return {
    // ---------- subjects ----------
    'subjects.list': () =>
      db().all(`SELECT s.*, (SELECT COUNT(*) FROM notes n WHERE n.subject_id = s.id AND n.deleted_at IS NULL) AS note_count FROM subjects s ORDER BY s.name COLLATE NOCASE`),
    'subjects.create': ({ name }) => {
      name = String(name || '').trim();
      if (!name) throw new AppError('Give the subject a name.', 'BAD_INPUT');
      const ex = db().get('SELECT id FROM subjects WHERE name = ? COLLATE NOCASE', name);
      if (ex) return { id: ex.id, name };
      return { id: db().insert('subjects', { name, created_at: now() }), name };
    },
    'subjects.rename': ({ id, name }) => {
      name = String(name || '').trim();
      if (!name) throw new AppError('Give the subject a name.', 'BAD_INPUT');
      if (db().get('SELECT id FROM subjects WHERE name = ? COLLATE NOCASE AND id != ?', name, id)) throw new AppError('A subject with that name already exists.', 'BAD_INPUT');
      db().update('subjects', id, { name });
    },
    'subjects.delete': ({ id }) => void db().run('DELETE FROM subjects WHERE id = ?', id),

    // ---------- notes ----------
    'notes.list': ({ subjectId, folder, tag, favorite } = {}) => {
      let sql = `SELECT id, title, substr(content_text, 1, 200) AS snippet, subject_id, folder, tags, favorite, source_type, source_id, created_at, updated_at FROM notes WHERE deleted_at IS NULL`;
      const p = [];
      if (subjectId === 'none') sql += ' AND subject_id IS NULL';
      else if (subjectId) (sql += ' AND subject_id = ?'), p.push(subjectId);
      if (folder !== undefined && folder !== null) (sql += ' AND folder = ?'), p.push(folder);
      if (favorite) sql += ' AND favorite = 1';
      let rows = db().all(sql + ' ORDER BY updated_at DESC', ...p).map(noteRow);
      if (tag) rows = rows.filter((r) => r.tags.includes(tag));
      return rows;
    },
    'notes.facets': () => {
      const rows = db().all('SELECT subject_id, folder, tags FROM notes WHERE deleted_at IS NULL');
      const folders = new Map();
      const tags = new Map();
      for (const r of rows) {
        if (r.folder) folders.set(`${r.subject_id ?? ''}|${r.folder}`, { subjectId: r.subject_id, folder: r.folder });
        for (const t of parseJson(r.tags, [])) tags.set(t, (tags.get(t) || 0) + 1);
      }
      return { folders: [...folders.values()], tags: [...tags.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag)) };
    },
    'notes.get': ({ id }) => {
      const r = noteRow(db().get('SELECT * FROM notes WHERE id = ?', id));
      if (!r) throw new AppError('Note not found.', 'NOT_FOUND');
      return r;
    },
    'notes.create': ({ title, html = '', text = '', subjectId = null, folder = '', tags = [], sourceType = null, sourceId = null } = {}) => {
      const t = now();
      const id = db().insert('notes', {
        title: String(title || '').trim() || 'Untitled note',
        content_html: html,
        content_text: text,
        subject_id: subjectId || null,
        folder: folder || '',
        tags: JSON.stringify(tagsOf(tags)),
        source_type: sourceType,
        source_id: sourceId,
        created_at: t,
        updated_at: t,
      });
      return noteRow(db().get('SELECT * FROM notes WHERE id = ?', id));
    },
    'notes.update': ({ id, title, html, text, subjectId, folder, tags, favorite }) => {
      const u = {};
      if (title !== undefined) u.title = String(title).trim() || 'Untitled note';
      if (html !== undefined) u.content_html = html;
      if (text !== undefined) u.content_text = text;
      if (subjectId !== undefined) u.subject_id = subjectId || null;
      if (folder !== undefined) u.folder = String(folder || '').trim();
      if (tags !== undefined) u.tags = JSON.stringify(tagsOf(tags));
      if (favorite !== undefined) u.favorite = favorite ? 1 : 0;
      if (title !== undefined || html !== undefined) u.updated_at = now();
      db().update('notes', id, u);
      return db().get('SELECT id, title, updated_at FROM notes WHERE id = ?', id);
    },

    // ---------- recordings ----------
    'recordings.list': () =>
      db()
        .all(`SELECT id, title, mime, original_name, duration, subject_id, tags, favorite, language, status, substr(transcript_text, 1, 200) AS snippet, created_at, updated_at FROM recordings WHERE deleted_at IS NULL ORDER BY created_at DESC`)
        .map((r) => recRow(r)),
    'recordings.get': ({ id }) => {
      const r = recRow(db().get('SELECT * FROM recordings WHERE id = ?', id), true);
      if (!r) throw new AppError('Recording not found.', 'NOT_FOUND');
      return r;
    },
    'recordings.create': ({ title, data, mime = 'audio/webm', ext = 'webm', duration = 0, subjectId = null, originalName = null }) => {
      const buf = toBuffer(data);
      const file = `${randomUUID()}.${String(ext).replace(/[^a-z0-9]/gi, '') || 'webm'}`;
      fs.writeFileSync(path.join(ctx.paths.audio, file), buf);
      const t = now();
      const id = db().insert('recordings', {
        title: String(title || '').trim() || `Recording ${new Date().toLocaleString()}`,
        file,
        mime,
        original_name: originalName,
        duration,
        subject_id: subjectId || null,
        created_at: t,
        updated_at: t,
      });
      return recRow(db().get('SELECT * FROM recordings WHERE id = ?', id), true);
    },
    'recordings.update': ({ id, title, subjectId, favorite, tags, duration, status, segments, language }) => {
      const u = {};
      if (title !== undefined) u.title = String(title).trim() || 'Untitled recording';
      if (subjectId !== undefined) u.subject_id = subjectId || null;
      if (favorite !== undefined) u.favorite = favorite ? 1 : 0;
      if (tags !== undefined) u.tags = JSON.stringify(tagsOf(tags));
      if (duration !== undefined) u.duration = duration;
      if (status !== undefined) u.status = status;
      if (language !== undefined) u.language = language;
      if (segments !== undefined) {
        u.segments = JSON.stringify(segments);
        u.transcript_text = segmentsToText(segments);
        u.status = 'done';
      }
      u.updated_at = now();
      db().update('recordings', id, u);
    },
    'recordings.audio': ({ id }) => {
      const r = db().get('SELECT file, mime FROM recordings WHERE id = ?', id);
      if (!r) throw new AppError('Recording not found.', 'NOT_FOUND');
      const f = path.join(ctx.paths.audio, r.file);
      if (!fs.existsSync(f)) throw new AppError('The audio file for this recording is missing from the data folder.', 'NOT_FOUND');
      return { data: new Uint8Array(fs.readFileSync(f)), mime: r.mime };
    },

    // ---------- local speech-to-text ----------
    'transcribe.status': () => ctx.transcriber.status(),
    'transcribe.load': async ({ model } = {}) => {
      await ctx.transcriber.load(model || ctx.settings.all().whisperModel);
      return ctx.transcriber.status();
    },
    'transcribe.chunk': async ({ pcm, language }) => {
      let f32 = pcm;
      if (!(pcm instanceof Float32Array)) {
        const b = toBuffer(pcm);
        f32 = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      }
      return ctx.transcriber.transcribe(f32, language || ctx.settings.all().transcribeLanguage);
    },

    // ---------- documents ----------
    'documents.list': () =>
      db()
        .all(`SELECT id, title, original_name, type, size, subject_id, tags, favorite, substr(text, 1, 200) AS snippet, length(text) AS chars, created_at, updated_at FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC`)
        .map(docRow),
    'documents.get': ({ id }) => {
      const r = docRow(db().get('SELECT * FROM documents WHERE id = ?', id));
      if (!r) throw new AppError('Document not found.', 'NOT_FOUND');
      return r;
    },
    'documents.import': async ({ name, data, subjectId = null }) => {
      const { kind, type } = fileKind(name);
      if (kind !== 'document') throw new AppError(`"${name}" is not a supported document. Use PDF, DOCX, PPTX, TXT or Markdown.`, 'UNSUPPORTED');
      const buf = toBuffer(data);
      const text = await extractText(type, buf);
      if (!text.trim()) throw new AppError(`No text could be extracted from "${name}". If it is a scanned PDF, it contains only images.`, 'EXTRACT_FAILED');
      const file = `${randomUUID()}.${type}`;
      fs.writeFileSync(path.join(ctx.paths.documents, file), buf);
      const t = now();
      const id = db().insert('documents', {
        title: path.basename(name, path.extname(name)),
        file,
        original_name: name,
        type,
        size: buf.length,
        text,
        subject_id: subjectId || null,
        created_at: t,
        updated_at: t,
      });
      return docRow(db().get('SELECT * FROM documents WHERE id = ?', id));
    },
    'documents.update': ({ id, title, subjectId, favorite, tags }) => {
      const u = { updated_at: now() };
      if (title !== undefined) u.title = String(title).trim() || 'Untitled document';
      if (subjectId !== undefined) u.subject_id = subjectId || null;
      if (favorite !== undefined) u.favorite = favorite ? 1 : 0;
      if (tags !== undefined) u.tags = JSON.stringify(tagsOf(tags));
      db().update('documents', id, u);
    },
    'documents.file': ({ id }) => {
      const r = db().get('SELECT file, original_name FROM documents WHERE id = ?', id);
      if (!r) throw new AppError('Document not found.', 'NOT_FOUND');
      return { data: new Uint8Array(fs.readFileSync(path.join(ctx.paths.documents, r.file))), name: r.original_name };
    },

    // ---------- trash ----------
    'trash.move': ({ type, id }) => {
      if (!TABLES[type]) throw new AppError('Unknown item type.', 'BAD_INPUT');
      db().run(`UPDATE ${TABLES[type]} SET deleted_at = ? WHERE id = ?`, now(), id);
    },
    'trash.list': () => {
      const out = [];
      for (const [type, table] of Object.entries(TABLES)) {
        for (const r of db().all(`SELECT id, title, deleted_at FROM ${table} WHERE deleted_at IS NOT NULL`)) out.push({ type, ...r });
      }
      return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
    },
    'trash.restore': ({ type, id }) => void db().run(`UPDATE ${TABLES[type]} SET deleted_at = NULL WHERE id = ?`, id),
    'trash.purge': ({ type, id }) => purge(type, id),
    'trash.empty': () => {
      let n = 0;
      for (const [type, table] of Object.entries(TABLES)) {
        for (const r of db().all(`SELECT id FROM ${table} WHERE deleted_at IS NOT NULL`)) {
          purge(type, r.id);
          n++;
        }
      }
      return { purged: n };
    },

    // ---------- library overview ----------
    'library.sources': () => {
      const notes = db().all(`SELECT id, title, subject_id, length(content_text) AS chars, updated_at AS date FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
      const recs = db().all(`SELECT id, title, subject_id, length(transcript_text) AS chars, created_at AS date FROM recordings WHERE deleted_at IS NULL ORDER BY created_at DESC`);
      const docs = db().all(`SELECT id, title, subject_id, length(text) AS chars, created_at AS date FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC`);
      return [...notes.map((r) => ({ type: 'note', ...r })), ...recs.map((r) => ({ type: 'recording', ...r })), ...docs.map((r) => ({ type: 'document', ...r }))];
    },
    'dashboard.stats': () => {
      const one = (sql) => Object.values(db().get(sql))[0] || 0;
      return {
        notes: one('SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL'),
        recordings: one('SELECT COUNT(*) FROM recordings WHERE deleted_at IS NULL'),
        audioSeconds: one('SELECT COALESCE(SUM(duration), 0) FROM recordings WHERE deleted_at IS NULL'),
        documents: one('SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL'),
        terms: one('SELECT COUNT(*) FROM glossary'),
        studySets: one('SELECT COUNT(*) FROM study_sets WHERE deleted_at IS NULL'),
        recentNotes: db()
          .all(`SELECT id, title, substr(content_text, 1, 140) AS snippet, subject_id, favorite, updated_at FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6`)
          .map((r) => ({ ...r, favorite: !!r.favorite })),
        recentRecordings: db().all(`SELECT id, title, duration, status, created_at FROM recordings WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`),
        recentTerms: db().all(`SELECT id, term, simple, saved FROM glossary ORDER BY created_at DESC LIMIT 8`),
      };
    },

    // ---------- global search ----------
    'search.query': ({ q = '', types, subjectId, tag, from, to, fileType, favorite } = {}) => {
      q = String(q).trim();
      const want = (t) => !types || !types.length || types.includes(t);
      const pat = like(q);
      const results = [];
      const inRange = (d) => (!from || d >= from) && (!to || d <= to + 'T23:59:59');
      const common = (r) => (!subjectId || r.subject_id === subjectId) && (!tag || parseJson(r.tags, []).includes(tag)) && (!favorite || r.favorite) && inRange(r.date);
      if (!q && !subjectId && !tag && !from && !to && !fileType && !favorite) return [];

      if (want('note') && !fileType) {
        for (const r of db().all(`SELECT id, title, content_text AS body, subject_id, tags, favorite, updated_at AS date FROM notes WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR content_text LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 200`, pat, pat))
          if (common(r)) results.push({ type: 'note', id: r.id, title: r.title, snippet: snippet(r.body, q), date: r.date, subjectId: r.subject_id, tags: parseJson(r.tags, []), favorite: !!r.favorite });
      }
      if (want('recording') && (!fileType || fileType === 'audio')) {
        for (const r of db().all(`SELECT id, title, transcript_text AS body, segments, subject_id, tags, favorite, created_at AS date FROM recordings WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR transcript_text LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 200`, pat, pat)) {
          if (!common(r)) continue;
          let at = null;
          if (q) {
            const hit = parseJson(r.segments, []).find((s) => s.text.toLowerCase().includes(q.toLowerCase()));
            if (hit) at = hit.start;
          }
          results.push({ type: 'recording', id: r.id, title: r.title, snippet: snippet(r.body, q), date: r.date, subjectId: r.subject_id, tags: parseJson(r.tags, []), favorite: !!r.favorite, at });
        }
      }
      if (want('document') && fileType !== 'audio') {
        for (const r of db().all(`SELECT id, title, text AS body, type, subject_id, tags, favorite, created_at AS date FROM documents WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 200`, pat, pat))
          if (common(r) && (!fileType || r.type === fileType)) results.push({ type: 'document', id: r.id, title: r.title, snippet: snippet(r.body, q), date: r.date, subjectId: r.subject_id, tags: parseJson(r.tags, []), favorite: !!r.favorite, fileType: r.type });
      }
      if (want('glossary') && !fileType && !tag && !favorite) {
        for (const r of db().all(`SELECT id, term, simple, detailed, subject_id, created_at AS date FROM glossary WHERE (term LIKE ? ESCAPE '\\' OR simple LIKE ? ESCAPE '\\' OR detailed LIKE ? ESCAPE '\\') ORDER BY term LIMIT 200`, pat, pat, pat))
          if ((!subjectId || r.subject_id === subjectId) && inRange(r.date)) results.push({ type: 'glossary', id: r.id, title: r.term, snippet: r.simple || snippet(r.detailed, q), date: r.date, subjectId: r.subject_id, tags: [] });
      }
      if (want('study') && !fileType && !tag) {
        for (const r of db().all(`SELECT id, title, type AS kind, data, subject_id, favorite, created_at AS date FROM study_sets WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 200`, pat, pat))
          if ((!subjectId || r.subject_id === subjectId) && (!favorite || r.favorite) && inRange(r.date)) results.push({ type: 'study', id: r.id, title: r.title, snippet: snippet(studyText(parseJson(r.data, {})), q), date: r.date, subjectId: r.subject_id, tags: [], kind: r.kind, favorite: !!r.favorite });
      }
      return results.slice(0, 300);
    },
  };

  function purge(type, id) {
    if (type === 'recording') {
      const r = db().get('SELECT file FROM recordings WHERE id = ?', id);
      if (r) fs.rmSync(path.join(ctx.paths.audio, r.file), { force: true });
    }
    if (type === 'document') {
      const r = db().get('SELECT file FROM documents WHERE id = ?', id);
      if (r) fs.rmSync(path.join(ctx.paths.documents, r.file), { force: true });
    }
    if (type !== 'study') db().run('DELETE FROM summaries WHERE source_type = ? AND source_id = ?', type, id);
    db().run(`DELETE FROM ${TABLES[type]} WHERE id = ?`, id);
  }
}
