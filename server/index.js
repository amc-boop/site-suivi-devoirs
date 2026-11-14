import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, UPLOAD_DIR, tx, getSetting, setSetting } from './db.js';
import { ensureUpTo, today, addDays, weekStart, weekday, weekStats, isDate, priority, diffDays, limits } from './planner.js';
import { rewardProgress } from './rewards.js';
import { geminiEnabled, quizFromImages } from './gemini.js';
import { hashPassword, verifyPassword, seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
seedIfEmpty();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------- Utilitaires ----------
const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); } };
const int = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw fail(400, 'Identifiant invalide'); return n; };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg'}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 4 } });

// ---------- Authentification ----------
const SESSION_DAYS = 60;
function currentUser(req) {
  const token = req.cookies?.sid;
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
  return row || null;
}
const auth = (...roles) => (req, res, next) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Connecte-toi pour continuer.' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Tu n'as pas accès à cette action." });
  req.user = u;
  next();
};
const ALL = auth();
const STUDENT = auth('eleve', 'admin');
const PARENT = auth('parent', 'admin');
const ADMIN = auth('admin');

app.post('/api/login', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(str(req.body.username, 50).toLowerCase());
  if (!u || !verifyPassword(String(req.body.password ?? ''), u.password_hash)) throw fail(401, 'Identifiant ou mot de passe incorrect.');
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 86400000 });
  res.json({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });
}));
app.post('/api/logout', (req, res) => {
  if (req.cookies?.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u, quizEnabled: geminiEnabled(), today: today() });
});
app.post('/api/me/password', ALL, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(req.body.current ?? ''), u.password_hash)) throw fail(400, 'Mot de passe actuel incorrect.');
  const next = String(req.body.next ?? '');
  if (next.length < 6) throw fail(400, 'Le nouveau mot de passe doit faire au moins 6 caractères.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
  res.json({ ok: true });
}));

