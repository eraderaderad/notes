// Settings, secrets, storage info, backups, export and data deletion.
import fs from 'node:fs';
import path from 'node:path';
import { now, parseJson } from './db.js';
import { AppError } from './ai.js';

function dirSize(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

const SECRET_NAMES = ['anthropicKey', 'openaiKey'];
const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'untitled';

export function systemHandlers(ctx) {
  const db = () => ctx.db;

  function createBackup(label = 'auto') {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `eradnotes-${stamp}-${label}.db`;
    const dest = path.join(ctx.paths.backups, name);
    db().raw.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    ctx.settings.set({ lastBackupAt: now() });
    // Keep only the newest N automatic backups.
    const keep = Math.max(1, +ctx.settings.all().backupKeep || 10);
    const autos = fs.readdirSync(ctx.paths.backups).filter((f) => /^eradnotes-.*-auto\.db$/.test(f)).sort().reverse();
    for (const f of autos.slice(keep)) fs.rmSync(path.join(ctx.paths.backups, f), { force: true });
    return { name, size: fs.statSync(dest).size };
  }

  return {
    'settings.get': () => ({
      settings: ctx.settings.all(),
      secrets: Object.fromEntries(SECRET_NAMES.map((n) => [n, ctx.secrets.has(n)])),
      secureStorage: ctx.secrets.persistent,
    }),
    'settings.set': (obj) => {
      ctx.settings.set(obj);
      return ctx.settings.all();
    },
    'secrets.set': ({ name, value }) => {
      if (!SECRET_NAMES.includes(name)) throw new AppError('Unknown secret.', 'BAD_INPUT');
      ctx.secrets.set(name, String(value || '').trim());
      return { set: ctx.secrets.has(name) };
    },

    'system.info': () => ({
      version: ctx.version,
      dataDir: ctx.dataDir,
      sizes: {
        database: fs.existsSync(db().file) ? fs.statSync(db().file).size : 0,
        audio: dirSize(ctx.paths.audio),
        documents: dirSize(ctx.paths.documents),
        backups: dirSize(ctx.paths.backups),
        models: dirSize(ctx.paths.models),
      },
    }),

    'backup.create': () => createBackup('manual'),
    /** Called by the host on a timer: backs up only when the interval has elapsed. */
    'backup.auto': () => {
      const s = ctx.settings.all();
      const hours = +s.backupIntervalHours;
      if (!hours) return { skipped: true };
      if (s.lastBackupAt && Date.now() - new Date(s.lastBackupAt).getTime() < hours * 3600e3) return { skipped: true };
      const hasData = db().get('SELECT (SELECT COUNT(*) FROM notes) + (SELECT COUNT(*) FROM recordings) + (SELECT COUNT(*) FROM documents) + (SELECT COUNT(*) FROM glossary) AS n').n;
      if (!hasData) return { skipped: true };
      return createBackup('auto');
    },
    'backup.list': () =>
      fs
        .readdirSync(ctx.paths.backups)
        .filter((f) => f.endsWith('.db'))
        .map((f) => {
          const st = fs.statSync(path.join(ctx.paths.backups, f));
          return { name: f, size: st.size, date: st.mtime.toISOString() };
        })
        .sort((a, b) => b.date.localeCompare(a.date)),
    'backup.delete': ({ name }) => void fs.rmSync(path.join(ctx.paths.backups, path.basename(name)), { force: true }),
    'backup.restore': ({ name }) => {
      const src = path.join(ctx.paths.backups, path.basename(name));
      if (!fs.existsSync(src)) throw new AppError('That backup file no longer exists.', 'NOT_FOUND');
      createBackup('before-restore');
      const file = db().file;
      db().close();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
      fs.copyFileSync(src, file);
      ctx.reopen();
      return { restored: name };
    },

    /** Everything in one zip: the database, original audio and documents, and each note as HTML. */
    'export.all': async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      db().raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      zip.file('eradnotes.db', fs.readFileSync(db().file));
      for (const dir of ['audio', 'documents']) for (const f of fs.readdirSync(ctx.paths[dir])) zip.file(`${dir}/${f}`, fs.readFileSync(path.join(ctx.paths[dir], f)));
      const used = new Set();
      const unique = (base, ext) => {
        let n = safeName(base);
        let i = 1;
        while (used.has(`${n}.${ext}`.toLowerCase())) n = `${safeName(base)} (${++i})`;
        used.add(`${n}.${ext}`.toLowerCase());
        return `${n}.${ext}`;
      };
      for (const n of db().all('SELECT title, content_html FROM notes WHERE deleted_at IS NULL'))
        zip.file(`notes/${unique(n.title, 'html')}`, `<!doctype html><meta charset="utf-8"><title>${n.title.replace(/</g, '&lt;')}</title><h1>${n.title.replace(/</g, '&lt;')}</h1>\n${n.content_html}`);
      for (const r of db().all("SELECT title, transcript_text FROM recordings WHERE deleted_at IS NULL AND transcript_text != ''")) zip.file(`transcripts/${unique(r.title, 'txt')}`, r.transcript_text);
      const glossary = db().all('SELECT term, simple, detailed, example, application, related FROM glossary ORDER BY term').map((g) => ({ ...g, related: parseJson(g.related, []) }));
      zip.file('glossary.json', JSON.stringify(glossary, null, 2));
      return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), name: `eradnotes-export-${new Date().toISOString().slice(0, 10)}.zip` };
    },

    /** Permanently delete all personal data. Downloaded speech models are kept (they contain nothing personal). */
    'data.wipe': ({ confirm }) => {
      if (confirm !== 'DELETE') throw new AppError('Type DELETE to confirm.', 'BAD_INPUT');
      const file = db().file;
      db().close();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
      for (const d of ['audio', 'documents', 'backups']) fs.rmSync(ctx.paths[d], { recursive: true, force: true });
      for (const n of SECRET_NAMES) if (!ctx.secrets.persistent) ctx.secrets.set(n, '');
      ctx.reopen();
      return { wiped: true };
    },
  };
}
