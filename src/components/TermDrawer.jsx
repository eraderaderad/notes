// Slide-in panel that explains a glossary term. Opened from highlights, the glossary and search.
import { useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck, ChevronsDown, ChevronsUp, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { emit } from '../lib/audio.js';
import { Button, Field, IconButton, Modal, Spinner, useDialogs } from './ui.jsx';

function Section({ title, children }) {
  if (!children) return null;
  return (
    <div>
      <div className="section-title mb-1">{title}</div>
      <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{children}</p>
    </div>
  );
}

export function TermForm({ open, onClose, initial, onSaved }) {
  const { fail, toast } = useApp();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (open) setF({ term: '', simple: '', detailed: '', example: '', application: '', ...initial, related: (initial?.related || []).join(', ') });
  }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy('save');
    try {
      const row = await api('glossary.save', { ...f, id: initial?.id, saved: true });
      emit('glossary');
      toast(initial?.id ? 'Term updated' : 'Term added to your glossary', 'success');
      onSaved?.(row);
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  async function fill() {
    if (!f.term?.trim()) return fail(new Error('Enter the term first.'));
    setBusy('ai');
    try {
      const row = await api('glossary.explain', { term: f.term, save: true });
      emit('glossary');
      toast('Explanation generated and saved', 'success');
      onSaved?.(row);
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?.id ? 'Edit term' : 'Add a term'}
      footer={
        <>
          {!initial?.id && (
            <Button icon={Sparkles} loading={busy === 'ai'} disabled={!!busy} onClick={fill} className="mr-auto">
              Explain with AI
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!!busy || !f.term?.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Term">
          <input className="input" autoFocus value={f.term || ''} onChange={set('term')} placeholder="e.g. DHCP" />
        </Field>
        <Field label="Simple definition">
          <textarea className="input" rows={2} value={f.simple || ''} onChange={set('simple')} />
        </Field>
        <Field label="Detailed explanation">
          <textarea className="input" rows={3} value={f.detailed || ''} onChange={set('detailed')} />
        </Field>
        <Field label="Example">
          <textarea className="input" rows={2} value={f.example || ''} onChange={set('example')} />
        </Field>
        <Field label="Real-world application">
          <textarea className="input" rows={2} value={f.application || ''} onChange={set('application')} />
        </Field>
        <Field label="Related concepts" hint="Separate with commas">
          <input className="input" value={f.related || ''} onChange={set('related')} />
        </Field>
      </div>
    </Modal>
  );
}

export default function TermDrawer() {
  const { termView, setTermView, openTerm, fail, toast, ai, openSource } = useApp();
  const { confirm } = useDialogs();
  const [term, setTerm] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | missing
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!termView) return;
    let live = true;
    setState('loading');
    setTerm(null);
    api('glossary.get', termView.id ? { id: termView.id } : { term: termView.term })
      .then((t) => {
        if (!live) return;
        setTerm(t);
        setState(t ? 'idle' : 'missing');
      })
      .catch((e) => {
        fail(e);
        setTermView(null);
      });
    return () => (live = false);
  }, [termView]);

  useEffect(() => {
    if (!termView) return;
    const h = (e) => e.key === 'Escape' && !editing && setTermView(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [termView, editing]);

  if (!termView) return null;

  async function run(name, fn) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }
  const explainMissing = () =>
    run('explain', async () => {
      const t = await api('glossary.explain', { term: termView.term, context: termView.context || '' });
      emit('glossary');
      setTerm(t);
      setState('idle');
    });
  const reexplain = (mode) =>
    run(mode, async () => {
      setTerm(await api('glossary.reexplain', { id: term.id, mode }));
      emit('glossary');
      toast(mode === 'simpler' ? 'Rewritten in simpler words' : 'Expanded with more detail', 'success');
    });
  const toggleSaved = () =>
    run('save', async () => {
      await api('glossary.setSaved', { id: term.id, saved: !term.saved });
      setTerm({ ...term, saved: !term.saved });
      emit('glossary');
      toast(term.saved ? 'Removed from saved terms' : 'Saved to your glossary', 'success');
    });
  async function remove() {
    if (!(await confirm({ title: `Delete "${term.term}"?`, text: 'The explanation is removed from your glossary and will no longer be highlighted.', confirmLabel: 'Delete', danger: true }))) return;
    await run('delete', async () => {
      await api('glossary.delete', { id: term.id });
      emit('glossary');
      setTermView(null);
    });
  }

  return (
    <aside className="anim-slide fixed top-0 right-0 z-40 flex h-full w-[400px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-2xl" aria-label="Term explanation">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="section-title">Glossary term</div>
          <h2 className="mt-0.5 text-xl font-semibold break-words">{term?.term || termView.term || '…'}</h2>
          {term && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="chip">{term.origin === 'ai' ? 'AI explanation' : 'Written by you'}</span>
              {term.saved && <span className="chip bg-accent-soft text-accent">Saved</span>}
              {term.source_type && (
                <button type="button" className="chip hover:text-ink" onClick={() => (setTermView(null), openSource({ type: term.source_type, id: term.source_id }))}>
                  Open source {term.source_type}
                </button>
              )}
            </div>
          )}
        </div>
        <IconButton icon={X} label="Close" onClick={() => setTermView(null)} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading…
          </div>
        )}
        {state === 'missing' && (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">“{termView.term}” is not in your glossary yet.</p>
            <Button variant="primary" icon={Sparkles} loading={busy === 'explain'} onClick={explainMissing}>
              Explain this term
            </Button>
            {!ai.configured && <p className="text-xs text-muted">Needs an AI provider. You can also add the term by hand from the Glossary page.</p>}
          </div>
        )}
        {term && (
          <>
            <Section title="Simple definition">{term.simple}</Section>
            <Section title="Detailed explanation">{term.detailed}</Section>
            <Section title="Example">{term.example}</Section>
            <Section title="Real-world application">{term.application}</Section>
            {term.related.length > 0 && (
              <div>
                <div className="section-title mb-1.5">Related concepts</div>
                <div className="flex flex-wrap gap-1.5">
                  {term.related.map((r) => (
                    <button key={r} type="button" className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent" onClick={() => openTerm({ term: r, context: `Related to ${term.term}: ${term.simple}` })}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!term.simple && !term.detailed && <p className="text-[13px] text-muted">No explanation written yet. Use Edit to add one.</p>}
          </>
        )}
      </div>

      {term && (
        <div className="space-y-2 border-t border-line px-5 py-3">
          <div className="flex gap-2">
            <Button className="flex-1" icon={ChevronsDown} loading={busy === 'simpler'} disabled={!!busy} onClick={() => reexplain('simpler')}>
              Simpler
            </Button>
            <Button className="flex-1" icon={ChevronsUp} loading={busy === 'detailed'} disabled={!!busy} onClick={() => reexplain('detailed')}>
              More detail
            </Button>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" variant={term.saved ? 'default' : 'primary'} icon={term.saved ? BookmarkCheck : Bookmark} loading={busy === 'save'} disabled={!!busy} onClick={toggleSaved}>
              {term.saved ? 'Saved' : 'Save to glossary'}
            </Button>
            <IconButton icon={Pencil} label="Edit term" onClick={() => setEditing(true)} className="h-8 w-8 border border-line" />
            <IconButton icon={Trash2} label="Delete term" onClick={remove} className="h-8 w-8 border border-line" />
          </div>
        </div>
      )}
      <TermForm open={editing} onClose={() => setEditing(false)} initial={term} onSaved={setTerm} />
    </aside>
  );
}
