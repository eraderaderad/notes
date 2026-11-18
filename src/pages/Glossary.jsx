import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Bookmark, BookmarkCheck, Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { TermForm } from '../components/TermDrawer.jsx';
import { Button, Empty, Segmented } from '../components/ui.jsx';
import { emit, useBus } from '../lib/audio.js';
import { cn } from '../lib/format.js';

export default function Glossary() {
  const { fail, openTerm, termView } = useApp();
  const [terms, setTerms] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);

  const load = () => api('glossary.list').then(setTerms).catch(fail);
  useEffect(() => void load(), []);
  useBus('glossary', load);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (terms || []).filter((t) => (filter === 'all' || (filter === 'saved') === t.saved) && (!k || t.term.toLowerCase().includes(k) || t.simple.toLowerCase().includes(k)));
  }, [terms, q, filter]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of shown) {
      const letter = /[a-z]/i.test(t.term[0]) ? t.term[0].toUpperCase() : '#';
      if (!m.has(letter)) m.set(letter, []);
      m.get(letter).push(t);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  async function toggleSaved(t) {
    await api('glossary.setSaved', { id: t.id, saved: !t.saved });
    emit('glossary');
  }
  const counts = { all: terms?.length || 0, saved: terms?.filter((t) => t.saved).length || 0 };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-8 py-3">
        <h1 className="text-lg font-semibold">Glossary</h1>
        <div className="relative w-72">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input className="input pl-8" placeholder="Search terms" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search glossary" />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${counts.all})` },
            { value: 'saved', label: `Saved (${counts.saved})` },
            { value: 'discovered', label: `Discovered (${counts.all - counts.saved})` },
          ]}
        />
        <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setAdding(true)}>
          Add term
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {terms && !terms.length ? (
          <Empty icon={BookOpen} title="Your glossary is empty" text="Use “Explain terms” on a note, transcript or document and the AI will identify and explain the important vocabulary. You can also add terms by hand.">
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add a term
            </Button>
          </Empty>
        ) : terms && !shown.length ? (
          <Empty icon={Search} title="No terms match" text="Try a different search or filter." />
        ) : (
          <div className="anim-fade mx-auto max-w-6xl space-y-6 px-8 py-6">
            {groups.map(([letter, items]) => (
              <section key={letter}>
                <h2 className="section-title mb-2">{letter}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((t) => (
                    <div key={t.id} role="button" tabIndex={0} onClick={() => openTerm(t.id)} onKeyDown={(e) => e.key === 'Enter' && openTerm(t.id)} className={cn('card cursor-pointer px-4 py-3 transition-colors hover:border-accent/50', termView?.id === t.id && 'border-accent')}>
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[14px] font-semibold break-words">{t.term}</span>
                        <button
                          type="button"
                          title={t.saved ? 'Saved to your glossary' : 'Save to your glossary'}
                          aria-label={t.saved ? 'Unsave term' : 'Save term'}
                          className={cn('shrink-0 rounded p-0.5', t.saved ? 'text-accent' : 'text-muted hover:text-accent')}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSaved(t);
                          }}
                        >
                          {t.saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-3 text-xs text-muted">{t.simple || t.detailed || 'No definition yet.'}</p>
                      {t.related.length > 0 && <div className="mt-2 truncate text-[11px] text-muted">Related: {t.related.slice(0, 3).join(', ')}</div>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <TermForm open={adding} onClose={() => setAdding(false)} onSaved={(t) => openTerm(t.id)} />
    </div>
  );
}
