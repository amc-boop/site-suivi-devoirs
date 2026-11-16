// Base de données Postgres.
// - En ligne (Vercel) et dès que DATABASE_URL est défini : la base Postgres de Supabase.
// - En local sans DATABASE_URL : PGlite, un vrai Postgres embarqué dans data/pglite (aucun compte nécessaire).
// Les requêtes s'écrivent avec des « ? » (ou « ?1, ?2 ») et sont converties en $1, $2… pour Postgres.
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const usingSupabaseDb = Boolean(process.env.DATABASE_URL);

let driverPromise;
function driver() {
  if (driverPromise) return driverPromise;
  driverPromise = (async () => {
    if (usingSupabaseDb) {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
        max: process.env.VERCEL ? 3 : 8,
      });
      return {
        query: (text, params) => pool.query(text, params),
        async transaction(fn) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const r = await fn({ query: (t, p) => client.query(t, p) });
            await client.query('COMMIT');
            return r;
          } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
        },
      };
    }
    const { PGlite } = await import('@electric-sql/pglite');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const lite = new PGlite(path.join(DATA_DIR, 'pglite'));
    await lite.waitReady;
    return {
      query: (text, params) => lite.query(text, params),
      transaction: (fn) => lite.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
    };
  })();
  return driverPromise;
}

// Les requêtes d'une transaction passent automatiquement par la connexion de la transaction
const txStore = new AsyncLocalStorage();
const toPg = (sql) => { let n = 0; return sql.replace(/\?(\d+)?/g, (_, num) => `$${num || ++n}`); };

async function exec(sql, params) {
  const runner = txStore.getStore() || await driver();
  return runner.query(toPg(sql), params.map((v) => (v === undefined ? null : v)));
}
export const all = async (sql, ...params) => (await exec(sql, params)).rows;
export const one = async (sql, ...params) => (await exec(sql, params)).rows[0] || undefined;
export const run = async (sql, ...params) => { const r = await exec(sql, params); return { changes: r.rowCount ?? r.affectedRows ?? 0 }; };
// INSERT … : renvoie l'id créé
export const insert = async (sql, ...params) => (await exec(`${sql} RETURNING id`, params)).rows[0]?.id;
export async function tx(fn) {
  if (txStore.getStore()) return fn();
  const d = await driver();
  return d.transaction((t) => txStore.run(t, fn));
}

// ---------- Schéma ----------
const NOW = `to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('eleve','parent','admin')),
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  is_spe INTEGER NOT NULL DEFAULT 0,
  review_daily INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS timetable (
  id SERIAL PRIMARY KEY,
  weekday INTEGER NOT NULL,
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  room TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ds','bac_blanc','bac','devoir','oral','autre')),
  title TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
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
  time TEXT,
  duration INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_auto_key ON tasks(auto_key) WHERE auto_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_date ON tasks(date);
CREATE INDEX IF NOT EXISTS tasks_original_date ON tasks(original_date);
CREATE TABLE IF NOT EXISTS generated_days (date TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS weekly_reports (
  id SERIAL PRIMARY KEY,
  week_start TEXT UNIQUE NOT NULL,
  submitted_at TEXT,
  student_comment TEXT DEFAULT '',
  seen_at TEXT,
  seen_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_comment TEXT DEFAULT '',
  status TEXT
);
CREATE TABLE IF NOT EXISTS daily_reports (
  date TEXT PRIMARY KEY,
  submitted_at TEXT NOT NULL,
  comment TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS weekly_quizzes (
  week_start TEXT PRIMARY KEY,
  questions TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  current_answers TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER,
  last_score INTEGER,
  passed_at TEXT
);
-- Téléphones abonnés aux notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
-- Alertes pour les parents (rendu incomplet…)
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  seen_at TEXT
);
CREATE TABLE IF NOT EXISTS grades (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  out_of DOUBLE PRECISION NOT NULL DEFAULT 20,
  coef DOUBLE PRECISION NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rewards (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  prize TEXT NOT NULL DEFAULT '',
  rule TEXT NOT NULL CHECK (rule IN ('semaines','note','manuel')),
  params TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  given_at TEXT
);
CREATE TABLE IF NOT EXISTS quizzes (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  chapter TEXT NOT NULL,
  questions TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  best_score INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export const TABLES = ['push_subscriptions', 'alerts', 'weekly_quizzes', 'quizzes', 'rewards', 'grades', 'daily_reports', 'weekly_reports', 'generated_days', 'tasks', 'events', 'timetable', 'subjects', 'sessions', 'users', 'settings'];

let ready;
// À appeler avant la première requête (création des tables si besoin, une fois par démarrage)
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const d = await driver();
      for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await d.query(stmt);
      // Sécurité Supabase : sans politique, l'API publique de Supabase (clé « publishable ») ne peut lire
      // aucune table. Seul notre serveur, connecté directement à Postgres, y a accès.
      // Colonnes ajoutées après la mise en ligne (bases déjà créées)
      for (const stmt of [
        'ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS total INTEGER',
        'ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS done INTEGER',
        "ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS missing TEXT NOT NULL DEFAULT '[]'",
        'ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS total INTEGER',
        'ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS done INTEGER',
        "ALTER TABLE weekly_reports ADD COLUMN IF NOT EXISTS missing TEXT NOT NULL DEFAULT '[]'",
      ]) await d.query(stmt);
      for (const t of TABLES) await d.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export const getSetting = async (key, def) => {
  const row = await one('SELECT value FROM settings WHERE key = ?', key);
  return row ? JSON.parse(row.value) : def;
};
export const setSetting = (key, value) =>
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
