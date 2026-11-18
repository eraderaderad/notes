import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Layers, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { Markdown } from '../components/content.jsx';
import { AiGate, SourcePicker, TYPE_ICON } from '../components/SourceTools.jsx';
import { Button, IconButton, Modal, Segmented, Spinner } from '../components/ui.jsx';
import { cn, fmtClock, fmtDate } from '../lib/format.js';

const SUGGESTIONS = ['Summarize everything I have learned so far.', 'Explain the hardest topic in my notes in simpler words.', 'Give me an example of a concept from my latest lecture.', 'Quiz me on my most recent notes.'];

function scopeLabel(scope, subjects) {
  if (scope.mode === 'subjects') {
    const names = (scope.subjectIds || []).map((id) => subjects.find((s) => s.id === id)?.name).filter(Boolean);
    return names.length ? `Subjects: ${names.join(', ')}` : 'No subject selected';
  }
  if (scope.mode === 'sources') {
    const n = scope.sources?.length || 0;
    return n === 1 ? `Only: ${scope.sources[0].title || '1 item'}` : `${n} selected items`;
  }
  return 'All my notes, transcripts and documents';
}

function ScopeModal({ open, onClose, scope, onChange }) {
  const { subjects } = useApp();
  const [s, setS] = useState(scope);
  useEffect(() => {
    if (open) setS(scope);
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What should the assistant use?"
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => (onChange(s), onClose())}>
            Use this context
          </Button>
        </>
      }
    >
      <Segmented
        value={s.mode}
        onChange={(mode) => setS({ mode, subjectIds: s.subjectIds || [], sources: s.sources || [] })}
        options={[
          { value: 'all', label: 'Everything' },
          { value: 'subjects', label: 'By subject' },
          { value: 'sources', label: 'Specific items' },
        ]}
      />
      <div className="mt-4">
        {s.mode === 'all' && <p className="text-[13px] text-muted">The assistant searches all your saved notes, lecture transcripts and imported documents and uses the most relevant passages.</p>}
        {s.mode === 'subjects' &&
          (subjects.length ? (
            <div className="space-y-1">
              {subjects.map((sub) => (
                <label key={sub.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-surface2">
                  <input type="checkbox" className="accent-(--accent)" checked={(s.subjectIds || []).includes(sub.id)} onChange={() => setS((x) => ({ ...x, subjectIds: x.subjectIds.includes(sub.id) ? x.subjectIds.filter((i) => i !== sub.id) : [...x.subjectIds, sub.id] }))} />
                  {sub.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">You have no subjects yet. Assign a subject to a note to use this.</p>
          ))}
        {s.mode === 'sources' && <SourcePicker value={s.sources || []} onChange={(sources) => setS((x) => ({ ...x, sources }))} height="h-64" />}
      </div>
    </Modal>
  );
}

export default function Assistant({ params, nav }) {
  const { fail, ai, subjects, openSource } = useApp();
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [scope, setScope] = useState({ mode: 'all' });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const bottom = useRef(null);
  const inputRef = useRef(null);

  const loadChats = () => api('chats.list').then(setChats).catch(fail);
  useEffect(() => void loadChats(), []);
  useEffect(() => {
    if (params.scope) {
      newChat();
      setScope(params.scope);
    }
    inputRef.current?.focus();
  }, [nav]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  function newChat() {
    setChatId(null);
    setMessages([]);
    setScope({ mode: 'all' });
    inputRef.current?.focus();
  }
  async function openChat(id) {
    try {
      const c = await api('chats.get', { id });
      setChatId(id);
      setMessages(c.messages);
      setScope(c.scope);
    } catch (e) {
      fail(e);
    }
  }
  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    setMessages((m) => [...m, { id: 'tmp' + Date.now(), role: 'user', content: question, sources: [] }]);
    setBusy(true);
    try {
      const r = await api('assistant.ask', { chatId, question, scope });
      setChatId(r.chatId);
      setMessages((m) => [...m, r.message]);
      loadChats();
    } catch (e) {
      setMessages((m) => m.slice(0, -1));
      setInput(question);
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function removeChat(id) {
    await api('chats.delete', { id });
    if (id === chatId) newChat();
    loadChats();
  }

  return (
    <div className="flex h-full">
      <div className="flex w-60 shrink-0 flex-col border-r border-line bg-bg">
        <div className="border-b border-line p-3">
          <Button icon={MessageSquarePlus} className="w-full" onClick={newChat}>
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {chats.map((c) => (
            <div key={c.id} className={cn('group flex items-center rounded-md', c.id === chatId ? 'bg-surface' : 'hover:bg-surface/60')}>
              <button type="button" className="min-w-0 flex-1 px-2.5 py-1.5 text-left" onClick={() => openChat(c.id)}>
                <span className="block truncate text-[13px]">{c.title}</span>
                <span className="block text-[11px] text-muted">{fmtDate(c.updated_at)}</span>
              </button>
              <IconButton icon={Trash2} label="Delete chat" size={13} className="mr-1 opacity-0 group-hover:opacity-100" onClick={() => removeChat(c.id)} />
            </div>
          ))}
          {!chats.length && <p className="px-3 py-6 text-center text-xs text-muted">Your conversations are saved here.</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-8 py-6">
            {!messages.length && (
              <div className="anim-fade pt-10 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Sparkles size={20} />
                </div>
                <h1 className="text-lg font-semibold">Ask about your notes and lectures</h1>
                <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">Answers are based on your saved materials and point to the note, page or timestamp they came from. Anything outside your notes is labelled as general knowledge.</p>
                <div className="mx-auto mt-5 grid max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="card px-3 py-2 text-left text-[13px] hover:border-accent/50" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="mx-auto mt-5 max-w-xl text-left">
                  <AiGate />
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2 text-[14px] whitespace-pre-wrap">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="anim-fade">
                  <Markdown text={m.content} small />
                  {m.sources.length > 0 && (
                    <div className="mt-3 border-t border-line pt-2.5">
                      <div className="section-title mb-1.5">Sources from your library</div>
                      <div className="space-y-1">
                        {m.sources.map((s) => {
                          const Icon = TYPE_ICON[s.type];
                          return (
                            <button key={s.n} type="button" title={s.excerpt} onClick={() => openSource({ type: s.type, id: s.id, at: s.start })} className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-left text-xs hover:border-accent/50 hover:bg-surface2">
                              <span className="font-mono font-semibold text-accent">S{s.n}</span>
                              <Icon size={13} className="shrink-0 text-muted" />
                              <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                              <span className="shrink-0 text-muted">{s.type === 'recording' ? `at ${fmtClock(s.start)}` : s.loc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <Spinner /> Reading your materials…
              </div>
            )}
            <div ref={bottom} />
          </div>
        </div>

        <div className="border-t border-line px-8 py-3">
          <div className="mx-auto max-w-3xl">
            <button type="button" onClick={() => setScopeOpen(true)} className="mb-2 flex max-w-full items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent/50 hover:text-ink">
              <Layers size={12} className="shrink-0" />
              <span className="truncate">Context: {scopeLabel(scope, subjects)}</span>
            </button>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                className="input max-h-40 min-h-10 flex-1 resize-none py-2 text-[14px]"
                rows={Math.min(6, Math.max(1, input.split('\n').length))}
                placeholder={ai.configured ? 'Ask a question about your notes…' : 'Set up an AI provider in Settings to start asking questions'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button type="button" aria-label="Send" disabled={!input.trim() || busy} onClick={() => send()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink transition hover:brightness-110 disabled:opacity-40">
                {busy ? <Spinner /> : <ArrowUp size={17} />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">{ai.configured ? (ai.external ? `Using ${ai.label}. Your question and the relevant passages from your notes are sent to this provider.` : `Using ${ai.label}. Everything stays on this PC.`) : 'No AI provider configured.'}</p>
          </div>
        </div>
      </div>
      <ScopeModal open={scopeOpen} onClose={() => setScopeOpen(false)} scope={scope} onChange={setScope} />
    </div>
  );
}
