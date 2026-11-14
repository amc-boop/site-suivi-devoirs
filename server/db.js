// Base de données SQLite locale (module intégré à Node, aucun service externe).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'suivi.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('eleve','parent','admin')),
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  is_spe INTEGER NOT NULL DEFAULT 0,
  review_daily INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY,
  weekday INTEGER NOT NULL, -- 1 = lundi ... 6 = samedi
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  room TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ds','bac_blanc','bac','devoir','oral','autre')),
  title TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  original_date TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'autre',
  source TEXT NOT NULL DEFAULT 'manuel',
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  auto_key TEXT,
  carried INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  photo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_auto_key ON tasks(auto_key) WHERE auto_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS generated_days (date TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS weekly_reports (
  id INTEGER PRIMARY KEY,
  week_start TEXT UNIQUE NOT NULL,
  submitted_at TEXT,
  student_comment TEXT DEFAULT '',
  seen_at TEXT,
  seen_by INTEGER REFERENCES users(id),
  parent_comment TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  value REAL NOT NULL,
  out_of REAL NOT NULL DEFAULT 20,
  coef REAL NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  prize TEXT NOT NULL DEFAULT '',
  rule TEXT NOT NULL CHECK (rule IN ('semaines','note','manuel')),
  params TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (date('now')),
  given_at TEXT
);
CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  chapter TEXT NOT NULL,
  questions TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  best_score INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Migrations légères pour les bases déjà créées
// Ajout du type d'événement « bac » (épreuve officielle) : on recrée la table si besoin
const evSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get()?.sql || '';
if (!evSql.includes("'bac',")) {
  // legacy_alter_table : ne pas réécrire les références des autres tables (tasks.event_id) vers events_old
  db.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;');
  db.exec(`BEGIN;
    ALTER TABLE events RENAME TO events_old;
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('ds','bac_blanc','bac','devoir','oral','autre')),
      title TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      notes TEXT DEFAULT ''
    );
    INSERT INTO events SELECT * FROM events_old;
    DROP TABLE events_old;
    COMMIT;`);
  db.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
}
const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
if (!taskCols.includes('time')) db.exec('ALTER TABLE tasks ADD COLUMN time TEXT');
if (!taskCols.includes('duration')) db.exec('ALTER TABLE tasks ADD COLUMN duration INTEGER NOT NULL DEFAULT 30');

export const getSetting = (key, def) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : def;
};
export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