// ---------- Matières et emploi du temps ----------
app.get('/api/subjects', ALL, (req, res) => res.json(db.prepare('SELECT * FROM subjects ORDER BY position, id').all()));
app.post('/api/subjects', ADMIN, wrap((req, res) => {
  const name = str(req.body.name, 40); if (!name) throw fail(400, 'Nom requis');
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM subjects').get().p;
  const r = db.prepare('INSERT INTO subjects(name, short, is_spe, review_daily, position) VALUES (?,?,?,?,?)')
    .run(name, str(req.body.short, 6) || name.slice(0, 3).toUpperCase(), req.body.is_spe ? 1 : 0, req.body.review_daily === false ? 0 : 1, pos);
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.patch('/api/subjects/:id', ADMIN, wrap((req, res) => {
  const s = db.prepare('SELECT * FROM subjects WHERE id = ?').get(int(req.params.id)); if (!s) throw fail(404, 'Matière introuvable');
  db.prepare('UPDATE subjects SET name=?, short=?, is_spe=?, review_daily=? WHERE id=?').run(
    str(req.body.name ?? s.name, 40), str(req.body.short ?? s.short, 6),
    (req.body.is_spe ?? s.is_spe) ? 1 : 0, (req.body.review_daily ?? s.review_daily) ? 1 : 0, s.id);
  res.json({ ok: true });
}));
app.delete('/api/subjects/:id', ADMIN, wrap((req, res) => { db.prepare('DELETE FROM subjects WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));

app.get('/api/timetable', ALL, (req, res) => res.json(db.prepare('SELECT * FROM timetable ORDER BY weekday, start').all()));
const validSlot = (s) => {
  const wd = Number(s.weekday);
  if (!(wd >= 1 && wd <= 6) || !/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end) || s.end <= s.start) throw fail(400, 'Créneau invalide (jour ou horaires).');
  if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(Number(s.subject_id))) throw fail(400, 'Matière inconnue');
  return [wd, s.start, s.end, Number(s.subject_id), str(s.room, 20)];
};
app.post('/api/timetable', ADMIN, wrap((req, res) => {
  const r = db.prepare('INSERT INTO timetable(weekday,start,end,subject_id,room) VALUES (?,?,?,?,?)').run(...validSlot(req.body));
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.patch('/api/timetable/:id', ADMIN, wrap((req, res) => {
  db.prepare('UPDATE timetable SET weekday=?, start=?, end=?, subject_id=?, room=? WHERE id=?').run(...validSlot(req.body), int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/timetable/:id', ADMIN, wrap((req, res) => { db.prepare('DELETE FROM timetable WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));

// ---------- Réglages ----------
app.get('/api/settings', ALL, (req, res) => res.json(limits()));
app.patch('/api/settings', ADMIN, wrap((req, res) => {
  for (const k of ['maxPerDay', 'maxCarry', 'dsWindow', 'bacBlancWindow']) {
    if (req.body[k] != null) { const n = Number(req.body[k]); if (!(n >= 0 && n <= 30)) throw fail(400, `Valeur invalide pour ${k}`); setSetting(k, n); }
  }
  res.json(limits());
}));

// ---------- Tâches ----------
const taskRow = `SELECT t.*, s.name AS subject_name, s.short AS subject_short FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id`;
const sortTasks = (list) => list.sort((a, b) => (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0) || priority(a.kind) - priority(b.kind) || a.id - b.id);

app.get('/api/today', ALL, wrap((req, res) => {
  const D = today();
  ensureUpTo(D);
  const nextExams = db.prepare(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
    WHERE e.type IN ('ds','bac_blanc','oral') AND e.date >= ? ORDER BY e.date LIMIT 3`).all(D)
    .map((e) => ({ ...e, days: diffDays(D, e.date) }));
  const tasks = sortTasks(db.prepare(`${taskRow} WHERE t.date = ?`).all(D));
  const classes = db.prepare(`SELECT tt.*, s.name AS subject_name, s.short AS subject_short FROM timetable tt JOIN subjects s ON s.id = tt.subject_id
    WHERE tt.weekday = ? ORDER BY tt.start`).all(weekday(D));
  const devoirs = db.prepare(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
    WHERE e.type = 'devoir' AND e.date > ? AND e.date <= ? ORDER BY e.date`).all(D, addDays(D, 7))
    .map((e) => ({ ...e, days: diffDays(D, e.date) }));
  const late = db.prepare(`${taskRow} WHERE t.done_at IS NULL AND t.date < ? AND t.date >= ? ORDER BY t.date DESC`).all(D, addDays(D, -14));
  const week = weekStats(weekStart(D));
  res.json({ date: D, nextExams, tasks, classes, devoirs, late, week, limits: limits() });
}));

app.post('/api/tasks', STUDENT, wrap((req, res) => {
  const title = str(req.body.title, 140); if (!title) throw fail(400, 'Titre requis');
  const date = isDate(req.body.date) ? req.body.date : today();
  const kind = ['revision_cours', 'bac_francais', 'refaire_ds', 'exercice', 'devoir', 'ds', 'autre'].includes(req.body.kind) ? req.body.kind : 'autre';
  const subject = req.body.subject_id ? Number(req.body.subject_id) : null;
  const r = db.prepare(`INSERT INTO tasks(date, original_date, title, subject_id, kind, source) VALUES (?,?,?,?,?, 'manuel')`)
    .run(date, date, title, subject, kind);
  res.json(db.prepare(`${taskRow} WHERE t.id = ?`).get(Number(r.lastInsertRowid)));
}));
app.patch('/api/tasks/:id', STUDENT, wrap((req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(int(req.params.id)); if (!t) throw fail(404, 'Tâche introuvable');
  if ('done' in req.body) db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(req.body.done ? new Date().toISOString() : null, t.id);
  if (req.body.title) db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(str(req.body.title, 140), t.id);
  if (isDate(req.body.date)) db.prepare('UPDATE tasks SET date = ? WHERE id = ?').run(req.body.date, t.id);
  res.json(db.prepare(`${taskRow} WHERE t.id = ?`).get(t.id));
}));
app.delete('/api/tasks/:id', STUDENT, wrap((req, res) => { db.prepare('DELETE FROM tasks WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));
app.post('/api/tasks/:id/photo', STUDENT, upload.single('photo'), wrap((req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(int(req.params.id)); if (!t) throw fail(404, 'Tâche introuvable');
  if (!req.file) throw fail(400, 'Photo manquante (formats image uniquement).');
  if (t.photo) fs.rm(path.join(UPLOAD_DIR, t.photo), () => {});
  db.prepare('UPDATE tasks SET photo = ?, done_at = COALESCE(done_at, ?) WHERE id = ?').run(req.file.filename, new Date().toISOString(), t.id);
  res.json(db.prepare(`${taskRow} WHERE t.id = ?`).get(t.id));
}));
app.get('/uploads/:file', ALL, (req, res) => {
  const f = path.basename(req.params.file);
  res.sendFile(path.join(UPLOAD_DIR, f), (err) => err && res.status(404).end());
});

// ---------- Agenda (semaine) ----------
app.get('/api/week', ALL, wrap((req, res) => {
  const ws = weekStart(isDate(req.query.start) ? req.query.start : today());
  if (ws <= today()) ensureUpTo();
  const we = addDays(ws, 6);
  const tt = db.prepare(`SELECT tt.*, s.name AS subject_name, s.short AS subject_short FROM timetable tt JOIN subjects s ON s.id = tt.subject_id ORDER BY tt.start`).all();
  const events = db.prepare(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date`).all(ws, we);
  const tasks = db.prepare(`${taskRow} WHERE t.date BETWEEN ? AND ?`).all(ws, we);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i);
    return {
      date,
      classes: tt.filter((c) => c.weekday === i + 1),
      events: events.filter((e) => e.date === date),
      tasks: sortTasks(tasks.filter((t) => t.date === date)),
    };
  });
  res.json({ week_start: ws, today: today(), days });
}));

// ---------- Événements : DS, bacs blancs, devoirs ----------
const EVENT_TYPES = ['ds', 'bac_blanc', 'devoir', 'oral', 'autre'];
app.get('/api/events', ALL, (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : addDays(today(), -30);
  res.json(db.prepare(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id WHERE e.date >= ? ORDER BY e.date`).all(from));
});
const eventFields = (b) => {
  if (!EVENT_TYPES.includes(b.type)) throw fail(400, "Type d'événement invalide");
  if (!isDate(b.date)) throw fail(400, 'Date invalide');
  const title = str(b.title, 120); if (!title) throw fail(400, 'Titre requis');
  return [b.type, title, b.subject_id ? Number(b.subject_id) : null, b.date, str(b.notes, 500)];
};
app.post('/api/events', STUDENT, wrap((req, res) => {
  const r = db.prepare('INSERT INTO events(type,title,subject_id,date,notes) VALUES (?,?,?,?,?)').run(...eventFields(req.body));
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.patch('/api/events/:id', STUDENT, wrap((req, res) => {
  db.prepare('UPDATE events SET type=?, title=?, subject_id=?, date=?, notes=? WHERE id=?').run(...eventFields(req.body), int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/events/:id', STUDENT, wrap((req, res) => { db.prepare('DELETE FROM events WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));

// ---------- Rendu de la semaine ----------
function weekReport(ws) {
  const we = addDays(ws, 6);
  const tasks = db.prepare(`${taskRow} WHERE t.original_date BETWEEN ? AND ? ORDER BY t.original_date, t.id`).all(ws, we);
  const report = db.prepare(`SELECT r.*, u.display_name AS seen_by_name FROM weekly_reports r LEFT JOIN users u ON u.id = r.seen_by WHERE week_start = ?`).get(ws) || null;
  return { week_start: ws, today: today(), stats: weekStats(ws), report, tasks };
}
app.get('/api/report', ALL, wrap((req, res) => res.json(weekReport(weekStart(isDate(req.query.week) ? req.query.week : today())))));
app.post('/api/report/submit', STUDENT, wrap((req, res) => {
  const ws = weekStart(isDate(req.body.week) ? req.body.week : today());
  db.prepare(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment) VALUES (?,?,?)
    ON CONFLICT(week_start) DO UPDATE SET submitted_at = excluded.submitted_at, student_comment = excluded.student_comment`)
    .run(ws, new Date().toISOString(), str(req.body.comment, 1000));
  res.json(weekReport(ws));
}));
app.post('/api/report/seen', PARENT, wrap((req, res) => {
  const ws = weekStart(isDate(req.body.week) ? req.body.week : today());
  db.prepare(`INSERT INTO weekly_reports(week_start, seen_at, seen_by, parent_comment) VALUES (?,?,?,?)
    ON CONFLICT(week_start) DO UPDATE SET seen_at = excluded.seen_at, seen_by = excluded.seen_by, parent_comment = excluded.parent_comment`)
    .run(ws, new Date().toISOString(), req.user.id, str(req.body.comment, 1000));
  res.json(weekReport(ws));
}));

// ---------- Bilan parents ----------
app.get('/api/overview', ALL, wrap((req, res) => {
  ensureUpTo();
  const cur = weekStart(today());
  const weeks = [];
  for (let i = 0; i < 12; i++) {
    const ws = addDays(cur, -7 * i);
    const s = weekStats(ws);
    const r = db.prepare('SELECT submitted_at, seen_at, parent_comment FROM weekly_reports WHERE week_start = ?').get(ws);
    if (s.total === 0 && !r && i > 0) continue;
    weeks.push({ ...s, submitted_at: r?.submitted_at ?? null, seen_at: r?.seen_at ?? null, parent_comment: r?.parent_comment ?? '' });
  }
  const lateTasks = db.prepare(`${taskRow} WHERE t.done_at IS NULL AND t.date < ? AND t.original_date >= ? ORDER BY t.date DESC LIMIT 30`).all(today(), addDays(today(), -14));
  const nextExams = db.prepare(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
    WHERE e.date >= ? AND e.type != 'autre' ORDER BY e.date LIMIT 6`).all(today()).map((e) => ({ ...e, days: diffDays(today(), e.date) }));
  res.json({ weeks, lateTasks, nextExams });
}));

// ---------- Notes ----------
app.get('/api/grades', ALL, (req, res) => res.json(db.prepare(`SELECT g.*, s.name AS subject_name FROM grades g JOIN subjects s ON s.id = g.subject_id ORDER BY g.date`).all()));
app.post('/api/grades', ALL, wrap((req, res) => {
  const value = Number(req.body.value), out_of = Number(req.body.out_of || 20), coef = Number(req.body.coef || 1);
  if (!(out_of > 0) || !(value >= 0 && value <= out_of)) throw fail(400, 'Note invalide');
  if (!isDate(req.body.date)) throw fail(400, 'Date invalide');
  if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(Number(req.body.subject_id))) throw fail(400, 'Matière inconnue');
  const r = db.prepare('INSERT INTO grades(subject_id,date,title,value,out_of,coef) VALUES (?,?,?,?,?,?)')
    .run(Number(req.body.subject_id), req.body.date, str(req.body.title, 80) || 'DS', value, out_of, coef > 0 ? coef : 1);
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.delete('/api/grades/:id', ALL, wrap((req, res) => { db.prepare('DELETE FROM grades WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));

// ---------- Récompenses ----------
app.get('/api/rewards', ALL, (req, res) => {
  res.json(db.prepare('SELECT * FROM rewards ORDER BY given_at IS NOT NULL, id').all()
    .map((r) => ({ ...r, params: JSON.parse(r.params), progress: rewardProgress(r) })));
});
app.post('/api/rewards', PARENT, wrap((req, res) => {
  const rule = req.body.rule; if (!['semaines', 'note', 'manuel'].includes(rule)) throw fail(400, 'Règle invalide');
  const title = str(req.body.title, 100); if (!title) throw fail(400, 'Titre requis');
  const p = req.body.params || {};
  let params = {};
  if (rule === 'semaines') params = { pct: Math.min(100, Math.max(10, Number(p.pct) || 80)), weeks: Math.min(20, Math.max(1, Number(p.weeks) || 3)) };
  if (rule === 'note') {
    if (!db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(Number(p.subject_id))) throw fail(400, 'Choisis une matière');
    params = { subject_id: Number(p.subject_id), points: Math.max(0.5, Number(p.points) || 2), last: 2 };
  }
  const r = db.prepare('INSERT INTO rewards(title, prize, rule, params, created_at) VALUES (?,?,?,?,?)')
    .run(title, str(req.body.prize, 120), rule, JSON.stringify(params), today());
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.post('/api/rewards/:id/given', PARENT, wrap((req, res) => {
  db.prepare('UPDATE rewards SET given_at = ? WHERE id = ?').run(req.body.given === false ? null : today(), int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/rewards/:id', PARENT, wrap((req, res) => { db.prepare('DELETE FROM rewards WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));

// ---------- Quiz (Gemini) ----------
app.get('/api/quizzes', ALL, (req, res) => res.json(db.prepare(`SELECT q.id, q.chapter, q.created_at, q.best_score, q.attempts, q.subject_id, s.name AS subject_name,
  json_array_length(q.questions) AS count FROM quizzes q LEFT JOIN subjects s ON s.id = q.subject_id ORDER BY q.id DESC`).all()));
app.get('/api/quizzes/:id', ALL, wrap((req, res) => {
  const q = db.prepare(`SELECT q.*, s.name AS subject_name FROM quizzes q LEFT JOIN subjects s ON s.id = q.subject_id WHERE q.id = ?`).get(int(req.params.id));
  if (!q) throw fail(404, 'Quiz introuvable');
  res.json({ ...q, questions: JSON.parse(q.questions) });
}));
app.post('/api/quizzes', STUDENT, memUpload.array('photos', 4), wrap(async (req, res) => {
  if (!geminiEnabled()) throw fail(503, 'Le quiz est désactivé : ajoute une clé GEMINI_API_KEY dans le fichier .env.');
  const files = (req.files || []).filter((f) => /^image\//.test(f.mimetype));
  if (!files.length) throw fail(400, 'Ajoute au moins une photo de cours.');
  const subj = db.prepare('SELECT * FROM subjects WHERE id = ?').get(Number(req.body.subject_id));
  const chapter = str(req.body.chapter, 80) || 'Chapitre';
  const out = await quizFromImages(files.map((f) => ({ mime: f.mimetype, buffer: f.buffer })), { subject: subj?.name, chapter, count: Number(req.body.count) || 8 });
  const r = db.prepare('INSERT INTO quizzes(subject_id, chapter, questions) VALUES (?,?,?)').run(subj?.id ?? null, chapter, JSON.stringify(out.questions));
  res.json({ id: Number(r.lastInsertRowid) });
}));
app.post('/api/quizzes/:id/score', STUDENT, wrap((req, res) => {
  const score = Math.max(0, Number(req.body.score) || 0);
  db.prepare('UPDATE quizzes SET attempts = attempts + 1, best_score = MAX(COALESCE(best_score, 0), ?) WHERE id = ?').run(score, int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/quizzes/:id', STUDENT, wrap((req, res) => { db.prepare('DELETE FROM quizzes WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); }));

// ---------- Comptes (admin) ----------
app.get('/api/users', ADMIN, (req, res) => res.json(db.prepare('SELECT id, username, display_name, role FROM users ORDER BY role, id').all()));
app.post('/api/users', ADMIN, wrap((req, res) => {
  const username = str(req.body.username, 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw fail(400, 'Identifiant : 3 à 30 caractères (lettres, chiffres, . _ -).');
  if (!['eleve', 'parent', 'admin'].includes(req.body.role)) throw fail(400, 'Rôle invalide');
  if (String(req.body.password ?? '').length < 6) throw fail(400, 'Mot de passe : 6 caractères minimum.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw fail(400, 'Cet identifiant existe déjà.');
  db.prepare('INSERT INTO users(username, display_name, role, password_hash) VALUES (?,?,?,?)')
    .run(username, str(req.body.display_name, 40) || username, req.body.role, hashPassword(String(req.body.password)));
  res.json({ ok: true });
}));
app.patch('/api/users/:id', ADMIN, wrap((req, res) => {
  const id = int(req.params.id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw fail(400, 'Mot de passe : 6 caractères minimum.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (req.body.display_name) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(str(req.body.display_name, 40), id);
  res.json({ ok: true });
}));
app.delete('/api/users/:id', ADMIN, wrap((req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) throw fail(400, 'Tu ne peux pas supprimer ton propre compte.');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// ---------- Fichiers du site en production ----------
const dist = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500 && status !== 502 && status !== 503) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Erreur du serveur.' : err.message });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, '0.0.0.0', () => console.log(`API prête sur http://localhost:${PORT}${geminiEnabled() ? ' (quiz Gemini activé)' : ' (quiz désactivé : pas de GEMINI_API_KEY)'}`));
