import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Untitled note',
  content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  folder TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  source_type TEXT, source_id INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'audio/webm',
  original_name TEXT,
  duration REAL NOT NULL DEFAULT 0,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  segments TEXT NOT NULL DEFAULT '[]',
  transcript_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  original_name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  term_key TEXT NOT NULL UNIQUE,
  simple TEXT NOT NULL DEFAULT '',
  detailed TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  application TEXT NOT NULL DEFAULT '',
  related TEXT NOT NULL DEFAULT '[]',
  saved INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'manual',
  source_type TEXT, source_id INTEGER,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL, source_id INTEGER NOT NULL,
  style TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'full',
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'New chat',
  scope TEXT NOT NULL DEFAULT '{"mode":"all"}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  data TEXT NOT NULL DEFAULT '{}',
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_msgs_chat ON chat_messages(chat_id);
`;

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const d of ['audio', 'documents', 'backups', 'models']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  const file = path.join(dataDir, 'eradnotes.db');
  const raw = new DatabaseSync(file);
  raw.exec(SCHEMA);
  return {
    raw,
    file,
    all: (sql, ...p) => raw.prepare(sql).all(...p.map(clean)),
    get: (sql, ...p) => raw.prepare(sql).get(...p.map(clean)),
    run: (sql, ...p) => raw.prepare(sql).run(...p.map(clean)),
    insert(table, obj) {
      const keys = Object.keys(obj);
      const r = raw
        .prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...keys.map((k) => clean(obj[k])));
      return Number(r.lastInsertRowid);
    },
    update(table, id, obj) {
      const keys = Object.keys(obj);
      if (!keys.length) return;
      raw.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => clean(obj[k])), id);
    },
    close: () => raw.close(),
  };
}

export const now = () => new Date().toISOString();
export const parseJson = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
