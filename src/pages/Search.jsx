import { useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon, Star } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { TYPE_ICON } from '../components/SourceTools.jsx';
import { Empty, Spinner } from '../components/ui.jsx';
import { TYPE_LABEL, cn, fmtClock, fmtDate } from '../lib/format.js';

const TYPES = ['note', 'recording', 'document', 'glossary', 'study'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Mark({ text, q }) {
  const parts = useMemo(() => (q ? text.split(new RegExp(`(${esc(q)})`, 'gi')) : [text]), [text, q]);
  return parts.map((p, i) => (q && p.toLowerCase() === q.toLowerCase() ? <mark key={i} className="rounded-sm bg-(--mark) px-0.5 text-ink">{p}</mark> : p));
}

export default function Search({ params, nav }) {
  const { subjects, openSource, fail } = useApp();
  const [q, setQ] = useState(params.q || '');
  const [f, setF] = useState({ types: [], subjectId: '', tag: '', from: '', to: '', fileType: '', favorite: false });
  const [results, setResults] = useState(null);
  const [tags, setTags] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setQ(params.q || ''), [nav]);
  useEffect(() => {
    api('notes.facets').then((x) => setTags(x.tags));
  }, []);
  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setResults(await api('search.query', { q, types: f.types, subjectId: f.subjectId ? +f.subjectId : undefined, tag: f.tag || undefined, from: f.from || undefined, to: f.to || undefined, fileType: f.fileType || undefined, favorite: f.favorite }));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, f]);

  const toggleType = (t) => setF((x) => ({ ...x, types: x.types.includes(t) ? x.types.filter((y) => y !== t) : [...x.types, t] }));
  const active = q.trim() || f.subjectId || f.tag || f.from || f.to || f.fileType || f.favorite;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-line bg-surface px-8 py-3">
        <div className="relative max-w-2xl">
          <SearchIcon size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input autoFocus className="input h-10 pl-9 text-sm" placeholder="Search titles, note content, transcripts, documents, glossary and study materials" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {busy && <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-muted" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => toggleType(t)} className={cn('chip px-2.5 py-1', f.types.includes(t) && 'bg-accent-soft text-accent')}>
              {TYPE_LABEL[t]}s
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <select className="input h-7 w-36 py-0 text-xs" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })} aria-label="Subject">
            <option value="">Any subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input h-7 w-28 py-0 text-xs" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} aria-label="Tag">
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                #{t.tag}
              </option>
            ))}
          </select>
          <select className="input h-7 w-28 py-0 text-xs" value={f.fileType} onChange={(e) => setF({ ...f, fileType: e.target.value })} aria-label="File type">
            <option value="">Any file type</option>
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
            <option value="pptx">PPTX</option>
            <option value="txt">TXT</option>
            <option value="md">Markdown</option>
            <option value="audio">Audio</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted">
            From
            <input type="date" className="input h-7 w-32 py-0 text-xs" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            to
            <input type="date" className="input h-7 w-32 py-0 text-xs" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </label>
          <button type="button" onClick={() => setF({ ...f, favorite: !f.favorite })} className={cn('chip px-2.5 py-1', f.favorite && 'bg-warn-soft text-warn')}>
            <Star size={11} /> Favorites
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!active ? (
          <Empty icon={SearchIcon} title="Search your whole library" text="Type a word or phrase, or pick a filter. Results cover note titles and content, transcripts, imported documents, glossary entries and study materials." />
        ) : results && !results.length ? (
          <Empty icon={SearchIcon} title="No results" text="Nothing in your library matches. Try fewer words or remove a filter." />
        ) : (
          <div className="mx-auto max-w-4xl px-8 py-5">
            <div className="mb-2 text-xs text-muted">{results ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}</div>
            <div className="card divide-y divide-line">
              {(results || []).map((r) => {
                const Icon = TYPE_ICON[r.type];
                return (
                  <button key={r.type + r.id} type="button" onClick={() => openSource(r)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-surface2">
                    <Icon size={16} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-semibold">
                          <Mark text={r.title} q={q.trim()} />
                        </span>
                        {r.favorite && <Star size={11} className="shrink-0 fill-current text-warn" />}
                        <span className="chip shrink-0">{r.type === 'document' ? r.fileType.toUpperCase() : TYPE_LABEL[r.type]}</span>
                        {r.at != null && <span className="chip shrink-0 bg-accent-soft text-accent">at {fmtClock(r.at)}</span>}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                        <Mark text={r.snippet || ''} q={q.trim()} />
                      </span>
                      <span className="mt-1 block text-[11px] text-muted">
                        {fmtDate(r.date)}
                        {r.subjectId && ` · ${subjects.find((s) => s.id === r.subjectId)?.name || ''}`}
                        {r.tags?.length > 0 && ` · ${r.tags.map((t) => '#' + t).join(' ')}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
