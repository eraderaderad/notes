import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileText, FileUp, Folder, MoreHorizontal, NotebookPen, Pencil, Plus, Settings2, Sparkles, Star, Tag, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { DOC_ACCEPT, useApp } from '../app-context.jsx';
import { Highlighted } from '../components/content.jsx';
import { FavoriteButton, SourceActions, SubjectSelect } from '../components/SourceTools.jsx';
import { Button, Empty, IconButton, Menu, Modal, Segmented, Spinner, useDialogs } from '../components/ui.jsx';
import Editor from '../editor/Editor.jsx';
import { useBus } from '../lib/audio.js';
import { cn, download, exportContent, fmtBytes, fmtDate, mdToHtml, wordCount } from '../lib/format.js';

function TagInput({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim().replace(/^#/, '');
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Tag size={13} className="shrink-0 text-muted" />
      {value.map((t) => (
        <span key={t} className="chip">
          {t}
          <button type="button" aria-label={`Remove tag ${t}`} className="hover:text-danger" onClick={() => onChange(value.filter((x) => x !== t))}>
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        className="w-24 bg-transparent text-xs placeholder:text-muted/70 focus:outline-none"
        placeholder="Add tag"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

function SubjectsModal({ open, onClose }) {
  const { subjects, refreshSubjects, fail } = useApp();
  const { prompt, confirm } = useDialogs();
  const act = async (fn) => {
    try {
      await fn();
      await refreshSubjects();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Subjects" width="max-w-md">
      <div className="space-y-1">
        {subjects.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface2">
            <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
            <span className="text-xs text-muted">{s.note_count} notes</span>
            <IconButton
              icon={Pencil}
              label="Rename subject"
              size={13}
              onClick={async () => {
                const name = await prompt({ title: 'Rename subject', value: s.name, confirmLabel: 'Rename' });
                if (name?.trim()) act(() => api('subjects.rename', { id: s.id, name }));
              }}
            />
            <IconButton
              icon={Trash2}
              label="Delete subject"
              size={13}
              onClick={async () => {
                if (await confirm({ title: `Delete subject “${s.name}”?`, text: 'Notes, recordings and documents in this subject are kept; they just become unassigned.', confirmLabel: 'Delete subject', danger: true })) act(() => api('subjects.delete', { id: s.id }));
              }}
            />
          </div>
        ))}
        {!subjects.length && <p className="py-4 text-center text-[13px] text-muted">No subjects yet.</p>}
      </div>
      <Button
        icon={Plus}
        className="mt-3"
        onClick={async () => {
          const name = await prompt({ title: 'New subject', placeholder: 'e.g. Computer Networks', confirmLabel: 'Create' });
          if (name?.trim()) act(() => api('subjects.create', { name }));
        }}
      >
        New subject
      </Button>
    </Modal>
  );
}

// ---------------------------------------------------------------- note editor
function NoteView({ id, onChanged, onDeleted }) {
  const { fail, toast, settings } = useApp();
  const { confirm } = useDialogs();
  const [note, setNote] = useState(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | error
  const [words, setWords] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [folders, setFolders] = useState([]);
  const pending = useRef(null);
  const timer = useRef(null);
  const editorHandle = useRef(null);
  const latest = useRef({ html: '', text: '' });

  useEffect(() => {
    api('notes.get', { id })
      .then((n) => {
        setNote(n);
        setTitle(n.title);
        setWords(wordCount(n.content_text));
        setUpdatedAt(n.updated_at);
        latest.current = { html: n.content_html, text: n.content_text };
      })
      .catch(fail);
    api('notes.facets').then((f) => setFolders([...new Set(f.folders.map((x) => x.folder))]));
  }, [id]);

  async function flush() {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setStatus('saving');
    try {
      const r = await api('notes.update', { id, ...p });
      setUpdatedAt(r.updated_at);
      if (!pending.current) setStatus('saved');
      onChanged();
    } catch (e) {
      pending.current = { ...p, ...pending.current };
      setStatus('error');
    }
  }
  function queue(patch, delay = 700) {
    pending.current = { ...pending.current, ...patch };
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }
  // Save anything outstanding when leaving the note or closing the window.
  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [id]);

  if (!note)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );

  const meta = (patch) => {
    setNote((n) => ({ ...n, ...patch }));
    const map = { subject_id: 'subjectId' };
    queue(Object.fromEntries(Object.entries(patch).map(([k, v]) => [map[k] || k, v])), 250);
  };
  async function remove() {
    if (!(await confirm({ title: 'Move this note to Trash?', text: 'You can restore it from Trash later.', confirmLabel: 'Move to Trash', danger: true }))) return;
    pending.current = null;
    await api('trash.move', { type: 'note', id });
    toast('Note moved to Trash');
    onDeleted();
  }
  const doExport = (format) => exportContent({ title, html: latest.current.html, text: latest.current.text }, format);
  const source = { type: 'note', id, title, subjectId: note.subject_id };

  return (
    <div className="anim-fade flex h-full flex-col bg-surface">
      <div className="border-b border-line px-6 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 bg-transparent text-[22px] font-semibold tracking-tight placeholder:text-muted/60 focus:outline-none"
            value={title}
            placeholder="Untitled note"
            aria-label="Note title"
            onChange={(e) => {
              setTitle(e.target.value);
              queue({ title: e.target.value });
            }}
          />
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted" aria-live="polite">
            {status === 'saved' && (
              <>
                <Check size={12} className="text-accent" /> Saved
              </>
            )}
            {(status === 'dirty' || status === 'saving') && (
              <>
                <Spinner size={11} /> Saving…
              </>
            )}
            {status === 'error' && (
              <button type="button" className="flex items-center gap-1 text-danger" onClick={flush}>
                <AlertTriangle size={12} /> Not saved, retry
              </button>
            )}
          </span>
          <FavoriteButton on={note.favorite} onToggle={() => meta({ favorite: !note.favorite })} />
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More actions" />}
            items={[
              { label: `Export as ${({ md: 'Markdown', html: 'HTML', txt: 'plain text' })[settings.exportFormat]}`, icon: Download, onClick: () => doExport(settings.exportFormat) },
              settings.exportFormat !== 'md' && { label: 'Export as Markdown', icon: Download, onClick: () => doExport('md') },
              settings.exportFormat !== 'html' && { label: 'Export as HTML', icon: Download, onClick: () => doExport('html') },
              settings.exportFormat !== 'txt' && { label: 'Export as plain text', icon: Download, onClick: () => doExport('txt') },
              'sep',
              { label: 'Move to Trash', icon: Trash2, danger: true, onClick: remove },
            ]}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <SubjectSelect value={note.subject_id} onChange={(v) => meta({ subject_id: v })} className="h-7 w-40 py-0 text-xs" />
          <div className="flex items-center gap-1">
            <Folder size={13} className="text-muted" />
            <input className="w-28 bg-transparent text-xs placeholder:text-muted/70 focus:outline-none" placeholder="Folder" list="erad-folders" value={note.folder} aria-label="Folder" onChange={(e) => meta({ folder: e.target.value })} />
            <datalist id="erad-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          <TagInput value={note.tags} onChange={(tags) => meta({ tags })} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <SourceActions compact source={source} prepare={flush} getSelection={() => editorHandle.current?.getSelectionText() || ''} />
          <span className="ml-auto text-xs text-muted tabular-nums">
            {words.toLocaleString()} word{words === 1 ? '' : 's'} · Last edited {fmtDate(updatedAt)}
          </span>
        </div>
      </div>
      <Editor
        key={id}
        handle={editorHandle}
        initialHtml={note.content_html}
        onChange={({ html, text }) => {
          latest.current = { html, text };
          setWords(wordCount(text));
          queue({ html, text });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- document viewer
function DocView({ id, onChanged, onDeleted }) {
  const { fail, toast, go, ai } = useApp();
  const { confirm, prompt } = useDialogs();
  const [doc, setDoc] = useState(null);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    setDoc(null);
    api('documents.get', { id }).then(setDoc).catch(fail);
  }, [id]);
  const paras = useMemo(() => (doc ? doc.text.split(/\n{2,}/) : []), [doc]);
  if (!doc)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  const patch = async (p) => {
    setDoc((d) => ({ ...d, ...p }));
    await api('documents.update', { id, title: p.title, subjectId: p.subject_id, favorite: p.favorite });
    onChanged();
  };
  async function makeNotes() {
    setMaking(true);
    try {
      const s = await api('summaries.create', { sourceType: 'document', sourceId: id, style: 'detailed' });
      const note = await api('notes.create', { title: `Notes: ${doc.title}`, html: mdToHtml(s.content), text: s.content, subjectId: doc.subject_id, sourceType: 'document', sourceId: id });
      toast('Notes generated from the document', 'success');
      go('notes', { noteId: note.id });
    } catch (e) {
      fail(e);
    } finally {
      setMaking(false);
    }
  }
  return (
    <div className="anim-fade flex h-full flex-col bg-surface">
      <div className="border-b border-line px-6 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <FileText size={18} className="shrink-0 text-muted" />
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight">{doc.title}</h1>
          <FavoriteButton on={doc.favorite} onToggle={() => patch({ favorite: !doc.favorite })} />
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More actions" />}
            items={[
              {
                label: 'Rename',
                icon: Pencil,
                onClick: async () => {
                  const t = await prompt({ title: 'Rename document', value: doc.title, confirmLabel: 'Rename' });
                  if (t?.trim()) patch({ title: t.trim() });
                },
              },
              {
                label: 'Save original file…',
                icon: Download,
                onClick: async () => {
                  const f = await api('documents.file', { id });
                  download(f.data, f.name);
                },
              },
              'sep',
              {
                label: 'Move to Trash',
                icon: Trash2,
                danger: true,
                onClick: async () => {
                  if (!(await confirm({ title: 'Move this document to Trash?', text: 'The original file is kept until you empty the Trash.', confirmLabel: 'Move to Trash', danger: true }))) return;
                  await api('trash.move', { type: 'document', id });
                  onDeleted();
                },
              },
            ]}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="chip uppercase">{doc.type}</span>
          <span>Original: {doc.original_name}</span>
          <span>· {fmtBytes(doc.size)}</span>
          <span>· {wordCount(doc.text).toLocaleString()} words extracted</span>
          <span>· Imported {fmtDate(doc.created_at)}</span>
          <SubjectSelect value={doc.subject_id} onChange={(v) => patch({ subject_id: v })} className="ml-auto h-7 w-40 py-0 text-xs" />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <SourceActions compact source={{ type: 'document', id, title: doc.title, subjectId: doc.subject_id }} />
          <Button size="sm" icon={Sparkles} loading={making} disabled={!ai.configured && making} onClick={makeNotes}>
            {making ? 'Writing notes…' : 'Generate notes'}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-3 px-10 py-6 text-[14.5px] leading-relaxed">
          {paras.map((p, i) => {
            const m = p.match(/^\[(Page|Slide) (\d+)\]\n?/);
            return (
              <div key={i}>
                {m && <div className="section-title mt-4 mb-1 border-t border-line pt-3">{m[1]} {m[2]}</div>}
                <p className="whitespace-pre-wrap">
                  <Highlighted text={m ? p.slice(m[0].length) : p} />
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Notes({ params, nav }) {
  const { subjects, pickAndImport, fail, settings } = useApp();
  const [tab, setTab] = useState('notes');
  const [notes, setNotes] = useState([]);
  const [docs, setDocs] = useState([]);
  const [facets, setFacets] = useState({ folders: [], tags: [] });
  const [filter, setFilter] = useState({ subjectId: '', folder: null, tag: null, favorite: false });
  const [sel, setSel] = useState(null); // {type:'note'|'document', id}
  const [manage, setManage] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const [n, d, f] = await Promise.all([api('notes.list', { subjectId: filter.subjectId || undefined, folder: filter.folder ?? undefined, tag: filter.tag || undefined, favorite: filter.favorite }), api('documents.list'), api('notes.facets')]);
    setNotes(n);
    setDocs(d);
    setFacets(f);
    setLoaded(true);
  };
  useEffect(() => void load().catch(fail), [filter]);
  useBus('documents', load);

  async function createNote() {
    try {
      const n = await api('notes.create', { subjectId: filter.subjectId && filter.subjectId !== 'none' ? +filter.subjectId : null, folder: filter.folder || '' });
      setTab('notes');
      await load();
      setSel({ type: 'note', id: n.id });
    } catch (e) {
      fail(e);
    }
  }

  // Navigation parameters (open a specific item, create a note, show documents).
  useEffect(() => {
    if (params.create) createNote();
    else if (params.noteId) (setTab('notes'), setSel({ type: 'note', id: params.noteId }));
    else if (params.docId) (setTab('documents'), setSel({ type: 'document', id: params.docId }));
    else if (params.tab) setTab(params.tab);
  }, [nav]);

  const shownDocs = docs.filter((d) => (!filter.subjectId || (filter.subjectId === 'none' ? !d.subject_id : d.subject_id === +filter.subjectId)) && (!filter.favorite || d.favorite));
  const subjName = (id) => subjects.find((s) => s.id === id)?.name;
  const folders = facets.folders.filter((f) => !filter.subjectId || (filter.subjectId === 'none' ? !f.subjectId : f.subjectId === +filter.subjectId));
  const folderNames = [...new Set(folders.map((f) => f.folder))].sort();

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-line bg-bg">
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <Segmented
              className="flex-1 [&>button]:flex-1"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'notes', label: `Notes${loaded ? ` (${notes.length})` : ''}` },
                { value: 'documents', label: `Documents${loaded ? ` (${shownDocs.length})` : ''}` },
              ]}
            />
            {tab === 'notes' ? <IconButton icon={Plus} label="New note" onClick={createNote} className="border border-line bg-surface" /> : <IconButton icon={FileUp} label="Import document" onClick={() => pickAndImport(DOC_ACCEPT)} className="border border-line bg-surface" />}
          </div>
          <div className="flex items-center gap-1.5">
            <select className="input h-7 flex-1 py-0 text-xs" value={filter.subjectId} aria-label="Filter by subject" onChange={(e) => setFilter((f) => ({ ...f, subjectId: e.target.value, folder: null }))}>
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="none">No subject</option>
            </select>
            <IconButton icon={Star} label="Show favorites only" active={filter.favorite} onClick={() => setFilter((f) => ({ ...f, favorite: !f.favorite }))} />
            <IconButton icon={Settings2} label="Manage subjects" onClick={() => setManage(true)} />
          </div>
          {tab === 'notes' && (folderNames.length > 0 || facets.tags.length > 0) && (
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
              {folderNames.map((f) => (
                <button key={'f' + f} type="button" onClick={() => setFilter((x) => ({ ...x, folder: x.folder === f ? null : f }))} className={cn('chip', filter.folder === f && 'bg-accent-soft text-accent')}>
                  <Folder size={10} /> {f}
                </button>
              ))}
              {facets.tags.map((t) => (
                <button key={'t' + t.tag} type="button" onClick={() => setFilter((x) => ({ ...x, tag: x.tag === t.tag ? null : t.tag }))} className={cn('chip', filter.tag === t.tag && 'bg-accent-soft text-accent')}>
                  #{t.tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'notes' &&
            notes.map((n) => (
              <button key={n.id} type="button" onClick={() => setSel({ type: 'note', id: n.id })} className={cn('block w-full border-b border-line px-3.5 py-2.5 text-left transition-colors', sel?.type === 'note' && sel.id === n.id ? 'bg-surface' : 'hover:bg-surface/60')}>
                <div className="flex items-center gap-1.5">
                  {n.favorite && <Star size={11} className="shrink-0 fill-current text-warn" />}
                  <span className="truncate text-[13px] font-semibold">{n.title}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.snippet || 'Empty note'}</p>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                  <span>{fmtDate(n.updated_at)}</span>
                  {n.subject_id && <span className="truncate">· {subjName(n.subject_id)}</span>}
                  {n.folder && <span className="truncate">/ {n.folder}</span>}
                </div>
              </button>
            ))}
          {tab === 'notes' && loaded && !notes.length && <div className="px-5 py-8 text-center text-xs text-muted">{filter.subjectId || filter.folder || filter.tag || filter.favorite ? 'No notes match these filters.' : 'No notes yet.'}</div>}
          {tab === 'documents' &&
            shownDocs.map((d) => (
              <button key={d.id} type="button" onClick={() => setSel({ type: 'document', id: d.id })} className={cn('block w-full border-b border-line px-3.5 py-2.5 text-left transition-colors', sel?.type === 'document' && sel.id === d.id ? 'bg-surface' : 'hover:bg-surface/60')}>
                <div className="flex items-center gap-1.5">
                  {d.favorite && <Star size={11} className="shrink-0 fill-current text-warn" />}
                  <span className="truncate text-[13px] font-semibold">{d.title}</span>
                  <span className="chip ml-auto shrink-0 uppercase">{d.type}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{d.snippet.replace(/\[(Page|Slide) \d+\]/g, '')}</p>
                <div className="mt-1 text-[11px] text-muted">
                  {fmtDate(d.created_at)}
                  {d.subject_id && ` · ${subjName(d.subject_id)}`}
                </div>
              </button>
            ))}
          {tab === 'documents' && loaded && !shownDocs.length && <div className="px-5 py-8 text-center text-xs text-muted">No documents imported yet. PDF, DOCX, PPTX, TXT and Markdown are supported.</div>}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {sel?.type === 'note' ? (
          <NoteView key={sel.id} id={sel.id} onChanged={load} onDeleted={() => (setSel(null), load())} />
        ) : sel?.type === 'document' ? (
          <DocView id={sel.id} onChanged={load} onDeleted={() => (setSel(null), load())} />
        ) : (
          <Empty icon={NotebookPen} title="Select a note or create a new one" text={`Notes save automatically as you type. Exports default to ${({ md: 'Markdown', html: 'HTML', txt: 'plain text' })[settings.exportFormat]}.`}>
            <Button variant="primary" icon={Plus} onClick={createNote}>
              New note
            </Button>
            <Button icon={FileUp} onClick={() => pickAndImport(DOC_ACCEPT)}>
              Import document
            </Button>
          </Empty>
        )}
      </div>
      <SubjectsModal open={manage} onClose={() => (setManage(false), load())} />
    </div>
  );
}
