import { useEffect, useState } from 'react';
import { BookOpen, Clock, FileText, FileUp, Mic, NotebookPen, Plus, Search, Sparkles, Star, Upload } from 'lucide-react';
import { api } from '../api.js';
import { AUDIO_ACCEPT, DOC_ACCEPT, useApp } from '../app-context.jsx';
import { useBus } from '../lib/audio.js';
import { fmtClock, fmtDate, fmtDuration } from '../lib/format.js';

function Stat({ icon: Icon, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} className="card flex items-center gap-3 px-4 py-3 text-left transition-colors hover:border-accent/50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <Icon size={17} />
      </div>
      <div className="min-w-0">
        <div className="text-xl leading-tight font-semibold tabular-nums">{value}</div>
        <div className="truncate text-xs text-muted">{label}</div>
      </div>
    </button>
  );
}

function Quick({ icon: Icon, label, hint, onClick }) {
  return (
    <button type="button" onClick={onClick} className="card group flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
      <Icon size={17} className="shrink-0 text-muted group-hover:text-accent" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block truncate text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  );
}

export default function Dashboard() {
  const { go, pickAndImport, openTerm, ai } = useApp();
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('dashboard.stats').then(setStats);
  useEffect(() => void load(), []);
  useBus('recordings', load);
  useBus('glossary', load);
  useBus('documents', load);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (!stats) return null;
  const empty = !stats.notes && !stats.recordings && !stats.documents;

  return (
    <div className="h-full overflow-y-auto">
      <div className="anim-fade mx-auto max-w-6xl space-y-6 px-8 py-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · {empty ? 'Your library is empty. Start with a note, a recording, or a document.' : 'Here is where you left off.'}
          </p>
        </div>

        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) go('search', { q });
          }}
        >
          <Search size={17} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <input className="input h-11 pl-10 text-sm" placeholder="Search your notes, transcripts and glossary" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your library" />
        </form>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={NotebookPen} label="Notes" value={stats.notes} onClick={() => go('notes')} />
          <Stat icon={Clock} label={`Recorded audio · ${stats.recordings} recording${stats.recordings === 1 ? '' : 's'}`} value={fmtDuration(stats.audioSeconds)} onClick={() => go('recordings')} />
          <Stat icon={FileText} label="Imported documents" value={stats.documents} onClick={() => go('notes', { tab: 'documents' })} />
          <Stat icon={BookOpen} label="Glossary terms" value={stats.terms} onClick={() => go('glossary')} />
        </div>

        <section>
          <h2 className="section-title mb-2">Quick actions</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Quick icon={Plus} label="Create New Note" hint="Blank note with autosave" onClick={() => go('notes', { create: true })} />
            <Quick icon={Mic} label="Start Recording" hint="Record and transcribe" onClick={() => go('recordings', { record: true })} />
            <Quick icon={Upload} label="Import Audio" hint="WAV, MP3, M4A and more" onClick={() => pickAndImport(AUDIO_ACCEPT)} />
            <Quick icon={FileUp} label="Import Document" hint="PDF, DOCX, PPTX, TXT, MD" onClick={() => pickAndImport(DOC_ACCEPT)} />
            <Quick icon={Sparkles} label="Ask AI" hint={ai.configured ? 'Questions about your notes' : 'Needs AI setup'} onClick={() => go('assistant')} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">Recently edited notes</h2>
              <button type="button" className="text-xs text-muted hover:text-accent" onClick={() => go('notes')}>
                All notes
              </button>
            </div>
            {stats.recentNotes.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {stats.recentNotes.map((n) => (
                  <button key={n.id} type="button" onClick={() => go('notes', { noteId: n.id })} className="card px-4 py-3 text-left transition-colors hover:border-accent/50">
                    <div className="flex items-center gap-1.5">
                      {n.favorite && <Star size={12} className="shrink-0 fill-current text-warn" />}
                      <span className="truncate text-[13.5px] font-semibold">{n.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 h-9 text-xs text-muted">{n.snippet || 'Empty note'}</p>
                    <div className="mt-2 text-[11px] text-muted">Edited {fmtDate(n.updated_at)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card px-4 py-8 text-center text-[13px] text-muted">No notes yet. Create your first note to see it here.</div>
            )}
          </section>

          <div className="space-y-6">
            <section>
              <h2 className="section-title mb-2">Recent recordings</h2>
              <div className="card divide-y divide-line">
                {stats.recentRecordings.length ? (
                  stats.recentRecordings.map((r) => (
                    <button key={r.id} type="button" onClick={() => go('recordings', { id: r.id })} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-surface2">
                      <Mic size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{r.title}</span>
                        <span className="block text-[11px] text-muted">
                          {fmtClock(r.duration)} · {r.status === 'done' ? 'Transcribed' : r.status === 'transcribing' ? 'Transcribing…' : 'Not transcribed'} · {fmtDate(r.created_at)}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-[13px] text-muted">No recordings yet.</div>
                )}
              </div>
            </section>
            <section>
              <h2 className="section-title mb-2">Recently discovered terms</h2>
              <div className="card divide-y divide-line">
                {stats.recentTerms.length ? (
                  stats.recentTerms.map((t) => (
                    <button key={t.id} type="button" onClick={() => openTerm(t.id)} className="block w-full px-3.5 py-2 text-left hover:bg-surface2">
                      <span className="text-[13px] font-medium">{t.term}</span>
                      <span className="block truncate text-[11px] text-muted">{t.simple}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-[13px] text-muted">Terms the AI explains from your notes and lectures appear here.</div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
