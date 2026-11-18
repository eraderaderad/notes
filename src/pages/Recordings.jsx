import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, Download, FileText, Mic, MoreHorizontal, NotebookPen, Pause, Pencil, Play, RefreshCw, Square, Star, Trash2, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { AUDIO_ACCEPT, useApp } from '../app-context.jsx';
import { Highlighted } from '../components/content.jsx';
import { FavoriteButton, SourceActions, SubjectSelect } from '../components/SourceTools.jsx';
import { Banner, Button, Empty, Field, IconButton, Menu, Modal, Progress, Segmented, Spinner, useDialogs } from '../components/ui.jsx';
import { emit, isTranscribing, paragraphize, useBus, useJob, useRecorder } from '../lib/audio.js';
import { cn, download, fmtClock, fmtDate, safeFileName, textToHtml } from '../lib/format.js';

const LANG_LABEL = { english: 'English', tagalog: 'Filipino', auto: 'Auto-detect' };

// ---------------------------------------------------------------- live waveform
function Waveform({ analyser, active }) {
  const ref = useRef(null);
  const levels = useRef([]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    const color = getComputedStyle(document.documentElement).getPropertyValue(active ? '--accent' : '--muted');
    let raf;
    let last = 0;
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (analyser && active && t - last > 45) {
        last = t;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
        levels.current.push(peak / 128);
        if (levels.current.length > W / 4) levels.current.shift();
      }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = color;
      const n = levels.current.length;
      for (let i = 0; i < n; i++) {
        const h = Math.max(2, Math.min(1, levels.current[i] * 1.8) * (H - 6));
        ctx.globalAlpha = active ? 0.9 : 0.4;
        ctx.fillRect(W - (n - i) * 4, (H - h) / 2, 2.5, h);
      }
      if (!n) {
        ctx.globalAlpha = 0.3;
        ctx.fillRect(0, H / 2 - 0.5, W, 1);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);
  return <canvas ref={ref} className="h-20 w-full rounded-md bg-surface2" aria-hidden />;
}

// ---------------------------------------------------------------- recorder dialog
function Recorder({ open, onClose, onSaved }) {
  const { settings, saveSettings, fail, toast, startTranscription } = useApp();
  const rec = useRecorder();
  const [devices, setDevices] = useState([]);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadDevices = async () => setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'));
  useEffect(() => {
    if (!open) return;
    setTitle('');
    loadDevices().catch(() => {});
  }, [open]);

  async function start() {
    try {
      await rec.start(settings.micDeviceId, settings.recordSource);
      loadDevices(); // labels become available once permission is granted
    } catch (e) {
      fail(e);
    }
  }
  async function stopAndSave() {
    setSaving(true);
    try {
      const out = await rec.stop();
      if (!out || out.blob.size === 0) throw new Error('Nothing was recorded.');
      const data = await out.blob.arrayBuffer();
      const r = await api('recordings.create', { title: title.trim() || `Recording ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, data, mime: out.mime, ext: out.ext, duration: +out.duration.toFixed(2), subjectId });
      emit('recordings');
      toast('Recording saved', 'success');
      if (settings.autoTranscribe) startTranscription(r.id, data);
      onSaved(r.id);
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }
  const close = () => {
    rec.cancel();
    onClose();
  };
  const idle = rec.state === 'idle';

  return (
    <Modal open={open} onClose={idle ? close : undefined} title="Record audio" width="max-w-xl">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className={cn('h-2.5 w-2.5 rounded-full', rec.state === 'recording' ? 'animate-pulse bg-danger' : rec.state === 'paused' ? 'bg-warn' : 'bg-line')} />
          <span className="text-[13px] font-medium">{rec.state === 'recording' ? 'Recording' : rec.state === 'paused' ? 'Paused' : 'Ready'}</span>
          <span className="ml-auto font-mono text-3xl font-semibold tabular-nums" aria-live="off">
            {fmtClock(rec.elapsed)}
          </span>
        </div>
        <Waveform analyser={rec.analyser} active={rec.state === 'recording'} />
        <div className="flex flex-wrap justify-center gap-2">
          {idle ? (
            <Button variant="primary" icon={Mic} onClick={start} className="px-5 py-2">
              Start recording
            </Button>
          ) : (
            <>
              {rec.state === 'recording' ? (
                <Button icon={Pause} onClick={rec.pause}>
                  Pause
                </Button>
              ) : (
                <Button icon={Play} onClick={rec.resume}>
                  Resume
                </Button>
              )}
              <Button variant="primary" icon={Square} loading={saving} onClick={stopAndSave}>
                Stop and save
              </Button>
              <Button variant="ghost" icon={X} disabled={saving} onClick={() => rec.cancel()}>
                Discard
              </Button>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Field label="Title" className="col-span-2">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Networking lecture, week 3" />
          </Field>
          <div className="col-span-2">
            <div className="label">Record from</div>
            <Segmented
              value={settings.recordSource}
              onChange={(v) => idle && saveSettings({ recordSource: v })}
              options={[
                { value: 'mic', label: 'Microphone' },
                { value: 'system', label: 'System audio (what you hear)' },
                { value: 'both', label: 'Both' },
              ]}
            />
            <p className="mt-1 text-xs text-muted">
              {settings.recordSource === 'mic' && 'Records your microphone only.'}
              {settings.recordSource === 'system' && 'Records everything playing on this PC, such as an online class, video or call, exactly as you hear it in your headphones or speakers.'}
              {settings.recordSource === 'both' && 'Records the PC audio and your microphone together, e.g. an online class where you also speak. Use headphones so the speakers are not picked up twice.'}
            </p>
          </div>
          <Field label="Microphone">
            <select className="input" value={settings.micDeviceId} disabled={!idle || settings.recordSource === 'system'} onChange={(e) => saveSettings({ micDeviceId: e.target.value })}>
              <option value="">System default</option>
              {devices
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Subject">
            <SubjectSelect value={subjectId} onChange={setSubjectId} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Audio is saved on this PC only. {settings.autoTranscribe ? `It will be transcribed locally (${LANG_LABEL[settings.transcribeLanguage]}) as soon as you stop.` : 'Automatic transcription is off; you can transcribe it afterwards.'}
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- audio player
function AudioPlayer({ id, duration, handle, onTime }) {
  const { fail } = useApp();
  const audio = useRef(null);
  const [url, setUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(duration || 0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(null);
  const pendingSeek = useRef(null);

  useEffect(() => {
    let u;
    let live = true;
    setUrl(null);
    setError(null);
    setT(0);
    setPlaying(false);
    api('recordings.audio', { id })
      .then((a) => {
        if (!live) return;
        u = URL.createObjectURL(new Blob([a.data], { type: a.mime }));
        setUrl(u);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  useEffect(() => setDur(duration || 0), [duration, id]);

  const seek = (time, play) => {
    const a = audio.current;
    if (!a || !url) return void (pendingSeek.current = { time, play });
    a.currentTime = Math.max(0, time);
    setT(a.currentTime);
    if (play) a.play().catch(fail);
  };
  useImperativeHandle(handle, () => ({ seek }), [url]);

  if (error) return <Banner tone="danger">{error}</Banner>;
  return (
    <div className="card flex items-center gap-3 px-3 py-2">
      <audio
        ref={audio}
        src={url || undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          // Recordings made in-app have no duration header; this makes the engine compute it.
          if (!Number.isFinite(a.duration)) {
            a.currentTime = 1e9;
            a.ontimeupdate = () => {
              a.ontimeupdate = null;
              a.currentTime = 0;
              if (Number.isFinite(a.duration)) setDur(a.duration);
            };
          } else setDur(a.duration);
          if (pendingSeek.current) {
            const p = pendingSeek.current;
            pendingSeek.current = null;
            setTimeout(() => seek(p.time, p.play), 150);
          }
        }}
        onTimeUpdate={(e) => {
          setT(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" disabled={!url} aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? audio.current.pause() : audio.current.play().catch(fail))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition hover:brightness-110 disabled:opacity-50">
        {!url ? <Spinner /> : playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <span className="w-12 text-right font-mono text-xs text-muted tabular-nums">{fmtClock(t)}</span>
      <input type="range" min={0} max={dur || 1} step={0.1} value={Math.min(t, dur || 1)} onChange={(e) => seek(+e.target.value)} className="h-1 flex-1 accent-(--accent)" aria-label="Seek" />
      <span className="w-12 font-mono text-xs text-muted tabular-nums">{fmtClock(dur)}</span>
      <button
        type="button"
        title="Playback speed"
        className="w-10 rounded border border-line py-0.5 text-[11px] font-medium text-muted hover:text-ink"
        onClick={() => {
          const next = { 1: 1.25, 1.25: 1.5, 1.5: 2, 2: 0.75, 0.75: 1 }[rate];
          setRate(next);
          audio.current.playbackRate = next;
        }}
      >
        {rate}×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- recording detail
function RecordingView({ id, seekTo, onChanged, onDeleted }) {
  const { fail, toast, go, settings, saveSettings, startTranscription } = useApp();
  const { confirm, prompt } = useDialogs();
  const [rec, setRec] = useState(null);
  const [time, setTime] = useState(0);
  const [editing, setEditing] = useState(null); // array of segments while editing
  const job = useJob(id);
  const player = useRef(null);
  const activeRef = useRef(null);

  const load = () => api('recordings.get', { id }).then(setRec).catch(fail);
  useEffect(() => {
    setRec(null);
    setEditing(null);
    load();
  }, [id]);
  useBus('recordings', load);
  useEffect(() => {
    if (rec && seekTo != null) player.current?.seek(seekTo, false);
  }, [rec?.id, seekTo]);

  const paragraphs = useMemo(() => {
    const out = [];
    for (const [i, s] of (rec?.segments || []).entries()) {
      if (!out.length || out[out.length - 1].p !== s.p) out.push({ p: s.p, start: s.start, segs: [] });
      out[out.length - 1].segs.push({ ...s, i });
    }
    return out;
  }, [rec?.segments]);
  const activeIdx = useMemo(() => {
    const segs = rec?.segments || [];
    for (let i = segs.length - 1; i >= 0; i--) if (time >= segs[i].start) return time <= (segs[i].end ?? segs[i].start) + 0.4 ? i : -1;
    return -1;
  }, [time, rec?.segments]);

  if (!rec)
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );

  const busy = isTranscribing(id);
  const hasTranscript = rec.segments.length > 0;
  const patch = async (p) => {
    setRec((r) => ({ ...r, ...p }));
    await api('recordings.update', { id, title: p.title, subjectId: p.subject_id, favorite: p.favorite });
    onChanged();
  };
  async function transcribe() {
    if (hasTranscript && !(await confirm({ title: 'Transcribe again?', text: 'The current transcript, including any edits you made, will be replaced.', confirmLabel: 'Transcribe again' }))) return;
    startTranscription(id);
  }
  async function saveEdits() {
    const segments = paragraphize(editing.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text));
    await api('recordings.update', { id, segments });
    setEditing(null);
    toast('Transcript saved', 'success');
    load();
    onChanged();
  }
  async function toNote() {
    const html = paragraphs.map((p) => `<p><strong>[${fmtClock(p.start)}]</strong> ${textToHtml(p.segs.map((s) => s.text).join(' ')).replace(/^<p>|<\/p>$/g, '')}</p>`).join('');
    const note = await api('notes.create', { title: `Transcript: ${rec.title}`, html, text: rec.transcript_text, subjectId: rec.subject_id, sourceType: 'recording', sourceId: id });
    toast('Transcript copied into a new note', 'success');
    go('notes', { noteId: note.id });
  }

  return (
    <div className="anim-fade flex h-full flex-col bg-surface">
      <div className="space-y-2.5 border-b border-line px-6 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight">{rec.title}</h1>
          <FavoriteButton on={rec.favorite} onToggle={() => patch({ favorite: !rec.favorite })} />
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More actions" />}
            items={[
              {
                label: 'Rename',
                icon: Pencil,
                onClick: async () => {
                  const t = await prompt({ title: 'Rename recording', value: rec.title, confirmLabel: 'Rename' });
                  if (t?.trim()) patch({ title: t.trim() });
                },
              },
              {
                label: 'Save audio file…',
                icon: Download,
                onClick: async () => {
                  const a = await api('recordings.audio', { id });
                  download(new Blob([a.data], { type: a.mime }), `${safeFileName(rec.title)}.${rec.file.split('.').pop()}`);
                },
              },
              hasTranscript && { label: 'Export transcript (.txt)', icon: FileText, onClick: () => download(paragraphs.map((p) => `[${fmtClock(p.start)}] ${p.segs.map((s) => s.text).join(' ')}`).join('\n\n'), `${safeFileName(rec.title)}.txt`, 'text/plain') },
              hasTranscript && { label: 'Copy transcript into a note', icon: NotebookPen, onClick: toNote },
              'sep',
              {
                label: 'Move to Trash',
                icon: Trash2,
                danger: true,
                onClick: async () => {
                  if (!(await confirm({ title: 'Move this recording to Trash?', text: 'The audio and transcript are kept until you empty the Trash.', confirmLabel: 'Move to Trash', danger: true }))) return;
                  await api('trash.move', { type: 'recording', id });
                  onDeleted();
                },
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Recorded {fmtDate(rec.created_at)}</span>
          <span>· {fmtClock(rec.duration)}</span>
          {rec.original_name && <span>· Imported from {rec.original_name}</span>}
          {rec.language && hasTranscript && <span>· Transcribed as {LANG_LABEL[rec.language] || rec.language}</span>}
          <SubjectSelect value={rec.subject_id} onChange={(v) => patch({ subject_id: v })} className="ml-auto h-7 w-40 py-0 text-xs" />
        </div>
        <AudioPlayer id={id} duration={rec.duration} handle={player} onTime={setTime} />
        <div className="flex flex-wrap items-center gap-1.5">
          {hasTranscript && !editing && <SourceActions compact source={{ type: 'recording', id, title: rec.title, subjectId: rec.subject_id }} />}
          <span className="ml-auto flex items-center gap-1.5">
            {hasTranscript &&
              !busy &&
              (editing ? (
                <>
                  <Button size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" icon={Check} onClick={saveEdits}>
                    Save transcript
                  </Button>
                </>
              ) : (
                <Button size="sm" icon={Pencil} onClick={() => setEditing(rec.segments.map((s) => ({ ...s })))}>
                  Edit transcript
                </Button>
              ))}
            {!editing && (
              <>
                <select className="input h-7 w-32 py-0 text-xs" value={settings.transcribeLanguage} disabled={busy} aria-label="Transcription language" onChange={(e) => saveSettings({ transcribeLanguage: e.target.value })}>
                  <option value="english">English</option>
                  <option value="tagalog">Filipino</option>
                  <option value="auto">Auto-detect</option>
                </select>
                <Button size="sm" variant={hasTranscript ? 'default' : 'primary'} icon={hasTranscript ? RefreshCw : AudioLines} loading={busy} onClick={transcribe}>
                  {busy ? 'Transcribing…' : hasTranscript ? 'Transcribe again' : 'Transcribe'}
                </Button>
              </>
            )}
          </span>
        </div>
        {job && job.stage !== 'done' && job.stage !== 'error' && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted">
              <span>{job.message}</span>
              <span>Runs on this PC</span>
            </div>
            <Progress value={job.progress} />
          </div>
        )}
        {job?.stage === 'error' && <Banner tone="danger">Transcription failed: {job.error}</Banner>}
        {job?.stage === 'done' && job.termsError && <Banner tone="warn">Transcribed, but terms could not be identified automatically: {job.termsError}</Banner>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <div className="mx-auto max-w-3xl space-y-1.5 px-8 py-5">
            <p className="mb-3 text-xs text-muted">Correct the text of each timed segment. Clear a segment to remove it. Timestamps stay linked to the audio.</p>
            {editing.map((s, i) => (
              <div key={i} className="flex gap-3">
                <button type="button" className="mt-1.5 w-12 shrink-0 text-right font-mono text-xs text-accent hover:underline" onClick={() => player.current?.seek(s.start, true)}>
                  {fmtClock(s.start)}
                </button>
                <textarea className="input min-h-0 resize-none text-[13.5px] leading-snug" rows={Math.max(1, Math.ceil(s.text.length / 80))} value={s.text} onChange={(e) => setEditing((list) => list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </div>
            ))}
          </div>
        ) : hasTranscript ? (
          <div className="mx-auto max-w-3xl space-y-4 px-8 py-6">
            {paragraphs.map((p) => (
              <div key={p.p} className="flex gap-4">
                <button type="button" title="Play from here" className="mt-0.5 w-12 shrink-0 text-right font-mono text-xs text-accent hover:underline" onClick={() => player.current?.seek(p.start, true)}>
                  {fmtClock(p.start)}
                </button>
                <p className="flex-1 text-[14.5px] leading-relaxed">
                  {p.segs.map((s) => (
                    <span
                      key={s.i}
                      ref={s.i === activeIdx ? activeRef : undefined}
                      title={`Play from ${fmtClock(s.start)}`}
                      onClick={() => !window.getSelection()?.toString() && player.current?.seek(s.start, true)}
                      className={cn('cursor-pointer rounded-sm transition-colors hover:bg-surface2', s.i === activeIdx && 'bg-accent-soft')}
                    >
                      <Highlighted text={s.text} />{' '}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        ) : busy ? (
          <Empty icon={AudioLines} title="Transcribing on this PC…" text="You can keep using the app. The transcript appears here when it is ready." />
        ) : job?.empty ? (
          <Empty icon={AudioLines} title="No speech detected" text="The recording seems to be silent. Check the microphone and try again, or pick another transcription language." />
        ) : (
          <Empty icon={AudioLines} title="Not transcribed yet" text="Speech-to-text runs locally with Whisper. The first run downloads the speech model once; after that it works offline.">
            <Button variant="primary" icon={AudioLines} onClick={transcribe}>
              Transcribe now
            </Button>
          </Empty>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Recordings({ params, nav }) {
  const { pickAndImport, fail } = useApp();
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [seekTo, setSeekTo] = useState(null);
  const [recorder, setRecorder] = useState(false);
  const [fav, setFav] = useState(false);

  const load = () => api('recordings.list').then(setList).catch(fail);
  useEffect(() => void load(), []);
  useBus('recordings', load);
  useEffect(() => {
    if (params.record) setRecorder(true);
    if (params.id) {
      setSel(params.id);
      setSeekTo(params.at ?? null);
    }
  }, [nav]);

  const shown = (list || []).filter((r) => !fav || r.favorite);
  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-line bg-bg">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Button variant="primary" icon={Mic} className="flex-1" onClick={() => setRecorder(true)}>
            Record
          </Button>
          <Button icon={Upload} onClick={() => pickAndImport(AUDIO_ACCEPT)}>
            Import
          </Button>
          <IconButton icon={Star} label="Show favorites only" active={fav} onClick={() => setFav((f) => !f)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((r) => (
            <RecordingRow key={r.id} r={r} active={sel === r.id} onClick={() => (setSel(r.id), setSeekTo(null))} />
          ))}
          {list && !shown.length && <div className="px-5 py-8 text-center text-xs text-muted">{fav ? 'No favorite recordings.' : 'No recordings yet. Record a lecture or import an audio file (WAV, MP3, M4A, OGG, FLAC, WebM).'}</div>}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {sel ? (
          <RecordingView key={sel} id={sel} seekTo={seekTo} onChanged={load} onDeleted={() => (setSel(null), load())} />
        ) : (
          <Empty icon={Mic} title="Record a lecture or import audio" text="Recordings are stored on this PC and transcribed locally with timestamps. Click any sentence in a transcript to replay it.">
            <Button variant="primary" icon={Mic} onClick={() => setRecorder(true)}>
              Start recording
            </Button>
            <Button icon={Upload} onClick={() => pickAndImport(AUDIO_ACCEPT)}>
              Import audio
            </Button>
          </Empty>
        )}
      </div>
      <Recorder open={recorder} onClose={() => setRecorder(false)} onSaved={(id) => (load(), setSel(id), setSeekTo(null))} />
    </div>
  );
}

function RecordingRow({ r, active, onClick }) {
  const job = useJob(r.id);
  const running = job && job.stage !== 'done' && job.stage !== 'error';
  return (
    <button type="button" onClick={onClick} className={cn('block w-full border-b border-line px-3.5 py-2.5 text-left transition-colors', active ? 'bg-surface' : 'hover:bg-surface/60')}>
      <div className="flex items-center gap-1.5">
        {r.favorite && <Star size={11} className="shrink-0 fill-current text-warn" />}
        <span className="truncate text-[13px] font-semibold">{r.title}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{fmtClock(r.duration)}</span>
      </div>
      {running ? (
        <div className="mt-1.5">
          <Progress value={job.progress} />
          <div className="mt-1 text-[11px] text-muted">{job.message}</div>
        </div>
      ) : (
        <>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{r.snippet || (r.status === 'error' ? 'Transcription failed' : 'Not transcribed yet')}</p>
          <div className="mt-1 text-[11px] text-muted">{fmtDate(r.created_at)}</div>
        </>
      )}
    </button>
  );
}
