// AI tools shared by notes, recordings and documents: summarize, find terms, study materials, ask AI.
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Copy, FileText, GraduationCap, ListChecks, MessageSquare, Mic, NotebookPen, Search, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { emit } from '../lib/audio.js';
import { cn, fmtDate, mdToHtml } from '../lib/format.js';
import { Markdown } from './content.jsx';
import { Banner, Button, Field, IconButton, Modal, Segmented, Spinner, useDialogs } from './ui.jsx';

export const TYPE_ICON = { note: NotebookPen, recording: Mic, document: FileText, glossary: BookOpen, study: GraduationCap };

export function SubjectSelect({ value, onChange, className, placeholder = 'No subject' }) {
  const { subjects, refreshSubjects, fail } = useApp();
  const { prompt } = useDialogs();
  return (
    <select
      className={cn('input', className)}
      value={value ?? ''}
      aria-label="Subject"
      onChange={async (e) => {
        if (e.target.value === '__new') {
          const name = await prompt({ title: 'New subject', placeholder: 'e.g. Computer Networks', confirmLabel: 'Create' });
          if (!name?.trim()) return;
          try {
            const s = await api('subjects.create', { name });
            await refreshSubjects();
            onChange(s.id);
          } catch (err) {
            fail(err);
          }
        } else onChange(e.target.value ? +e.target.value : null);
      }}
    >
      <option value="">{placeholder}</option>
      {subjects.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
      <option value="__new">+ New subject…</option>
    </select>
  );
}

/** Checklist of everything in the library, used to choose AI context. */
export function SourcePicker({ value, onChange, height = 'h-56' }) {
  const { subjects } = useApp();
  const [all, setAll] = useState(null);
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  useEffect(() => {
    api('library.sources').then(setAll);
  }, []);
  const key = (s) => `${s.type}:${s.id}`;
  const picked = useMemo(() => new Set(value.map(key)), [value]);
  const shown = (all || []).filter((s) => s.chars > 0 && (!subject || s.subject_id === +subject) && (!q || s.title.toLowerCase().includes(q.toLowerCase())));
  const toggle = (s) => onChange(picked.has(key(s)) ? value.filter((v) => key(v) !== key(s)) : [...value, { type: s.type, id: s.id, title: s.title }]);
  return (
    <div>
      <div className="mb-2 flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input className="input pl-7" placeholder="Filter by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-40" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Filter by subject">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className={cn('overflow-y-auto rounded-md border border-line', height)}>
        {!all ? (
          <div className="flex h-full items-center justify-center text-muted">
            <Spinner />
          </div>
        ) : !shown.length ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">{all.length ? 'Nothing matches this filter.' : 'Your library is empty. Write a note, record a lecture or import a document first.'}</div>
        ) : (
          shown.map((s) => {
            const Icon = TYPE_ICON[s.type];
            return (
              <label key={key(s)} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 text-[13px] last:border-0 hover:bg-surface2">
                <input type="checkbox" className="accent-(--accent)" checked={picked.has(key(s))} onChange={() => toggle(s)} />
                <Icon size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-[11px] text-muted">{Math.max(1, Math.round(s.chars / 1000))}k chars</span>
              </label>
            );
          })
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
        <span>{value.length} selected</span>
        <span className="flex gap-3">
          <button type="button" className="hover:text-ink" onClick={() => onChange([...value, ...shown.filter((s) => !picked.has(key(s))).map((s) => ({ type: s.type, id: s.id, title: s.title }))])}>
            Select shown
          </button>
          <button type="button" className="hover:text-ink" onClick={() => onChange([])}>
            Clear
          </button>
        </span>
      </div>
    </div>
  );
}

export function AiGate() {
  const { ai, go } = useApp();
  if (ai.configured) return null;
  return (
    <Banner
      tone="warn"
      action={
        <Button size="sm" onClick={() => go('settings', { section: 'ai' })}>
          Set up
        </Button>
      }
    >
      <b>AI is not set up.</b> {ai.reason}
    </Banner>
  );
}

const STYLES = [
  { id: 'quick', label: 'Quick Summary', hint: 'A short overview and the main points' },
  { id: 'detailed', label: 'Detailed Notes', hint: 'Organized notes under headings, nothing important dropped' },
  { id: 'takeaways', label: 'Key Takeaways', hint: 'A numbered list of what matters most' },
  { id: 'beginner', label: 'Beginner-Friendly Explanation', hint: 'Plain words, short sentences' },
  { id: 'exam', label: 'Exam Reviewer', hint: 'Definitions, key concepts and likely test points' },
];

export function SummaryModal({ open, onClose, source, selection }) {
  const { fail, toast, go, ai } = useApp();
  const [style, setStyle] = useState('quick');
  const [useSel, setUseSel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    if (!open) return;
    setUseSel(!!selection);
    setCurrent(null);
    api('summaries.list', { sourceType: source.type, sourceId: source.id }).then((l) => {
      setList(l);
      if (!selection && l.length) setCurrent(l[0]);
    });
  }, [open]);

  async function generate() {
    setBusy(true);
    try {
      const s = await api('summaries.create', { sourceType: source.type, sourceId: source.id, style, text: useSel ? selection : null });
      setList((l) => [s, ...l]);
      setCurrent(s);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveAsNote() {
    const label = STYLES.find((s) => s.id === current.style)?.label || 'Summary';
    const note = await api('notes.create', { title: `${label}: ${source.title}`, html: mdToHtml(current.content), text: current.content, subjectId: source.subjectId || null, sourceType: source.type, sourceId: source.id });
    toast('Saved as a new note', 'success');
    onClose();
    go('notes', { noteId: note.id });
  }
  async function remove(s) {
    await api('summaries.delete', { id: s.id });
    setList((l) => l.filter((x) => x.id !== s.id));
    if (current?.id === s.id) setCurrent(null);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Summarize “${source?.title || ''}”`} width="max-w-4xl">
      <div className="flex min-h-[26rem] gap-5">
        <div className="w-64 shrink-0 space-y-3">
          <AiGate />
          <div>
            <div className="label">Summary style</div>
            <div className="space-y-1">
              {STYLES.map((s) => (
                <button key={s.id} type="button" onClick={() => setStyle(s.id)} className={cn('w-full rounded-md border px-2.5 py-1.5 text-left transition-colors', style === s.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface2')}>
                  <div className="text-[13px] font-medium">{s.label}</div>
                  <div className="text-[11px] text-muted">{s.hint}</div>
                </button>
              ))}
            </div>
          </div>
          {selection && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="accent-(--accent)" checked={useSel} onChange={(e) => setUseSel(e.target.checked)} />
              Only the selected text ({selection.length.toLocaleString()} characters)
            </label>
          )}
          <Button variant="primary" icon={Sparkles} className="w-full" loading={busy} disabled={!ai.configured} onClick={generate}>
            {busy ? 'Summarizing…' : 'Generate summary'}
          </Button>
          {list.length > 0 && (
            <div>
              <div className="label mt-4">Earlier summaries</div>
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {list.map((s) => (
                  <div key={s.id} className={cn('group flex items-center gap-1 rounded-md px-2 py-1 text-xs', current?.id === s.id ? 'bg-surface2' : 'hover:bg-surface2')}>
                    <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setCurrent(s)}>
                      {STYLES.find((x) => x.id === s.style)?.label}
                      {s.scope === 'selection' && ' (selection)'} <span className="text-muted">· {fmtDate(s.created_at)}</span>
                    </button>
                    <button type="button" aria-label="Delete summary" className="text-muted opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => remove(s)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col rounded-md border border-line bg-bg">
          {busy ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted">
              <Spinner size={20} />
              Reading the source and writing the summary…
            </div>
          ) : current ? (
            <>
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-xs text-muted">
                  Generated by {current.model || 'AI'} from your source · {fmtDate(current.created_at)}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Copy} onClick={() => (navigator.clipboard.writeText(current.content), toast('Copied', 'success'))}>
                    Copy
                  </Button>
                  <Button size="sm" icon={NotebookPen} onClick={saveAsNote}>
                    Save as note
                  </Button>
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <Markdown text={current.content} small />
              </div>
              <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">The summary is written only from your source. Anything the AI added on its own appears under “AI additions (not from the source)”.</div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-8 text-center text-[13px] text-muted">Choose a style and generate a summary. It will appear here.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

const QUIZ_TYPES = [
  { id: 'mcq', label: 'Multiple choice' },
  { id: 'identification', label: 'Identification' },
  { id: 'truefalse', label: 'True or False' },
  { id: 'short', label: 'Short answer' },
];

export function StudyModal({ open, onClose, initialSources = [], initialType = 'flashcards' }) {
  const { fail, toast, go, ai } = useApp();
  const [type, setType] = useState(initialType);
  const [sources, setSources] = useState([]);
  const [count, setCount] = useState(12);
  const [quizTypes, setQuizTypes] = useState(QUIZ_TYPES.map((q) => q.id));
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setType(initialType);
      setSources(initialSources);
      setTitle('');
      setSubjectId(initialSources[0]?.subjectId || null);
    }
  }, [open]);
  async function generate() {
    setBusy(true);
    try {
      const r = await api('study.generate', { type, sources, count, quizTypes, title, subjectId });
      if (r.truncated) toast('The selected material was longer than the AI model can read at once, so only the first part of each source was used.', 'info');
      else toast('Study material created', 'success');
      onClose();
      go('study', { id: r.id });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Create study material"
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={Sparkles} loading={busy} disabled={!sources.length || !ai.configured || (type === 'quiz' && !quizTypes.length)} onClick={generate}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <AiGate />
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label">Type</div>
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'flashcards', label: 'Flashcards' },
                { value: 'quiz', label: 'Quiz' },
                { value: 'reviewer', label: 'Reviewer' },
              ]}
            />
          </div>
          {type !== 'reviewer' && (
            <Field label={type === 'quiz' ? 'Questions' : 'Cards'}>
              <input type="number" min={3} max={40} className="input w-20" value={count} onChange={(e) => setCount(+e.target.value)} />
            </Field>
          )}
          <Field label="Save under subject" className="w-44">
            <SubjectSelect value={subjectId} onChange={setSubjectId} />
          </Field>
        </div>
        {type === 'quiz' && (
          <div>
            <div className="label">Question types</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {QUIZ_TYPES.map((q) => (
                <label key={q.id} className="flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" className="accent-(--accent)" checked={quizTypes.includes(q.id)} onChange={() => setQuizTypes((t) => (t.includes(q.id) ? t.filter((x) => x !== q.id) : [...t, q.id]))} />
                  {q.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="label">Build it from</div>
          <SourcePicker value={sources} onChange={setSources} />
        </div>
        <Field label="Title (optional)">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Named after the first source if left empty" />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Row of AI actions for one library item.
 * source: {type, id, title, subjectId}; getSelection(): optional currently selected text.
 */
export function SourceActions({ source, getSelection, compact, prepare }) {
  const { fail, toast, go } = useApp();
  const [summary, setSummary] = useState(null);
  const [study, setStudy] = useState(false);
  const [finding, setFinding] = useState(false);

  async function findTerms() {
    setFinding(true);
    try {
      await prepare?.();
      const r = await api('glossary.extract', { sourceType: source.type, sourceId: source.id });
      emit('glossary');
      toast(r.added.length ? `${r.added.length} new term${r.added.length > 1 ? 's' : ''} explained: ${r.added.slice(0, 4).map((t) => t.term).join(', ')}${r.added.length > 4 ? '…' : ''}` : 'No new terms found. Everything important here is already in your glossary.', 'success');
      if (r.truncated) toast('This source is very long, so only the first part was scanned for terms.', 'info');
    } catch (e) {
      fail(e);
    } finally {
      setFinding(false);
    }
  }
  const openSummary = async () => {
    const sel = (getSelection?.() ?? window.getSelection()?.toString() ?? '').trim();
    await prepare?.();
    setSummary({ selection: sel.length >= 40 ? sel : null });
  };
  const size = compact ? 'sm' : undefined;
  return (
    <>
      <Button size={size} icon={ListChecks} onClick={openSummary}>
        Summarize
      </Button>
      <Button size={size} icon={BookOpen} loading={finding} onClick={findTerms}>
        {finding ? 'Finding terms…' : 'Explain terms'}
      </Button>
      <Button size={size} icon={GraduationCap} onClick={async () => (await prepare?.(), setStudy(true))}>
        Study
      </Button>
      <Button size={size} icon={MessageSquare} onClick={() => go('assistant', { scope: { mode: 'sources', sources: [{ type: source.type, id: source.id, title: source.title }] } })}>
        Ask AI
      </Button>
      <SummaryModal open={!!summary} onClose={() => setSummary(null)} source={source} selection={summary?.selection} />
      <StudyModal open={study} onClose={() => setStudy(false)} initialSources={[source]} />
    </>
  );
}

export function FavoriteButton({ on, onToggle }) {
  return <IconButton icon={on ? StarOn : StarOff} label={on ? 'Remove from favorites' : 'Add to favorites'} onClick={onToggle} className={on ? 'text-warn hover:text-warn' : ''} />;
}
function StarOff(props) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
function StarOn(props) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
