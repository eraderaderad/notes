// AI-backed features: glossary, summaries, study assistant, study materials.
// Every handler here calls the user's configured provider; none returns canned content.
import { now, parseJson } from './db.js';
import { AppError, aiConfig, complete, completeJson, listOllamaModels } from './ai.js';

const termKey = (t) => String(t).trim().toLowerCase().replace(/\s+/g, ' ');
const str = (v) => (v == null ? '' : String(v).trim());
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Split long text on paragraph boundaries into pieces no longer than `size` characters. */
export function splitText(text, size) {
  if (text.length <= size) return [text];
  const out = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    if (cur.length + para.length + 2 > size && cur) {
      out.push(cur);
      cur = '';
    }
    if (para.length > size) {
      for (let i = 0; i < para.length; i += size) out.push(para.slice(i, i + size));
    } else cur += (cur ? '\n\n' : '') + para;
  }
  if (cur) out.push(cur);
  return out;
}

export const SUMMARY_STYLES = {
  quick: { label: 'Quick Summary', prompt: 'Write a quick summary: one short overview paragraph followed by at most six bullet points covering the main ideas.' },
  detailed: { label: 'Detailed Notes', prompt: 'Write detailed, well-organized study notes. Group the content under logical headings and subheadings, use bullet points, and keep every important detail, definition, step and example from the source.' },
  takeaways: { label: 'Key Takeaways', prompt: 'List the key takeaways as a numbered list. Each takeaway is one or two sentences and stands on its own.' },
  beginner: { label: 'Beginner-Friendly Explanation', prompt: 'Explain the content for a complete beginner. Use plain words, short sentences and logical headings. Keep to what the source says.' },
  exam: { label: 'Exam Reviewer', prompt: 'Write an exam reviewer: the definitions to memorize, the key concepts, any formulas, steps or comparisons, and the points most likely to be tested, under clear headings.' },
};

const GROUNDING = `Rules:
- Use only information that is present in the source. Do not invent facts, names, numbers or examples.
- Write in Markdown with clear headings. Do not add a preamble or closing remarks.
- If you believe an extra clarification that is NOT in the source would help the reader, put it only in a final section titled exactly "## AI additions (not from the source)". Omit that section if you have nothing to add.
- Write in the same language as the source (English, Filipino, or mixed).`;

const TERM_SHAPE = `{"term": "name as written in the text", "simple": "one-sentence simple definition", "detailed": "2-4 sentence detailed explanation", "example": "a concrete example", "application": "where it is used in the real world", "related": ["related concept", "..."]}`;

