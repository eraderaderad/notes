// App-wide state: navigation, settings, AI status, subjects, glossary terms, imports.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from './api.js';
import { Button, Modal, useToast } from './components/ui.jsx';
import { emit, transcribeRecording, useBus } from './lib/audio.js';
import { buildTermRegex } from './lib/terms.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const DOC_ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.markdown';
export const AUDIO_ACCEPT = '.wav,.mp3,.m4a,.ogg,.oga,.webm,.flac,.aac,.mp4,.opus,audio/*';
const AUDIO_RE = /\.(wav|mp3|m4a|ogg|oga|webm|flac|aac|mp4|opus)$/i;
const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' };

const audioDuration = (blob) =>
  new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    const done = (d) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = url;
  });

export function AppProvider({ children }) {
  const toast = useToast();
  const [route, setRoute] = useState({ view: 'dashboard', params: {}, n: 0 });
  const [settings, setSettings] = useState(null);
  const [secrets, setSecrets] = useState({});
  const [secureStorage, setSecureStorage] = useState(true);
  const [ai, setAi] = useState({ configured: false, provider: 'none', reason: '' });
  const [subjects, setSubjects] = useState([]);
  const [terms, setTerms] = useState([]);
  const [termView, setTermView] = useState(null);
  const [aiSetup, setAiSetup] = useState(null);
  const [fatal, setFatal] = useState(null);
  const fileRef = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { settings, ai };

  const go = useCallback((view, params = {}) => setRoute((r) => ({ view, params, n: r.n + 1 })), []);

  const refreshSettings = useCallback(async () => {
    const r = await api('settings.get');
    setSettings(r.settings);
    setSecrets(r.secrets);
    setSecureStorage(r.secureStorage);
    setAi(await api('ai.status'));
  }, []);
  const refreshSubjects = useCallback(async () => setSubjects(await api('subjects.list')), []);
  const refreshTerms = useCallback(async () => setTerms(await api('glossary.terms')), []);

  useEffect(() => {
    Promise.all([refreshSettings(), refreshSubjects(), refreshTerms()]).catch((e) => setFatal(e.message));
  }, []);
  useBus('glossary', refreshTerms);

  // Theme
  useEffect(() => {
    if (!settings) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', settings.theme === 'dark' || (settings.theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings?.theme]);

  const saveSettings = useCallback(async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    await api('settings.set', patch);
    setAi(await api('ai.status'));
  }, []);

  /** Standard error handling: AI-not-configured gets a setup dialog, everything else a toast. */
  const fail = useCallback(
    (e) => {
      if (e?.code === 'AI_NOT_CONFIGURED') setAiSetup(e.message);
      else toast(e?.message || String(e), 'error');
    },
    [toast],
  );

  const openTerm = useCallback((t) => setTermView(typeof t === 'object' ? t : typeof t === 'number' ? { id: t } : { term: t }), []);

  const openSource = useCallback(
    (s) => {
      if (s.type === 'note') go('notes', { noteId: s.id });
      else if (s.type === 'document') go('notes', { docId: s.id });
      else if (s.type === 'recording') go('recordings', { id: s.id, at: s.at ?? s.start ?? null });
      else if (s.type === 'glossary') openTerm(s.id);
      else if (s.type === 'study') go('study', { id: s.id });
    },
    [go, openTerm],
  );

  /** Find terms in the background after an import, when the user has enabled it. */
  const autoTerms = useCallback(async (sourceType, sourceId) => {
    const { settings: s, ai: a } = stateRef.current;
    if (!s?.autoTerms || !a?.configured) return;
    try {
      const r = await api('glossary.extract', { sourceType, sourceId });
      emit('glossary');
      if (r.added.length) toast(`${r.added.length} new term${r.added.length > 1 ? 's' : ''} explained and added to the glossary`, 'success');
    } catch (e) {
      toast(`Could not identify terms automatically: ${e.message}`, 'error');
    }
  }, []);

  const startTranscription = useCallback((id, audio) => {
    const { settings: s, ai: a } = stateRef.current;
    return transcribeRecording(id, { settings: s, aiReady: a.configured, audio });
  }, []);

  /** Import documents and audio files. Returns what was created. */
  const importFiles = useCallback(
    async (files, { subjectId = null } = {}) => {
      const created = [];
      for (const file of files) {
        try {
          const data = await file.arrayBuffer();
          if (AUDIO_RE.test(file.name) || file.type.startsWith('audio/')) {
            const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'webm').toLowerCase();
            const duration = await audioDuration(file);
            const rec = await api('recordings.create', { title: file.name.replace(/\.\w+$/, ''), data, mime: MIME[ext] || file.type || 'audio/mpeg', ext, duration, subjectId, originalName: file.name });
            created.push({ type: 'recording', id: rec.id });
            emit('recordings');
            if (stateRef.current.settings.autoTranscribe) startTranscription(rec.id, data);
          } else {
            const doc = await api('documents.import', { name: file.name, data, subjectId });
            created.push({ type: 'document', id: doc.id });
            emit('documents');
            autoTerms('document', doc.id);
          }
        } catch (e) {
          toast(`${file.name}: ${e.message}`, 'error');
        }
      }
      if (created.length) toast(`Imported ${created.length} file${created.length > 1 ? 's' : ''}`, 'success');
      return created;
    },
    [toast, autoTerms, startTranscription],
  );

  const pickFiles = useCallback((accept) => {
    return new Promise((resolve) => {
      const el = fileRef.current;
      el.accept = accept;
      el.value = '';
      el.onchange = () => resolve([...el.files]);
      el.click();
    });
  }, []);

  const pickAndImport = useCallback(
    async (accept, opts) => {
      const files = await pickFiles(accept);
      if (!files.length) return [];
      const created = await importFiles(files, opts);
      if (created.length === 1) openSource(created[0]);
      else if (created.length) go(created[0].type === 'recording' ? 'recordings' : 'notes', created[0].type === 'document' ? { tab: 'documents' } : {});
      return created;
    },
    [pickFiles, importFiles, openSource, go],
  );

  const termRegex = useMemo(() => buildTermRegex(terms), [terms]);

  const value = { route, go, settings, saveSettings, refreshSettings, secrets, secureStorage, ai, subjects, refreshSubjects, terms, termRegex, refreshTerms, termView, setTermView, openTerm, openSource, fail, toast, importFiles, pickFiles, pickAndImport, autoTerms, startTranscription };

  if (fatal)
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div>
          <div className="text-lg font-semibold">eradnotes could not start</div>
          <p className="mt-2 text-sm text-muted">{fatal}</p>
        </div>
      </div>
    );
  if (!settings) return null;

  return (
    <AppCtx.Provider value={value}>
      {children}
      <input ref={fileRef} type="file" multiple hidden />
      <Modal
        open={!!aiSetup}
        onClose={() => setAiSetup(null)}
        title="Set up AI to use this feature"
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setAiSetup(null)}>Not now</Button>
            <Button
              variant="primary"
              icon={Sparkles}
              onClick={() => {
                setAiSetup(null);
                go('settings', { section: 'ai' });
              }}
            >
              Open AI settings
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{aiSetup}</p>
        <p className="mt-2 text-[13px] text-muted">
          Explanations, summaries, the study assistant and study materials need an AI model. You can use a cloud provider with your own API key, or a local model through Ollama so nothing leaves this PC. Notes, recording and transcription work without it.
        </p>
      </Modal>
    </AppCtx.Provider>
  );
}
