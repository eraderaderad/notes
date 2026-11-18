import { useEffect, useRef, useState } from 'react';
import { Check, Cloud, Download, FolderOpen, HardDrive, KeyRound, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { api, isDesktop, native } from '../api.js';
import { useApp } from '../app-context.jsx';
import { Banner, Button, Field, Modal, Progress, Segmented, Toggle, useDialogs } from '../components/ui.jsx';
import { emit } from '../lib/audio.js';
import { cn, download, fmtBytes, fmtDate } from '../lib/format.js';

const SECTIONS = [
  ['appearance', 'Appearance'],
  ['recording', 'Recording & transcription'],
  ['ai', 'AI'],
  ['notes', 'Notes'],
  ['storage', 'Storage'],
  ['backup', 'Backup & restore'],
  ['data', 'Export & delete'],
];

function Section({ id, title, desc, children }) {
  return (
    <section id={`set-${id}`} className="scroll-mt-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 text-[13px] text-muted">{desc}</p>}
      <div className="card mt-3 space-y-4 p-5">{children}</div>
    </section>
  );
}

/** Text input that saves when you leave the field. */
function SavedInput({ value, onSave, ...props }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return <input className="input" {...props} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value ?? '') && onSave(v.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

function KeyField({ name, label, placeholder }) {
  const { secrets, secureStorage, refreshSettings, fail, toast } = useApp();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (value) => {
    setBusy(true);
    try {
      await api('secrets.set', { name, value });
      setV('');
      await refreshSettings();
      toast(value ? 'API key saved' : 'API key removed', 'success');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={label} hint={secureStorage ? 'Stored on this PC only, encrypted with your Windows account (DPAPI). It is never shown again after saving.' : 'Browser test mode: the key is kept in memory only and is forgotten when the app restarts.'}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <KeyRound size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input type="password" autoComplete="off" className="input pl-8" value={v} placeholder={secrets[name] ? 'A key is saved. Paste a new one to replace it' : placeholder} onChange={(e) => setV(e.target.value)} />
        </div>
        <Button variant="primary" loading={busy} disabled={!v.trim()} onClick={() => save(v)}>
          Save key
        </Button>
        {secrets[name] && (
          <Button variant="danger" disabled={busy} onClick={() => save('')}>
            Remove
          </Button>
        )}
      </div>
      {secrets[name] && (
        <span className="mt-1 flex items-center gap-1 text-xs text-accent">
          <Check size={12} /> Key saved
        </span>
      )}
    </Field>
  );
}

const PROVIDERS = [
  { id: 'none', name: 'Off', where: 'No AI features', icon: ShieldCheck },
  { id: 'ollama', name: 'Ollama', where: 'Local · stays on this PC', icon: HardDrive },
  { id: 'anthropic', name: 'Claude', where: 'Cloud · Anthropic API key', icon: Cloud },
  { id: 'openai', name: 'OpenAI-compatible', where: 'Cloud or local endpoint', icon: Cloud },
];
const CLAUDE_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (recommended)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest, cheapest)'],
  ['claude-fable-5-2', 'Claude Fable 5.2 (most capable)'],
];