export function aiHandlers(ctx) {
  const db = () => ctx.db;
  const termRow = (r) => r && { ...r, related: parseJson(r.related, []), saved: !!r.saved };

  function insertTerm(t, extra = {}) {
    const term = str(t.term);
    if (!term || term.length > 80) return null;
    const key = termKey(term);
    if (db().get('SELECT id FROM glossary WHERE term_key = ?', key)) return null;
    const ts = now();
    const id = db().insert('glossary', {
      term,
      term_key: key,
      simple: str(t.simple),
      detailed: str(t.detailed),
      example: str(t.example),
      application: str(t.application),
      related: JSON.stringify(Array.isArray(t.related) ? t.related.map(str).filter(Boolean).slice(0, 8) : []),
      saved: extra.saved ? 1 : 0,
      origin: extra.origin || 'ai',
      source_type: extra.sourceType || null,
      source_id: extra.sourceId || null,
      subject_id: extra.subjectId || null,
      created_at: ts,
      updated_at: ts,
    });
    return termRow(db().get('SELECT * FROM glossary WHERE id = ?', id));
  }

  /** Gather text from several library items, trimmed to the provider's budget. */
  function gather(sources, budget) {
    if (!sources?.length) throw new AppError('Choose at least one note, recording or document to use.', 'BAD_INPUT');
    const items = sources.map((s) => ctx.sourceText(s.type, s.id)).filter((s) => s.text.trim());
    if (!items.length) throw new AppError('The selected items have no text yet. Transcribe the recording or add some content first.', 'BAD_INPUT');
    const total = items.reduce((n, s) => n + s.text.length, 0);
    let truncated = false;
    if (total > budget) {
      truncated = true;
      for (const s of items) s.text = s.text.slice(0, Math.max(2000, Math.floor((s.text.length / total) * budget)));
    }
    const text = items.map((s) => `### Source: ${s.title} (${s.type})\n${s.text}`).join('\n\n');
    return { text, truncated, items };
  }

  // ---- retrieval for the assistant ----
  const STOP = new Set('the a an and or of to in on for with is are was were be this that it as at by from what which who how why when where does do did can could would should about my me i you your tell give explain show find part everything all into than then them they their there here have has had not but if so such'.split(' '));
  const tokens = (s) => (s.toLowerCase().match(/[a-z0-9À-ɏ]+/g) || []).filter((w) => w.length > 1 && !STOP.has(w));

  function chunkLibrary(scope) {
    const subj = scope?.mode === 'subjects' ? new Set(scope.subjectIds || []) : null;
    const pick = scope?.mode === 'sources' ? new Set((scope.sources || []).map((s) => `${s.type}:${s.id}`)) : null;
    const allow = (type, r) => (pick ? pick.has(`${type}:${r.id}`) : subj ? subj.has(r.subject_id) : true);
    const chunks = [];
    for (const r of db().all('SELECT id, title, content_text AS text, subject_id FROM notes WHERE deleted_at IS NULL')) {
      if (!allow('note', r) || !r.text.trim()) continue;
      splitText(r.text, 1500).forEach((text, i) => chunks.push({ type: 'note', id: r.id, title: r.title, part: i + 1, text }));
    }
    for (const r of db().all('SELECT id, title, text, subject_id FROM documents WHERE deleted_at IS NULL')) {
      if (!allow('document', r)) continue;
      let loc = '';
      splitText(r.text, 1500).forEach((text, i) => {
        const m = [...text.matchAll(/\[(Page|Slide) (\d+)\]/g)];
        if (m.length) loc = `${m[0][1]} ${m[0][2]}`;
        chunks.push({ type: 'document', id: r.id, title: r.title, part: i + 1, loc, text });
        if (m.length) loc = `${m[m.length - 1][1]} ${m[m.length - 1][2]}`;
      });
    }
    for (const r of db().all('SELECT id, title, segments, subject_id FROM recordings WHERE deleted_at IS NULL')) {
      if (!allow('recording', r)) continue;
      let cur = null;
      for (const s of parseJson(r.segments, [])) {
        if (!cur || cur.text.length > 1200) {
          cur = { type: 'recording', id: r.id, title: r.title, start: s.start, text: '' };
          chunks.push(cur);
        }
        cur.text += `[${fmtTime(s.start)}] ${s.text.trim()}\n`;
      }
    }
    return chunks;
  }

  function retrieve(question, scope, budget) {
    const chunks = chunkLibrary(scope);
    const total = chunks.reduce((n, c) => n + c.text.length, 0);
    if (total <= budget) return chunks;
    const q = [...new Set(tokens(question))];
    const df = new Map();
    const toks = chunks.map((c) => {
      const t = tokens(c.title + ' ' + c.text);
      const tf = new Map();
      for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
      for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
      return tf;
    });
    const scored = chunks.map((c, i) => {
      let score = 0;
      for (const w of q) {
        const tf = toks[i].get(w);
        if (tf) score += (1 + Math.log(tf)) * Math.log(1 + chunks.length / df.get(w));
      }
      return { c, i, score };
    });
    const any = scored.some((s) => s.score > 0);
    scored.sort((a, b) => (any ? b.score - a.score : 0) || a.i - b.i);
    const out = [];
    let used = 0;
    for (const s of scored) {
      if (any && s.score === 0) break;
      if (used + s.c.text.length > budget) continue;
      out.push(s);
      used += s.c.text.length;
    }
    return out.sort((a, b) => a.i - b.i).map((s) => s.c);
  }

  return {
    // ---------- provider status ----------
    'ai.status': () => {
      const { charBudget, ...cfg } = aiConfig(ctx);
      return cfg;
    },
    'ai.test': async () => {
      const reply = await complete(ctx, { system: 'You are a connection test.', user: 'Reply with the single word: ready', maxTokens: 2000 });
      return { reply: reply.slice(0, 80), label: aiConfig(ctx).label };
    },
    'ai.ollamaModels': ({ url } = {}) => listOllamaModels(url || ctx.settings.all().ollamaUrl),

    // ---------- glossary ----------
    'glossary.list': ({ q, filter } = {}) => {
      let rows = db().all('SELECT * FROM glossary ORDER BY term COLLATE NOCASE').map(termRow);
      if (filter === 'saved') rows = rows.filter((r) => r.saved);
      if (filter === 'discovered') rows = rows.filter((r) => !r.saved);
      if (q) {
        const k = q.toLowerCase();
        rows = rows.filter((r) => r.term.toLowerCase().includes(k) || r.simple.toLowerCase().includes(k));
      }
      return rows;
    },
    'glossary.terms': () => db().all('SELECT id, term FROM glossary'),
    'glossary.get': ({ id, term }) => {
      const r = id ? db().get('SELECT * FROM glossary WHERE id = ?', id) : db().get('SELECT * FROM glossary WHERE term_key = ?', termKey(term));
      return termRow(r) || null;
    },
    'glossary.save': ({ id, term, simple, detailed, example, application, related, saved = true }) => {
      if (!str(term)) throw new AppError('Enter the term.', 'BAD_INPUT');
      const fields = { simple: str(simple), detailed: str(detailed), example: str(example), application: str(application), related: Array.isArray(related) ? related : str(related).split(',').map(str).filter(Boolean) };
      if (id) {
        const clash = db().get('SELECT id FROM glossary WHERE term_key = ? AND id != ?', termKey(term), id);
        if (clash) throw new AppError('Another glossary entry already uses that term.', 'BAD_INPUT');
        db().update('glossary', id, { term: str(term), term_key: termKey(term), ...fields, related: JSON.stringify(fields.related), saved: saved ? 1 : 0, updated_at: now() });
        return termRow(db().get('SELECT * FROM glossary WHERE id = ?', id));
      }
      const row = insertTerm({ term, ...fields }, { origin: 'manual', saved });
      if (!row) throw new AppError(`"${str(term)}" is already in your glossary.`, 'BAD_INPUT');
      return row;
    },
    'glossary.setSaved': ({ id, saved }) => void db().update('glossary', id, { saved: saved ? 1 : 0, updated_at: now() }),
    'glossary.delete': ({ id }) => void db().run('DELETE FROM glossary WHERE id = ?', id),

    /** Find and explain the important terms in a note, transcript or document. */
    'glossary.extract': async ({ sourceType, sourceId }) => {
      const src = ctx.sourceText(sourceType, sourceId);
      if (src.text.trim().length < 40) throw new AppError('There is not enough text here to look for terms yet.', 'BAD_INPUT');
      const cfg = aiConfig(ctx);
      const pieces = splitText(src.text, Math.min(cfg.charBudget || 24000, 60000));
      const MAX = 6;
      const added = [];
      for (const piece of pieces.slice(0, MAX)) {
        const known = db().all('SELECT term FROM glossary').map((r) => r.term);
        const out = await completeJson(ctx, {
          system: `You help a student understand their study material. Identify the important technical terms, acronyms, unfamiliar vocabulary and key concepts in the text and explain each one clearly.
Return ONLY a JSON object of the form {"terms": [${TERM_SHAPE}]}.
- Include only terms that actually appear in the text and that a learner would need explained. At most 12 terms, most important first.
- Skip everyday words and skip every term in the already-explained list.
- Definitions must be accurate. Write explanations in English unless the text is in Filipino.
- If there are no terms worth explaining, return {"terms": []}.`,
          user: `Already explained (skip these): ${known.length ? known.slice(-400).join(', ') : '(none)'}\n\nText from "${src.title}":\n"""\n${piece}\n"""`,
        });
        for (const t of Array.isArray(out.terms) ? out.terms : []) {
          const row = insertTerm(t, { origin: 'ai', sourceType, sourceId, subjectId: src.subjectId });
          if (row) added.push(row);
        }
      }
      return { added, truncated: pieces.length > MAX, pieces: pieces.length };
    },

    /** Explain a single term on demand (used for related terms and manual lookups). */
    'glossary.explain': async ({ term, context = '', save = false }) => {
      term = str(term);
      if (!term) throw new AppError('Enter a term to explain.', 'BAD_INPUT');
      const existing = db().get('SELECT * FROM glossary WHERE term_key = ?', termKey(term));
      if (existing) return termRow(existing);
      const out = await completeJson(ctx, {
        system: `You explain a term to a student. Return ONLY a JSON object of the form ${TERM_SHAPE}. Be accurate and concrete.`,
        user: `Term: ${term}${context ? `\n\nContext where it appeared:\n"""\n${context.slice(0, 1500)}\n"""` : ''}`,
      });
      const row = insertTerm({ ...out, term }, { origin: 'ai', saved: save });
      if (!row) throw new AppError('Could not save that term.', 'ERROR');
      return row;
    },

    /** Rewrite an entry to be simpler or more detailed. */
    'glossary.reexplain': async ({ id, mode }) => {
      const r = termRow(db().get('SELECT * FROM glossary WHERE id = ?', id));
      if (!r) throw new AppError('Term not found.', 'NOT_FOUND');
      const how =
        mode === 'simpler'
          ? 'Rewrite it so a complete beginner (around age 12) understands: plain words, short sentences, an everyday analogy in the example.'
          : 'Rewrite it with more depth: how it works, important details and nuances, and a more technical example.';
      const out = await completeJson(ctx, {
        system: `You refine a glossary entry for a student. ${how} Return ONLY a JSON object of the form ${TERM_SHAPE}. Keep the same term.`,
        user: `Current entry:\n${JSON.stringify({ term: r.term, simple: r.simple, detailed: r.detailed, example: r.example, application: r.application, related: r.related })}`,
      });
      db().update('glossary', id, {
        simple: str(out.simple) || r.simple,
        detailed: str(out.detailed) || r.detailed,
        example: str(out.example) || r.example,
        application: str(out.application) || r.application,
        related: JSON.stringify(Array.isArray(out.related) && out.related.length ? out.related.map(str).filter(Boolean).slice(0, 8) : r.related),
        updated_at: now(),
      });
      return termRow(db().get('SELECT * FROM glossary WHERE id = ?', id));
    },

    // ---------- summaries ----------
    'summaries.styles': () => Object.entries(SUMMARY_STYLES).map(([id, s]) => ({ id, label: s.label })),
    'summaries.list': ({ sourceType, sourceId }) => db().all('SELECT * FROM summaries WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC', sourceType, sourceId),
    'summaries.delete': ({ id }) => void db().run('DELETE FROM summaries WHERE id = ?', id),
    'summaries.create': async ({ sourceType, sourceId, style = 'quick', text = null }) => {
      const st = SUMMARY_STYLES[style];
      if (!st) throw new AppError('Unknown summary style.', 'BAD_INPUT');
      const src = ctx.sourceText(sourceType, sourceId);
      const body = str(text) || src.text;
      if (body.trim().length < 40) throw new AppError('There is not enough text to summarize yet.', 'BAD_INPUT');
      const cfg = aiConfig(ctx);
      const system = `You summarize a student's own study material.\n${st.prompt}\n${GROUNDING}`;
      const pieces = splitText(body, cfg.charBudget || 24000);
      let content;
      if (pieces.length === 1) {
        content = await complete(ctx, { system, user: `Source: "${src.title}"\n"""\n${body}\n"""` });
      } else {
        // Long sources: condense each part faithfully, then write the final summary from the condensed parts.
        const partials = [];
        for (let i = 0; i < pieces.length; i++) {
          partials.push(
            await complete(ctx, {
              system: `You condense part of a longer source into faithful, complete notes so nothing important is lost. Use only what is in the text. Markdown bullets, no preamble.`,
              user: `Part ${i + 1} of ${pieces.length} of "${src.title}":\n"""\n${pieces[i]}\n"""`,
            }),
          );
        }
        content = await complete(ctx, { system, user: `Source: "${src.title}" (condensed notes of all ${pieces.length} parts, in order)\n"""\n${partials.join('\n\n')}\n"""` });
      }
      const id = db().insert('summaries', { source_type: sourceType, source_id: sourceId, style, scope: text ? 'selection' : 'full', content, model: cfg.label, created_at: now() });
      return db().get('SELECT * FROM summaries WHERE id = ?', id);
    },

    // ---------- study assistant ----------
    'chats.list': () => db().all('SELECT * FROM chats ORDER BY updated_at DESC').map((c) => ({ ...c, scope: parseJson(c.scope, { mode: 'all' }) })),
    'chats.get': ({ id }) => {
      const c = db().get('SELECT * FROM chats WHERE id = ?', id);
      if (!c) throw new AppError('Chat not found.', 'NOT_FOUND');
      return { ...c, scope: parseJson(c.scope, { mode: 'all' }), messages: db().all('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id', id).map((m) => ({ ...m, sources: parseJson(m.sources, []) })) };
    },
    'chats.rename': ({ id, title }) => void db().update('chats', id, { title: str(title) || 'Untitled chat' }),
    'chats.delete': ({ id }) => void db().run('DELETE FROM chats WHERE id = ?', id),
    'assistant.ask': async ({ chatId, question, scope = { mode: 'all' } }) => {
      question = str(question);
      if (!question) throw new AppError('Type a question first.', 'BAD_INPUT');
      const cfg = aiConfig(ctx);
      if (!cfg.configured) throw new AppError(cfg.reason, 'AI_NOT_CONFIGURED');
      const chunks = retrieve(question, scope, Math.floor(cfg.charBudget * 0.6));
      const context = chunks
        .map((c, i) => {
          const where = c.type === 'recording' ? `recording transcript, from ${fmtTime(c.start)}` : c.type === 'document' ? `document${c.loc ? ', ' + c.loc : ''}` : `note, part ${c.part}`;
          return `[S${i + 1}] "${c.title}" (${where})\n${c.text.trim()}`;
        })
        .join('\n\n---\n\n');
      const history = chatId ? db().all('SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10', chatId).reverse() : [];
      const system = `You are the user's personal study tutor inside their note-taking app. You answer questions using their own saved notes, lecture transcripts and documents, shown below as numbered sources.

How to answer:
- Prefer the user's materials. When a statement comes from a source, cite it inline like [S1] or [S2][S5]. For transcripts, mention the timestamp when it helps the user find the moment.
- If the materials do not contain the answer, say so plainly, then answer from general knowledge under a line that reads "**General knowledge (not from your notes):**".
- Never attribute something to a source that does not say it.
- Be clear and concise, use Markdown, and match the user's language (English or Filipino).

${context ? `The user's materials:\n\n${context}` : 'The user has no saved materials in the selected scope yet.'}`;
      const answer = await complete(ctx, { system, messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: question }] });
      const cited = [...new Set([...answer.matchAll(/\[S(\d+)\]/g)].map((m) => +m[1]))].filter((n) => n >= 1 && n <= chunks.length);
      const sources = cited.map((n) => {
        const c = chunks[n - 1];
        return { n, type: c.type, id: c.id, title: c.title, start: c.start ?? null, loc: c.loc || (c.type === 'note' ? `part ${c.part}` : ''), excerpt: c.text.replace(/\s+/g, ' ').slice(0, 220) };
      });
      const ts = now();
      if (!chatId) chatId = db().insert('chats', { title: question.slice(0, 60), scope: JSON.stringify(scope), created_at: ts, updated_at: ts });
      else db().update('chats', chatId, { updated_at: ts, scope: JSON.stringify(scope) });
      db().insert('chat_messages', { chat_id: chatId, role: 'user', content: question, created_at: ts });
      const mid = db().insert('chat_messages', { chat_id: chatId, role: 'assistant', content: answer, sources: JSON.stringify(sources), created_at: now() });
      return { chatId, message: { id: mid, role: 'assistant', content: answer, sources }, usedChunks: chunks.length };
    },

    // ---------- study materials ----------
    'study.list': ({ type } = {}) =>
      db()
        .all(`SELECT id, type, title, subject_id, sources, favorite, created_at, updated_at, data FROM study_sets WHERE deleted_at IS NULL ${type ? 'AND type = ?' : ''} ORDER BY created_at DESC`, ...(type ? [type] : []))
        .map((r) => {
          const d = parseJson(r.data, {});
          const { data, ...rest } = r;
          return { ...rest, favorite: !!r.favorite, sources: parseJson(r.sources, []), count: d.cards?.length ?? d.questions?.length ?? null };
        }),
    'study.get': ({ id }) => {
      const r = db().get('SELECT * FROM study_sets WHERE id = ?', id);
      if (!r) throw new AppError('Study set not found.', 'NOT_FOUND');
      return { ...r, favorite: !!r.favorite, sources: parseJson(r.sources, []), data: parseJson(r.data, {}) };
    },
    'study.update': ({ id, title, data, favorite, subjectId }) => {
      const u = { updated_at: now() };
      if (title !== undefined) u.title = str(title) || 'Untitled set';
      if (data !== undefined) u.data = JSON.stringify(data);
      if (favorite !== undefined) u.favorite = favorite ? 1 : 0;
      if (subjectId !== undefined) u.subject_id = subjectId || null;
      db().update('study_sets', id, u);
    },
    'study.generate': async ({ type, sources, count = 12, quizTypes = ['mcq', 'truefalse', 'identification', 'short'], title, subjectId = null }) => {
      const cfg = aiConfig(ctx);
      if (!cfg.configured) throw new AppError(cfg.reason, 'AI_NOT_CONFIGURED');
      const { text, truncated, items } = gather(sources, cfg.charBudget);
      count = Math.min(40, Math.max(3, +count || 12));
      const base = `You create study materials from a student's own notes. Use only facts found in the source material; do not introduce outside facts. Match the language of the source.`;
      let data;
      if (type === 'flashcards') {
        const out = await completeJson(ctx, {
          system: `${base}\nCreate ${count} flashcards that test the most important facts, definitions and concepts. Questions must be specific and answerable from the material; answers are short (1-3 sentences).\nReturn ONLY a JSON object: {"cards": [{"q": "question", "a": "answer"}]}`,
          user: text,
        });
        const cards = (Array.isArray(out.cards) ? out.cards : []).map((c) => ({ q: str(c.q ?? c.question), a: str(c.a ?? c.answer), difficulty: null })).filter((c) => c.q && c.a);
        if (!cards.length) throw new AppError('The AI did not produce any flashcards. Try again.', 'AI_ERROR');
        data = { cards };
      } else if (type === 'quiz') {
        const names = { mcq: 'multiple-choice ("mcq", exactly 4 options, answer is the full text of the correct option)', truefalse: 'true or false ("truefalse", answer is "True" or "False")', identification: 'identification ("identification", answer is a single term or short phrase)', short: 'short-answer ("short", answer is a 1-3 sentence model answer)' };
        const wanted = quizTypes.filter((t) => names[t]);
        if (!wanted.length) throw new AppError('Choose at least one question type.', 'BAD_INPUT');
        const out = await completeJson(ctx, {
          system: `${base}\nCreate a ${count}-question practice quiz mixing these question types as evenly as possible: ${wanted.map((t) => names[t]).join('; ')}.\nEvery question needs a brief explanation of why the answer is correct, based on the material.\nReturn ONLY a JSON object: {"questions": [{"type": "mcq|truefalse|identification|short", "question": "...", "options": ["only for mcq"], "answer": "...", "explanation": "..."}]}`,
          user: text,
        });
        const questions = (Array.isArray(out.questions) ? out.questions : [])
          .map((q) => {
            let t = str(q.type).toLowerCase().replace(/[^a-z]/g, '');
            if (t.startsWith('multiple')) t = 'mcq';
            if (t.startsWith('true')) t = 'truefalse';
            if (t.startsWith('ident')) t = 'identification';
            if (t.startsWith('short')) t = 'short';
            const o = { type: t, question: str(q.question), answer: str(q.answer), explanation: str(q.explanation) };
            if (t === 'mcq') o.options = (Array.isArray(q.options) ? q.options : []).map(str).filter(Boolean);
            if (t === 'truefalse') o.answer = /^t/i.test(o.answer) ? 'True' : 'False';
            return o;
          })
          .filter((q) => names[q.type] && q.question && q.answer && (q.type !== 'mcq' || q.options.length >= 2));
        if (!questions.length) throw new AppError('The AI did not produce any usable questions. Try again.', 'AI_ERROR');
        data = { questions };
      } else if (type === 'reviewer') {
        const content = await complete(ctx, {
          system: `${base}\nWrite a structured reviewer in Markdown with exactly these sections, in this order:\n## Important Definitions\n## Key Concepts\n## Examples\n## Possible Examination Questions\nUnder the last section, write 8-12 likely exam questions, each followed by a short answer. Use only examples that appear in the material; if it has none, say so in that section. No preamble.`,
          user: text,
        });
        data = { content };
      } else throw new AppError('Unknown study material type.', 'BAD_INPUT');
      const ts = now();
      const label = { flashcards: 'Flashcards', quiz: 'Quiz', reviewer: 'Reviewer' }[type];
      const id = db().insert('study_sets', {
        type,
        title: str(title) || `${label}: ${items[0].title}${items.length > 1 ? ` +${items.length - 1}` : ''}`,
        subject_id: subjectId || items[0].subjectId || null,
        sources: JSON.stringify(items.map((s) => ({ type: s.type, id: s.id, title: s.title }))),
        data: JSON.stringify(data),
        created_at: ts,
        updated_at: ts,
      });
      return { id, type, truncated };
    },
  };
}
