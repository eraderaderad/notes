// Electron main process for eradnotes. Single window, no login, no network listeners.
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, session, desktopCapturer } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.ERAD_DEV_URL || null;

// The self-test runs as a separate, isolated instance so it works while your normal window is open.
if (process.env.ERAD_SELFTEST) app.setPath('userData', path.join(path.dirname(process.env.ERAD_SELFTEST), 'electron-profile'));
else if (!app.requestSingleInstanceLock()) app.quit();

// The data folder location is remembered in a tiny config file next to Electron's own profile.
const configFile = () => path.join(app.getPath('userData'), 'eradnotes-config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}
const defaultDataDir = () => path.join(app.getPath('documents'), 'eradnotes');

let backend = null;
let win = null;
let dataDir = null;

function startBackend() {
  dataDir = process.env.ERAD_DATA_DIR || readConfig().dataDir || defaultDataDir();
  const crypto = safeStorage.isEncryptionAvailable() ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) } : null;
  backend = createBackend({ dataDir, crypto, version: app.getVersion() });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f4f0',
    title: 'eradnotes',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // External links open in the default browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(here, '..', 'dist', 'index.html'));
  if (process.env.ERAD_SELFTEST) win.webContents.once('did-finish-load', () => selfTest().catch((e) => finishSelfTest({ error: String(e?.stack || e) })));
}

// ---- self-test (npm run selftest): checks the real window, IPC bridge and the speech worker, then quits ----
function finishSelfTest(result) {
  fs.writeFileSync(process.env.ERAD_SELFTEST, JSON.stringify(result, null, 2));
  app.exit(result.error ? 1 : 0);
}
async function selfTest() {
  const out = {};
  await new Promise((r) => setTimeout(r, 1500));
  out.renderer = await win.webContents.executeJavaScript(`(async () => ({
    title: document.title,
    hasSidebar: !!document.querySelector('nav'),
    text: document.body.innerText.slice(0, 160),
    ipc: typeof window.erad?.invoke,
    stats: (await window.erad.invoke('dashboard.stats', {})).ok,
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]') ? 'set' : 'none',
  }))()`);
  out.secureStorage = backend.ctx.secrets.persistent;
  // System audio: capture loopback while the app plays a short quiet tone, and check the tone is heard.
  out.systemAudio = await win.webContents.executeJavaScript(`(async () => {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    s.getVideoTracks().forEach((t) => t.stop());
    const tracks = s.getAudioTracks().length;
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 2048;
    // Same graph the recorder uses: inputs -> mixer destination -> MediaRecorder.
    const dest = ac.createMediaStreamDestination();
    const src = ac.createMediaStreamSource(s);
    src.connect(an);
    src.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    const quiet = new Float32Array(an.fftSize);
    await new Promise((r) => setTimeout(r, 400));
    an.getFloatTimeDomainData(quiet);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.08;
    osc.frequency.value = 440;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    let peak = 0;
    const buf = new Float32Array(an.fftSize);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100));
      an.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }
    osc.stop();
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    s.getTracks().forEach((t) => t.stop());
    await ac.close();
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
    let recPeak = 0;
    for (const v of decoded.getChannelData(0)) recPeak = Math.max(recPeak, Math.abs(v));
    return { audioTracks: tracks, peakWhilePlaying: +peak.toFixed(4), heard: peak > 0.01, recordedBytes: blob.size, recordedSeconds: +decoded.duration.toFixed(2), recordedPeak: +recPeak.toFixed(4) };
  })()`);
  const wav = process.env.ERAD_SELFTEST_WAV;
  if (wav) {
    const buf = fs.readFileSync(wav);
    const at = buf.indexOf(Buffer.from('data')) + 8;
    const pcm16 = new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + at + Math.floor((buf.length - at) / 2) * 2));
    const pcm = Float32Array.from(pcm16, (v) => v / 32768);
    const t0 = Date.now();
    const load = await backend.call('transcribe.load', { model: 'base' });
    if (!load.ok) throw new Error(load.error.message);
    const r = await backend.call('transcribe.chunk', { pcm: pcm.slice(0, 16000 * 28), language: 'english' });
    if (!r.ok) throw new Error(r.error.message);
    out.transcription = { seconds: (Date.now() - t0) / 1000, text: r.data.text.trim() };
  }
  finishSelfTest(out);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Only audio is ever granted (microphone, plus system audio below); every other permission request is refused.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => cb((permission === 'media' && !details.mediaTypes?.includes('video')) || permission === 'display-capture'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'display-capture');
  // System audio ("what you hear"): Windows loopback capture. Chromium requires a video source alongside it;
  // the renderer drops that video track immediately, so nothing on screen is ever recorded or stored.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  startBackend();

  ipcMain.handle('api', (_e, name, payload) => backend.call(String(name), payload));

  ipcMain.handle('native', async (_e, action, arg) => {
    if (action === 'info') return { dataDir, defaultDataDir: defaultDataDir(), secureStorage: safeStorage.isEncryptionAvailable() };
    if (action === 'openDataDir') return shell.openPath(dataDir);
    if (action === 'pickFolder') {
      const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for eradnotes data', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    }
    if (action === 'setDataDir') {
      // Copies the current data to the new folder, then restarts using it. The old folder is left untouched.
      const target = path.resolve(String(arg));
      if (target === path.resolve(dataDir)) return { same: true };
      const hasDb = fs.existsSync(path.join(target, 'eradnotes.db'));
      if (!hasDb) {
        if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Choose an empty folder, or one that already contains eradnotes data.');
        backend.ctx.db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        backend.dispose();
        fs.cpSync(dataDir, target, { recursive: true });
      } else backend.dispose();
      writeConfig({ ...readConfig(), dataDir: target });
      app.relaunch();
      app.exit(0);
    }
    return null;
  });

  createWindow();

  backend.call('backup.auto');
  setInterval(() => backend.call('backup.auto'), 30 * 60e3);

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
});

app.on('window-all-closed', () => {
  backend?.dispose();
  app.quit();
});