function AiSettings() {
  const { settings, saveSettings, ai, fail } = useApp();
  const [ollama, setOllama] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const p = settings.aiProvider;

  const loadOllama = () => {
    setOllama(null);
    api('ai.ollamaModels', { url: settings.ollamaUrl }).then(setOllama).catch(fail);
  };
  useEffect(() => {
    if (p === 'ollama') loadOllama();
  }, [p, settings.ollamaUrl]);
  useEffect(() => setTest(null), [p, settings.anthropicModel, settings.openaiModel, settings.ollamaModel, settings.openaiBaseUrl]);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await api('ai.test');
      setTest({ ok: true, text: `Connected to ${r.label}. It replied: “${r.reply}”` });
    } catch (e) {
      setTest({ ok: false, text: e.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {PROVIDERS.map((x) => (
          <button key={x.id} type="button" onClick={() => saveSettings({ aiProvider: x.id })} aria-pressed={p === x.id} className={cn('rounded-md border px-3 py-2.5 text-left transition-colors', p === x.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface2')}>
            <x.icon size={15} className={p === x.id ? 'text-accent' : 'text-muted'} />
            <div className="mt-1 text-[13px] font-semibold">{x.name}</div>
            <div className="text-[11px] text-muted">{x.where}</div>
          </button>
        ))}
      </div>

      {p === 'none' && <Banner>AI features are off. Notes, recording, local transcription, search and backups all work without AI. Nothing is sent anywhere.</Banner>}

      {p === 'ollama' && (
        <>
          <Banner>
            <b>Fully local.</b> Ollama runs the model on this PC, so your notes and questions never leave it. Install Ollama from ollama.com, then download a model, for example <code className="font-mono text-xs">ollama pull llama3.1</code>.
          </Banner>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ollama address">
              <SavedInput value={settings.ollamaUrl} onSave={(v) => saveSettings({ ollamaUrl: v || 'http://localhost:11434' })} />
            </Field>
            <Field label="Model" hint={ollama === null ? 'Looking for Ollama…' : ollama.running ? `${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'} installed` : 'Ollama is not running at this address.'}>
              <div className="flex gap-2">
                {ollama?.models.length ? (
                  <select className="input" value={settings.ollamaModel} onChange={(e) => saveSettings({ ollamaModel: e.target.value })}>
                    <option value="">Choose a model</option>
                    {ollama.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {settings.ollamaModel && !ollama.models.includes(settings.ollamaModel) && <option value={settings.ollamaModel}>{settings.ollamaModel} (not installed)</option>}
                  </select>
                ) : (
                  <SavedInput value={settings.ollamaModel} placeholder="e.g. llama3.1" onSave={(v) => saveSettings({ ollamaModel: v })} />
                )}
                <Button icon={RefreshCw} onClick={loadOllama} title="Check again" />
              </div>
            </Field>
          </div>
        </>
      )}

      {p === 'anthropic' && (
        <>
          <Banner tone="warn">
            <b>Cloud provider.</b> When you run an AI action, the text involved is sent to Anthropic over HTTPS: the note, transcript or document text you are working on, your question, and the relevant passages from your library. Audio files are never sent, and nothing is sent until you start an AI action.
          </Banner>
          <KeyField name="anthropicKey" label="Anthropic API key" placeholder="sk-ant-…" />
          <Field label="Model">
            <select className="input" value={settings.anthropicModel} onChange={(e) => saveSettings({ anthropicModel: e.target.value })}>
              {CLAUDE_MODELS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {p === 'openai' && (
        <>
          <Banner tone={ai.external ? 'warn' : 'info'}>
            {ai.external ? (
              <>
                <b>Cloud provider.</b> When you run an AI action, the text involved (the note, transcript or document text, your question and relevant passages) is sent to <b>{settings.openaiBaseUrl}</b>. Audio is never sent.
              </>
            ) : (
              <>
                <b>Local endpoint.</b> This address is on your own PC (for example LM Studio or a local server), so nothing leaves it.
              </>
            )}
          </Banner>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base URL" hint="Any server that implements /chat/completions">
              <SavedInput value={settings.openaiBaseUrl} onSave={(v) => saveSettings({ openaiBaseUrl: v || 'https://api.openai.com/v1' })} />
            </Field>
            <Field label="Model name">
              <SavedInput value={settings.openaiModel} placeholder="Model ID from your provider" onSave={(v) => saveSettings({ openaiModel: v })} />
            </Field>
          </div>
          <KeyField name="openaiKey" label={`API key${ai.external ? '' : ' (optional for local servers)'}`} placeholder="sk-…" />
        </>
      )}

      {p !== 'none' && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button icon={RefreshCw} loading={testing} disabled={!ai.configured} onClick={runTest}>
            Test connection
          </Button>
          <span className={cn('min-w-0 flex-1 text-[13px]', test ? (test.ok ? 'text-accent' : 'text-danger') : 'text-muted')}>{test ? test.text : ai.configured ? `Ready: ${ai.label}` : ai.reason}</span>
        </div>
      )}
      <div className="border-t border-line pt-4">
        <Toggle checked={settings.autoTerms} onChange={(v) => saveSettings({ autoTerms: v })} label="Identify and explain terms automatically" hint="After a recording is transcribed or a document is imported, find the important terms and add them to the glossary as “discovered”. Uses the provider above." />
      </div>
    </>
  );
}

function TranscriptionSettings() {
  const { settings, saveSettings, fail, toast } = useApp();
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const refresh = () => api('transcribe.status').then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setDevices(d.filter((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default')))
      .catch(() => {});
    return () => clearInterval(timer.current);
  }, []);
  async function prepare() {
    setLoading(true);
    timer.current = setInterval(refresh, 600);
    try {
      await api('transcribe.load', { model: settings.whisperModel });
      toast('Speech model is ready. Transcription now works offline.', 'success');
    } catch (e) {
      fail(e);
    } finally {
      clearInterval(timer.current);
      setLoading(false);
      refresh();
    }
  }
  async function allowMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      const d = await navigator.mediaDevices.enumerateDevices();
      setDevices(d.filter((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default'));
    } catch {
      fail(new Error('Microphone access was blocked. Allow it in Windows Settings → Privacy & security → Microphone.'));
    }
  }
  const cached = status?.cached?.[settings.whisperModel];
  const unnamed = devices.length > 0 && devices.every((d) => !d.label);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Microphone" hint={unnamed || !devices.length ? 'Allow microphone access once to see device names.' : undefined}>
          <div className="flex gap-2">
            <select className="input" value={settings.micDeviceId} onChange={(e) => saveSettings({ micDeviceId: e.target.value })}>
              <option value="">System default</option>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            {(unnamed || !devices.length) && <Button onClick={allowMic}>Allow</Button>}
          </div>
        </Field>
        <Field label="Transcription language" hint="Filipino uses Whisper's Tagalog model. Mixed English/Filipino lectures usually work best on Filipino.">
          <select className="input" value={settings.transcribeLanguage} onChange={(e) => saveSettings({ transcribeLanguage: e.target.value })}>
            <option value="english">English</option>
            <option value="tagalog">Filipino (Tagalog)</option>
            <option value="auto">Auto-detect</option>
          </select>
        </Field>
      </div>
      <Field label="Speech model (Whisper, runs on this PC)">
        <div className="flex gap-2">
          <select className="input" value={settings.whisperModel} disabled={loading} onChange={(e) => saveSettings({ whisperModel: e.target.value })}>
            {Object.entries(status?.models || { base: { label: 'Base', size: '' } }).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label} · {m.size}
                {status?.cached?.[k] ? ' · downloaded' : ''}
              </option>
            ))}
          </select>
          <Button icon={cached ? Check : Download} loading={loading} onClick={prepare}>
            {loading ? 'Preparing…' : cached ? 'Load now' : 'Download now'}
          </Button>
        </div>
      </Field>
      {loading && status?.status === 'loading' && status.total > 0 && (
        <div>
          <Progress value={status.loaded / status.total} />
          <div className="mt-1 text-xs text-muted">
            Downloading {fmtBytes(status.loaded)} of {fmtBytes(status.total)}
          </div>
        </div>
      )}
      <Banner>
        Transcription never uses the internet: audio is processed on this PC. The only download is the speech model itself, once, from huggingface.co. {cached ? 'This model is already downloaded, so transcription works offline.' : 'This model has not been downloaded yet.'}
      </Banner>
      <Toggle checked={settings.autoTranscribe} onChange={(v) => saveSettings({ autoTranscribe: v })} label="Transcribe automatically" hint="Start transcription as soon as a recording is saved or an audio file is imported." />
    </>
  );
}

function StorageSettings() {
  const { fail, toast } = useApp();
  const { confirm } = useDialogs();
  const [info, setInfo] = useState(null);
  useEffect(() => void api('system.info').then(setInfo).catch(fail), []);
  if (!info) return null;
  async function change() {
    const dir = await native('pickFolder');
    if (!dir) return;
    if (!(await confirm({ title: 'Move your data here?', text: `Your notes, recordings and documents will be copied to:\n${dir}\n\neradnotes then restarts using that folder. The old folder is left in place so you can delete it yourself once you have checked everything.`, confirmLabel: 'Copy and restart' }))) return;
    try {
      const r = await native('setDataDir', dir);
      if (r?.same) toast('That is already the current data folder.');
    } catch (e) {
      fail(new Error(e.message.replace(/^Error invoking remote method 'native': Error: /, '')));
    }
  }
  const rows = [
    ['Notes database', info.sizes.database],
    ['Audio recordings', info.sizes.audio],
    ['Imported documents', info.sizes.documents],
    ['Backups', info.sizes.backups],
    ['Speech models', info.sizes.models],
  ];
  return (
    <>
      <Field label="Everything is stored in this folder on your PC">
        <div className="flex gap-2">
          <input className="input font-mono text-xs" readOnly value={info.dataDir} onFocus={(e) => e.target.select()} />
          {isDesktop && (
            <>
              <Button icon={FolderOpen} onClick={() => native('openDataDir')}>
                Open
              </Button>
              <Button onClick={change}>Change…</Button>
            </>
          )}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-1">
            <span className="text-muted">{k}</span>
            <span className="tabular-nums">{fmtBytes(v)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">eradnotes has no account and no sync. Files in this folder are yours: <span className="font-mono">eradnotes.db</span> (notes, transcripts, glossary, study materials), <span className="font-mono">audio/</span>, <span className="font-mono">documents/</span> and <span className="font-mono">backups/</span>.</p>
    </>
  );
}

function BackupSettings() {
  const { settings, saveSettings, fail, toast, refreshSettings, refreshSubjects, refreshTerms } = useApp();
  const { confirm } = useDialogs();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api('backup.list').then(setList).catch(fail);
  useEffect(() => void load(), []);
  async function backupNow() {
    setBusy(true);
    try {
      await api('backup.create');
      toast('Backup created', 'success');
      await refreshSettings();
      load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function restore(b) {
    if (!(await confirm({ title: 'Restore this backup?', text: `Your notes, transcripts, glossary and study materials will go back to how they were on ${new Date(b.date).toLocaleString()}. A safety backup of the current state is made first. Audio and document files are not changed.`, confirmLabel: 'Restore', danger: true }))) return;
    try {
      await api('backup.restore', { name: b.name });
      await Promise.all([refreshSettings(), refreshSubjects(), refreshTerms()]);
      emit('recordings');
      emit('documents');
      toast('Backup restored', 'success');
      load();
    } catch (e) {
      fail(e);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Automatic backup">
          <select className="input w-44" value={settings.backupIntervalHours} onChange={(e) => saveSettings({ backupIntervalHours: +e.target.value })}>
            <option value={0}>Off</option>
            <option value={6}>Every 6 hours</option>
            <option value={24}>Daily</option>
            <option value={168}>Weekly</option>
          </select>
        </Field>
        <Field label="Keep">
          <select className="input w-36" value={settings.backupKeep} onChange={(e) => saveSettings({ backupKeep: +e.target.value })}>
            {[5, 10, 20, 30].map((n) => (
              <option key={n} value={n}>
                Last {n} backups
              </option>
            ))}
          </select>
        </Field>
        <Button variant="primary" icon={Download} loading={busy} onClick={backupNow}>
          Back up now
        </Button>
        <span className="pb-1.5 text-xs text-muted">{settings.lastBackupAt ? `Last backup ${fmtDate(settings.lastBackupAt)}` : 'No backup yet'}</span>
      </div>
      <div className="max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {list.map((b) => (
          <div key={b.name} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span>
            <span className="text-xs text-muted">{new Date(b.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span className="w-16 text-right text-xs text-muted tabular-nums">{fmtBytes(b.size)}</span>
            <Button size="sm" icon={RotateCcw} onClick={() => restore(b)}>
              Restore
            </Button>
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete backup" onClick={() => api('backup.delete', { name: b.name }).then(load)} />
          </div>
        ))}
        {!list.length && <div className="px-3 py-5 text-center text-xs text-muted">No backups yet. They are saved in the backups folder inside your data folder.</div>}
      </div>
      <p className="text-xs text-muted">Backups are snapshots of the database (notes, transcripts, glossary, study materials, settings). To copy audio and document files too, use “Export everything” below.</p>
    </>
  );
}

function DataSettings() {
  const { fail, toast, refreshSettings, refreshSubjects, refreshTerms, go } = useApp();
  const [exporting, setExporting] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [text, setText] = useState('');
  async function exportAll() {
    setExporting(true);
    try {
      const r = await api('export.all');
      download(r.data, r.name, 'application/zip');
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  }
  async function doWipe() {
    try {
      await api('data.wipe', { confirm: text });
      setWipe(false);
      setText('');
      await Promise.all([refreshSettings(), refreshSubjects(), refreshTerms()]);
      toast('All data deleted', 'success');
      go('dashboard');
    } catch (e) {
      fail(e);
    }
  }
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium">Export everything</div>
          <div className="text-xs text-muted">One .zip with the database, every note as HTML, transcripts as text, the glossary as JSON, and all original audio and document files.</div>
        </div>
        <Button icon={Download} loading={exporting} onClick={exportAll}>
          Export .zip
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
        <div>
          <div className="text-[13px] font-medium text-danger">Delete all my data</div>
          <div className="text-xs text-muted">Permanently removes every note, recording, document, glossary entry, study set, chat, backup, setting and saved API key from this PC.</div>
        </div>
        <Button variant="danger" icon={Trash2} onClick={() => setWipe(true)}>
          Delete everything…
        </Button>
      </div>
      <Modal
        open={wipe}
        onClose={() => setWipe(false)}
        title="Delete all data?"
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setWipe(false)}>Cancel</Button>
            <Button variant="danger" disabled={text !== 'DELETE'} onClick={doWipe}>
              Delete everything permanently
            </Button>
          </>
        }
      >
        <p className="text-[13px]">This cannot be undone and backups are deleted too. Export first if you might want anything back.</p>
        <Field label="Type DELETE to confirm" className="mt-3">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  );
}

export default function Settings({ params, nav }) {
  const { settings, saveSettings } = useApp();
  const scroller = useRef(null);
  const jump = (id) => scroller.current?.querySelector(`#set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  useEffect(() => {
    if (params.section) setTimeout(() => jump(params.section), 60);
  }, [nav]);
  return (
    <div className="flex h-full">
      <nav className="w-52 shrink-0 space-y-0.5 border-r border-line bg-bg p-3">
        <h1 className="px-2 pb-2 text-lg font-semibold">Settings</h1>
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jump(id)} className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface hover:text-ink">
            {label}
          </button>
        ))}
      </nav>
      <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-8 py-7">
          <Section id="appearance" title="Appearance">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">Theme</span>
              <Segmented
                value={settings.theme}
                onChange={(theme) => saveSettings({ theme })}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'Match Windows' },
                ]}
              />
            </div>
          </Section>
          <Section id="recording" title="Recording & transcription" desc="Audio is recorded and converted to text on this PC.">
            <TranscriptionSettings />
          </Section>
          <Section id="ai" title="AI" desc="Powers term explanations, summaries, the study assistant and study materials. Choose where the AI runs.">
            <AiSettings />
          </Section>
          <Section id="notes" title="Notes">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium">Default note format for export</div>
                <div className="text-xs text-muted">Used by “Export” in the note menu. Notes always autosave to the local database.</div>
              </div>
              <Segmented
                value={settings.exportFormat}
                onChange={(exportFormat) => saveSettings({ exportFormat })}
                options={[
                  { value: 'md', label: 'Markdown' },
                  { value: 'html', label: 'HTML' },
                  { value: 'txt', label: 'Plain text' },
                ]}
              />
            </div>
          </Section>
          <Section id="storage" title="Storage" desc="Local-first: no account, no cloud sync.">
            <StorageSettings />
          </Section>
          <Section id="backup" title="Backup & restore">
            <BackupSettings />
          </Section>
          <Section id="data" title="Export & delete">
            <DataSettings />
          </Section>
          <div className="h-40" />
        </div>
      </div>
    </div>
  );
}
