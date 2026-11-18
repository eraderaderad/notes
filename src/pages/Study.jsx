import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Download, GraduationCap, Layers, NotebookPen, Pencil, Plus, RotateCcw, ScrollText, Shuffle, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../app-context.jsx';
import { Markdown } from '../components/content.jsx';
import { FavoriteButton, StudyModal, TYPE_ICON } from '../components/SourceTools.jsx';
import { Button, Empty, IconButton, Progress, Segmented, Spinner, useDialogs } from '../components/ui.jsx';
import { cn, download, fmtDate, mdToHtml, safeFileName } from '../lib/format.js';

const TYPE_META = { flashcards: { label: 'Flashcards', icon: Layers, unit: 'cards' }, quiz: { label: 'Quiz', icon: CircleHelp, unit: 'questions' }, reviewer: { label: 'Reviewer', icon: ScrollText, unit: '' } };
const DIFF = [
  { id: 'easy', label: 'Easy', cls: 'border-accent/40 text-accent hover:bg-accent-soft' },
  { id: 'medium', label: 'Medium', cls: 'border-warn/40 text-warn hover:bg-warn-soft' },
  { id: 'difficult', label: 'Difficult', cls: 'border-danger/40 text-danger hover:bg-danger-soft' },
];

// ---------------------------------------------------------------- flashcards
function Flashcards({ set, onSave }) {
  const [cards, setCards] = useState(set.data.cards);
  const [filter, setFilter] = useState('all');
  const [order, setOrder] = useState(() => set.data.cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const deck = useMemo(() => order.filter((i) => filter === 'all' || (filter === 'unrated' ? !cards[i].difficulty : cards[i].difficulty === filter)), [order, filter, cards]);
  const idx = deck[Math.min(pos, deck.length - 1)];
  const card = cards[idx];
  const move = (d) => {
    setFlipped(false);
    setPos((p) => Math.min(deck.length - 1, Math.max(0, p + d)));
  };
  function rate(difficulty) {
    const next = cards.map((c, i) => (i === idx ? { ...c, difficulty } : c));
    setCards(next);
    onSave({ cards: next });
    setFlipped(false);
    // When filtering, a re-rated card can leave the deck; otherwise advance.
    if (filter === 'all' || filter === difficulty) setPos((p) => Math.min(deck.length - 1, p + 1));
  }
  useEffect(() => {
    const h = (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === ' ') (e.preventDefault(), setFlipped((f) => !f));
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [deck.length]);
  const count = (d) => cards.filter((c) => (d === 'unrated' ? !c.difficulty : c.difficulty === d)).length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-6">
      <div className="mb-4 flex w-full flex-wrap items-center justify-between gap-2">
        <Segmented
          value={filter}
          onChange={(f) => (setFilter(f), setPos(0), setFlipped(false))}
          options={[
            { value: 'all', label: `All (${cards.length})` },
            { value: 'unrated', label: `Unrated (${count('unrated')})` },
            { value: 'easy', label: `Easy (${count('easy')})` },
            { value: 'medium', label: `Medium (${count('medium')})` },
            { value: 'difficult', label: `Difficult (${count('difficult')})` },
          ]}
        />
        <Button
          size="sm"
          icon={Shuffle}
          onClick={() => {
            setOrder((o) => [...o].sort(() => Math.random() - 0.5));
            setPos(0);
            setFlipped(false);
          }}
        >
          Shuffle
        </Button>
      </div>
      {!card ? (
        <div className="card w-full px-6 py-14 text-center text-[13px] text-muted">No cards in this group.</div>
      ) : (
        <>
          <div className={cn('flip h-72 w-full cursor-pointer', flipped && 'flipped')} role="button" tabIndex={0} aria-label={flipped ? 'Answer. Click to show the question' : 'Question. Click to reveal the answer'} onClick={() => setFlipped((f) => !f)} onKeyDown={(e) => e.key === 'Enter' && setFlipped((f) => !f)}>
            <div className="flip-inner relative h-full w-full">
              <div className="flip-face card absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-8 py-6 text-center shadow-sm">
                <span className="section-title mb-3">Question</span>
                <p className="text-lg leading-snug font-medium">{card.q}</p>
                <span className="mt-4 text-xs text-muted">Click or press Space to reveal</span>
              </div>
              <div className="flip-face flip-back card absolute inset-0 flex flex-col items-center justify-center overflow-y-auto border-accent/40 px-8 py-6 text-center shadow-sm">
                <span className="section-title mb-3 text-accent">Answer</span>
                <p className="text-[16px] leading-relaxed">{card.a}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex w-full items-center gap-3">
            <IconButton icon={ArrowLeft} label="Previous card" disabled={pos === 0} onClick={() => move(-1)} className="border border-line" />
            <div className="flex-1">
              <Progress value={(Math.min(pos, deck.length - 1) + 1) / deck.length} />
            </div>
            <span className="text-xs text-muted tabular-nums">
              {Math.min(pos, deck.length - 1) + 1} / {deck.length}
            </span>
            <IconButton icon={ArrowRight} label="Next card" disabled={pos >= deck.length - 1} onClick={() => move(1)} className="border border-line" />
          </div>
          <div className="mt-5 text-center">
            <div className="mb-2 text-xs text-muted">How well did you know this?{card.difficulty && ` Currently marked ${card.difficulty}.`}</div>
            <div className="flex justify-center gap-2">
              {DIFF.map((d) => (
                <button key={d.id} type="button" onClick={() => rate(d.id)} className={cn('rounded-md border px-5 py-1.5 text-[13px] font-medium transition-colors', d.cls, card.difficulty === d.id && 'ring-2 ring-current/30')}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- quiz
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim();
const Q_LABEL = { mcq: 'Multiple choice', truefalse: 'True or False', identification: 'Identification', short: 'Short answer' };

function Quiz({ set, onSave }) {
  const questions = set.data.questions;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState({}); // index -> {value, correct}
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState(false);
  const q = questions[i];
  const a = answers[i];
  const score = Object.values(answers).filter((x) => x.correct).length;

  const submit = (value) => {
    let correct = null;
    if (q.type === 'mcq' || q.type === 'truefalse') correct = norm(value) === norm(q.answer);
    else if (q.type === 'identification') correct = norm(value) === norm(q.answer);
    setAnswers((x) => ({ ...x, [i]: { value, correct } }));
  };
  const grade = (correct) => setAnswers((x) => ({ ...x, [i]: { ...x[i], correct } }));
  function next() {
    setDraft('');
    if (i < questions.length - 1) setI(i + 1);
    else {
      setDone(true);
      onSave({ ...set.data, lastScore: { score, total: questions.length, date: new Date().toISOString() } });
    }
  }
  function restart() {
    setAnswers({});
    setI(0);
    setDraft('');
    setDone(false);
  }

  if (done)
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="card px-8 py-8 text-center">
          <div className="section-title">Your score</div>
          <div className="mt-1 text-4xl font-semibold tabular-nums">
            {score} / {questions.length}
          </div>
          <p className="mt-1 text-[13px] text-muted">{Math.round((score / questions.length) * 100)}% correct</p>
          <Button variant="primary" icon={RotateCcw} className="mt-4" onClick={restart}>
            Take it again
          </Button>
        </div>
        <h3 className="section-title mt-6 mb-2">Review</h3>
        <div className="space-y-2">
          {questions.map((qq, k) => (
            <div key={k} className="card px-4 py-3 text-[13px]">
              <div className="flex gap-2">
                {answers[k]?.correct ? <Check size={15} className="mt-0.5 shrink-0 text-accent" /> : <X size={15} className="mt-0.5 shrink-0 text-danger" />}
                <div className="min-w-0">
                  <div className="font-medium">{qq.question}</div>
                  <div className="mt-1 text-muted">Your answer: {answers[k]?.value || '(none)'}</div>
                  <div className="text-muted">Correct answer: {qq.answer}</div>
                  {qq.explanation && <div className="mt-1 text-xs text-muted">{qq.explanation}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  const options = q.type === 'truefalse' ? ['True', 'False'] : q.options;
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="chip">{Q_LABEL[q.type]}</span>
        <div className="flex-1">
          <Progress value={(i + (a ? 1 : 0)) / questions.length} />
        </div>
        <span className="text-xs text-muted tabular-nums">
          Question {i + 1} of {questions.length} · Score {score}
        </span>
      </div>
      <div className="card px-6 py-5">
        <p className="text-[16px] leading-snug font-medium">{q.question}</p>
        <div className="mt-4">
          {options ? (
            <div className="space-y-2">
              {options.map((o) => {
                const chosen = a?.value === o;
                const right = a && norm(o) === norm(q.answer);
                return (
                  <button key={o} type="button" disabled={!!a} onClick={() => submit(o)} className={cn('flex w-full items-center gap-2 rounded-md border px-3.5 py-2 text-left text-[14px] transition-colors', !a && 'border-line hover:border-accent/60 hover:bg-surface2', a && right && 'border-accent bg-accent-soft', a && chosen && !right && 'border-danger bg-danger-soft', a && !chosen && !right && 'border-line opacity-60')}>
                    <span className="flex-1">{o}</span>
                    {a && right && <Check size={15} className="text-accent" />}
                    {a && chosen && !right && <X size={15} className="text-danger" />}
                  </button>
                );
              })}
            </div>
          ) : !a ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) submit(draft.trim());
              }}
            >
              {q.type === 'short' ? <textarea autoFocus className="input" rows={3} placeholder="Write your answer" value={draft} onChange={(e) => setDraft(e.target.value)} /> : <input autoFocus className="input" placeholder="Type the term" value={draft} onChange={(e) => setDraft(e.target.value)} />}
              <Button variant="primary" className="mt-2" disabled={!draft.trim()} onClick={() => submit(draft.trim())}>
                Check answer
              </Button>
            </form>
          ) : (
            <div className="rounded-md border border-line bg-bg px-3.5 py-2 text-[14px]">
              <span className="text-muted">Your answer: </span>
              {a.value}
            </div>
          )}
        </div>
        {a && (
          <div className="anim-fade mt-4 border-t border-line pt-3">
            {a.correct === null ? (
              <div>
                <div className="text-[13px] font-semibold">Model answer</div>
                <p className="text-[14px]">{q.answer}</p>
                <div className="mt-2 flex items-center gap-2 text-[13px]">
                  <span className="text-muted">Compare with yours. Did you get it?</span>
                  <Button size="sm" icon={Check} onClick={() => grade(true)}>
                    I got it
                  </Button>
                  <Button size="sm" icon={X} onClick={() => grade(false)}>
                    Not quite
                  </Button>
                </div>
              </div>
            ) : (
              <div className={cn('flex items-center gap-1.5 text-[14px] font-semibold', a.correct ? 'text-accent' : 'text-danger')}>
                {a.correct ? <Check size={16} /> : <X size={16} />}
                {a.correct ? 'Correct' : 'Incorrect'}
                {!a.correct && <span className="font-normal text-ink">· Answer: {q.answer}</span>}
                {!a.correct && q.type === 'identification' && (
                  <button type="button" className="ml-2 text-xs font-normal text-muted underline hover:text-ink" onClick={() => grade(true)}>
                    Count mine as correct
                  </button>
                )}
              </div>
            )}
            {q.explanation && (
              <p className="mt-2 text-[13px] text-muted">
                <b className="text-ink">Explanation:</b> {q.explanation}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" disabled={!a || a.correct === null} onClick={next}>
          {i < questions.length - 1 ? 'Next question' : 'Finish quiz'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- set viewer
function SetView({ id, onBack, onChanged }) {
  const { fail, toast, go, openSource } = useApp();
  const { confirm, prompt } = useDialogs();
  const [set, setSet] = useState(null);
  useEffect(() => {
    setSet(null);
    api('study.get', { id })
      .then(setSet)
      .catch((e) => (fail(e), onBack()));
  }, [id]);
  if (!set)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  const meta = TYPE_META[set.type];
  const save = (data) => api('study.update', { id, data }).then(onChanged).catch(fail);
  const patch = async (p) => {
    setSet((s) => ({ ...s, ...p }));
    await api('study.update', { id, ...p });
    onChanged();
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-6 py-3">
        <IconButton icon={ArrowLeft} label="Back to study materials" onClick={onBack} />
        <meta.icon size={17} className="text-muted" />
        <h1 className="min-w-0 truncate text-[16px] font-semibold">{set.title}</h1>
        <IconButton
          icon={Pencil}
          label="Rename"
          size={13}
          onClick={async () => {
            const t = await prompt({ title: 'Rename', value: set.title, confirmLabel: 'Rename' });
            if (t?.trim()) patch({ title: t.trim() });
          }}
        />
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {set.sources.map((s) => {
            const Icon = TYPE_ICON[s.type];
            return (
              <button key={s.type + s.id} type="button" className="chip max-w-48 hover:text-ink" title={`Open source: ${s.title}`} onClick={() => openSource(s)}>
                <Icon size={10} className="shrink-0" /> <span className="truncate">{s.title}</span>
              </button>
            );
          })}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {set.type === 'reviewer' && (
            <>
              <Button size="sm" icon={Download} onClick={() => download(`# ${set.title}\n\n${set.data.content}\n`, `${safeFileName(set.title)}.md`, 'text/markdown')}>
                Export
              </Button>
              <Button
                size="sm"
                icon={NotebookPen}
                onClick={async () => {
                  const n = await api('notes.create', { title: set.title, html: mdToHtml(set.data.content), text: set.data.content, subjectId: set.subject_id });
                  toast('Saved as a note', 'success');
                  go('notes', { noteId: n.id });
                }}
              >
                Save as note
              </Button>
            </>
          )}
          <FavoriteButton on={set.favorite} onToggle={() => patch({ favorite: !set.favorite })} />
          <IconButton
            icon={Trash2}
            label="Move to Trash"
            onClick={async () => {
              if (!(await confirm({ title: 'Move this study set to Trash?', confirmLabel: 'Move to Trash', danger: true }))) return;
              await api('trash.move', { type: 'study', id });
              onChanged();
              onBack();
            }}
          />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {set.type === 'flashcards' && <Flashcards set={set} onSave={save} />}
        {set.type === 'quiz' && <Quiz set={set} onSave={save} />}
        {set.type === 'reviewer' && (
          <div className="mx-auto max-w-3xl px-10 py-7">
            <Markdown text={set.data.content} />
            <p className="mt-8 border-t border-line pt-3 text-xs text-muted">Generated by AI from the sources listed above. Check anything important against your original notes.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Study({ params, nav }) {
  const { fail, subjects } = useApp();
  const [sets, setSets] = useState(null);
  const [tab, setTab] = useState('all');
  const [subject, setSubject] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(null);

  const load = () => api('study.list').then(setSets).catch(fail);
  useEffect(() => void load(), []);
  useEffect(() => {
    if (params.id) setOpen(params.id);
  }, [nav]);

  if (open) return <SetView key={open} id={open} onBack={() => setOpen(null)} onChanged={load} />;

  const shown = (sets || []).filter((s) => (tab === 'all' || s.type === tab) && (!subject || s.subject_id === +subject));
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-8 py-3">
        <h1 className="text-lg font-semibold">Study Materials</h1>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'flashcards', label: 'Flashcards' },
            { value: 'quiz', label: 'Quizzes' },
            { value: 'reviewer', label: 'Reviewers' },
          ]}
        />
        <select className="input h-8 w-44 py-0 text-xs" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Filter by subject">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setCreating(tab === 'all' ? 'flashcards' : tab)}>
          Create
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sets && !shown.length ? (
          <Empty icon={GraduationCap} title={sets.length ? 'Nothing in this view' : 'No study materials yet'} text="Turn your notes, lecture transcripts and documents into flashcards, practice quizzes and reviewers.">
            <Button variant="primary" icon={Layers} onClick={() => setCreating('flashcards')}>
              Flashcards
            </Button>
            <Button icon={CircleHelp} onClick={() => setCreating('quiz')}>
              Quiz
            </Button>
            <Button icon={ScrollText} onClick={() => setCreating('reviewer')}>
              Reviewer
            </Button>
          </Empty>
        ) : (
          <div className="anim-fade mx-auto grid max-w-6xl gap-3 px-8 py-6 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => {
              const m = TYPE_META[s.type];
              return (
                <button key={s.id} type="button" onClick={() => setOpen(s.id)} className="card px-4 py-3 text-left transition-colors hover:border-accent/50">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <m.icon size={14} />
                    {m.label}
                    {s.count != null && ` · ${s.count} ${m.unit}`}
                    {s.favorite && <span className="ml-auto text-warn">★</span>}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-[14px] font-semibold">{s.title}</div>
                  <div className="mt-2 text-[11px] text-muted">
                    {fmtDate(s.created_at)}
                    {s.subject_id && ` · ${subjects.find((x) => x.id === s.subject_id)?.name || ''}`}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <StudyModal open={!!creating} onClose={() => (setCreating(null), load())} initialType={creating || 'flashcards'} />
    </div>
  );
}
