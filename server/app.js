// API du site : utilisée en local (server/index.js) et en ligne sur Vercel (api/index.js).
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import { all, one, run, insert, tx, ensureSchema, setSetting } from './db.js';
import { ensureUpTo, today, addDays, weekStart, weekday, weekStats, isDate, priority, diffDays, limits } from './planner.js';
import { rewardProgress } from './rewards.js';
import { geminiEnabled, quizFromImages, timetableFromImages } from './gemini.js';
import { publicQuiz, generateWeeklyQuiz, answerQuestion, finishAttempt, weeklyQuizPassed, weeklyQuizSummary, weeklyQuizPossible } from './weeklyQuiz.js';
import { hashPassword, verifyPassword } from './auth.js';
import { savePhoto, readPhoto, deletePhoto } from './storage.js';
import { seedIfEmpty } from './seed.js';

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Diagnostic de la mise en ligne (aucune valeur secrète n'est renvoyée) : /api/health
app.get('/api/health', async (req, res) => {
  const env = Object.fromEntries(['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GEMINI_API_KEY'].map((k) => [k, Boolean(process.env[k])]));
  let db = 'ok';
  try { await ensureSchema(); await one('SELECT 1 AS ok'); } catch (e) { db = `${e.code || e.name}: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>').slice(0, 160)}`; }
  res.status(db === 'ok' ? 200 : 500).json({ env, db, vercel: Boolean(process.env.VERCEL) });
});

// Tables créées au premier appel ; en local, base de démo si elle est vide
let booted;
app.use((req, res, next) => {
  // En ligne sans DATABASE_URL, la base locale ne peut pas fonctionner : message clair plutôt qu'une erreur obscure
  if (process.env.VERCEL && !process.env.DATABASE_URL) return next(Object.assign(new Error('Configuration incomplète : DATABASE_URL manque dans les variables d’environnement Vercel.'), { status: 503 }));
  booted ||= ensureSchema().then(seedIfEmpty);
  booted.then(() => next(), (e) => {
    booted = null;
    console.error('Démarrage de la base impossible :', e.code, e.message);
    next(Object.assign(new Error('Base de données injoignable. Vérifie DATABASE_URL (mot de passe, port 6543).'), { status: 503 }));
  });
});

// ---------- Utilitaires ----------
const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res, next) => { Promise.resolve().then(() => fn(req, res, next)).catch(next); };
const int = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw fail(400, 'Identifiant invalide'); return n; };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();

// Photos en mémoire puis envoyées au stockage (Supabase en ligne, disque en local)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 4 } });

// ---------- Authentification ----------
const SESSION_DAYS = 60;
const secureCookies = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
async function currentUser(req) {
  const token = req.cookies?.sid;
  if (!token) return null;
  return (await one(`SELECT u.id, u.username, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`, token, Date.now())) || null;
}
const auth = (...roles) => wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Connecte-toi pour continuer.' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Tu n'as pas accès à cette action." });
  req.user = u;
  next();
});
const ALL = auth();
const STUDENT = auth('eleve', 'admin');
const PARENT = auth('parent', 'admin');
const ADMIN = auth('admin');

// Limite les essais de mot de passe : 8 échecs en 15 minutes par adresse et identifiant
const attempts = new Map();
const tooMany = (key) => { const a = attempts.get(key); return a && a.n >= 8 && Date.now() - a.t < 15 * 60000; };
const noteFailure = (key) => { const a = attempts.get(key); attempts.set(key, a && Date.now() - a.t < 15 * 60000 ? { n: a.n + 1, t: a.t } : { n: 1, t: Date.now() }); };

app.post('/api/login', wrap(async (req, res) => {
  const username = str(req.body.username, 50).toLowerCase();
  const key = `${req.ip}|${username}`;
  if (tooMany(key)) throw fail(429, 'Trop d’essais. Réessaie dans 15 minutes.');
  const u = await one('SELECT * FROM users WHERE username = ?', username);
  if (!u || !verifyPassword(String(req.body.password ?? ''), u.password_hash)) { noteFailure(key); throw fail(401, 'Identifiant ou mot de passe incorrect.'); }
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  await run('INSERT INTO sessions(token, user_id, expires_at) VALUES (?,?,?)', token, u.id, Date.now() + SESSION_DAYS * 86400000);
  await run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: SESSION_DAYS * 86400000 });
  res.json({ id: u.id, username: u.username, display_name: u.display_name, role: u.role });
}));
app.post('/api/logout', wrap(async (req, res) => {
  if (req.cookies?.sid) await run('DELETE FROM sessions WHERE token = ?', req.cookies.sid);
  res.clearCookie('sid', { httpOnly: true, sameSite: 'lax', secure: secureCookies });
  res.json({ ok: true });
}));
app.get('/api/me', wrap(async (req, res) => {
  res.json({ user: await currentUser(req), quizEnabled: geminiEnabled(), today: today() });
}));
app.post('/api/me/password', ALL, wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body.current ?? ''), u.password_hash)) throw fail(400, 'Mot de passe actuel incorrect.');
  const next = String(req.body.next ?? '');
  if (next.length < 6) throw fail(400, 'Le nouveau mot de passe doit faire au moins 6 caractères.');
  await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), u.id);
  // Déconnecte les autres appareils
  await run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', u.id, req.cookies.sid);
  res.json({ ok: true });
}));

// ---------- Matières et emploi du temps ----------
app.get('/api/subjects', ALL, wrap(async (req, res) => res.json(await all('SELECT * FROM subjects ORDER BY position, id'))));
app.post('/api/subjects', ALL, wrap(async (req, res) => {
  const name = str(req.body.name, 40); if (!name) throw fail(400, 'Nom requis');
  const pos = (await one('SELECT COALESCE(MAX(position),0)+1 AS p FROM subjects')).p;
  const id = await insert('INSERT INTO subjects(name, short, is_spe, review_daily, position) VALUES (?,?,?,?,?)',
    name, str(req.body.short, 6) || name.slice(0, 3).toUpperCase(), req.body.is_spe ? 1 : 0, req.body.review_daily === false ? 0 : 1, pos);
  res.json({ id });
}));
app.patch('/api/subjects/:id', ADMIN, wrap(async (req, res) => {
  const s = await one('SELECT * FROM subjects WHERE id = ?', int(req.params.id)); if (!s) throw fail(404, 'Matière introuvable');
  await run('UPDATE subjects SET name=?, short=?, is_spe=?, review_daily=? WHERE id=?',
    str(req.body.name ?? s.name, 40), str(req.body.short ?? s.short, 6),
    (req.body.is_spe ?? s.is_spe) ? 1 : 0, (req.body.review_daily ?? s.review_daily) ? 1 : 0, s.id);
  res.json({ ok: true });
}));
app.delete('/api/subjects/:id', ADMIN, wrap(async (req, res) => { await run('DELETE FROM subjects WHERE id = ?', int(req.params.id)); res.json({ ok: true }); }));

app.get('/api/timetable', ALL, wrap(async (req, res) => res.json(await all('SELECT * FROM timetable ORDER BY weekday, start'))));
const validSlot = async (s) => {
  const wd = Number(s.weekday);
  if (!(wd >= 1 && wd <= 6) || !/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end) || s.end <= s.start) throw fail(400, 'Créneau invalide (jour ou horaires).');
  if (!(await one('SELECT 1 FROM subjects WHERE id = ?', Number(s.subject_id)))) throw fail(400, 'Matière inconnue');
  return [wd, s.start, s.end, Number(s.subject_id), str(s.room, 20)];
};
app.post('/api/timetable', ALL, wrap(async (req, res) => {
  res.json({ id: await insert('INSERT INTO timetable(weekday, start, "end", subject_id, room) VALUES (?,?,?,?,?)', ...(await validSlot(req.body))) });
}));
app.patch('/api/timetable/:id', ALL, wrap(async (req, res) => {
  await run('UPDATE timetable SET weekday=?, start=?, "end"=?, subject_id=?, room=? WHERE id=?', ...(await validSlot(req.body)), int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/timetable/:id', ALL, wrap(async (req, res) => { await run('DELETE FROM timetable WHERE id = ?', int(req.params.id)); res.json({ ok: true }); }));

// ---------- Emploi du temps en photo (Gemini) ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Correspondance nom écrit sur l'emploi du temps -> matière du site (ordre important : EPS avant physique)
const SUBJECT_RULES = [
  ['EPS', /\beps\b|sport|education physique/], ['ES', /enseign\w* scient|ens sci/], ['EMC', /\be ?m ?c\b|moral|civique/],
  ['MATH', /math/], ['SES', /\bses\b|econom|sociales/], ['PC', /physique|chimie|\bpc\b|\bp c\b/],
  ['FR', /francais|\bfr\b|lettres/], ['HG', /hist|geo/], ['ANG', /angl|english|\blv ?1\b|\blva\b/], ['ESP', /espagn|\blv ?2\b|\blvb\b/],
];
function matchSubject(label, subjects) {
  const n = norm(label);
  const exact = subjects.find((s) => norm(s.name) === n || norm(s.short) === n);
  if (exact) return exact;
  for (const [short, re] of SUBJECT_RULES) if (re.test(n)) { const s = subjects.find((x) => x.short === short); if (s) return s; }
  return null;
}
const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()).slice(0, 40);

// 1. Lecture de la photo : renvoie une proposition, rien n'est enregistré
app.post('/api/timetable/import', ALL, memUpload.array('photos', 3), wrap(async (req, res) => {
  const files = (req.files || []).filter((f) => /^image\//.test(f.mimetype));
  if (!files.length) throw fail(400, "Prends une photo de l'emploi du temps.");
  const subjects = await all('SELECT * FROM subjects ORDER BY position, id');
  const found = await timetableFromImages(files.map((f) => ({ mime: f.mimetype, buffer: f.buffer })));
  if (!found.length) throw fail(422, "Aucun cours trouvé sur la photo. Essaie avec une photo plus nette, bien droite, avec les jours et les heures visibles.");
  const matched = found.map((c) => {
    const s = matchSubject(c.label, subjects);
    return { ...c, subject_id: s?.id ?? null, new_subject: s ? '' : titleCase(c.label) };
  }).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  // Deux heures qui se suivent dans la même matière et la même salle = un seul cours (8h-9h + 9h-10h -> 8h-10h)
  const slots = [];
  for (const c of matched) {
    const prev = slots[slots.length - 1];
    if (prev && prev.weekday === c.weekday && prev.end === c.start && prev.label === c.label && prev.room === c.room && prev.week === c.week) prev.end = c.end;
    else slots.push({ ...c });
  }
  res.json({ slots, subjects });
}));

// 2. Enregistrement de la proposition vérifiée : remplace tout l'emploi du temps
app.post('/api/timetable/replace', ALL, wrap(async (req, res) => {
  const slots = Array.isArray(req.body.slots) ? req.body.slots.slice(0, 80) : [];
  if (!slots.length) throw fail(400, 'Aucun cours à enregistrer.');
  const result = await tx(async () => {
    const created = {};
    const rows = [];
    for (const sl of slots) {
      let sid = sl.subject_id ? Number(sl.subject_id) : null;
      if (!sid) {
        const name = str(sl.new_subject, 40); if (!name) throw fail(400, 'Chaque cours doit avoir une matière.');
        if (!created[name]) {
          const pos = (await one('SELECT COALESCE(MAX(position),0)+1 AS p FROM subjects')).p;
          created[name] = await insert('INSERT INTO subjects(name, short, is_spe, review_daily, position) VALUES (?,?,0,1,?)', name, norm(name).replace(/ /g, '').slice(0, 4).toUpperCase() || 'MAT', pos);
        }
        sid = created[name];
      }
      rows.push(await validSlot({ ...sl, subject_id: sid }));
    }
    await run('DELETE FROM timetable');
    for (const r of rows) await run('INSERT INTO timetable(weekday, start, "end", subject_id, room) VALUES (?,?,?,?,?)', ...r);
    // Les tâches « revoir le cours » d'aujourd'hui sont recalculées avec le nouvel emploi du temps
    const T = today();
    await run("DELETE FROM tasks WHERE date = ? AND source = 'auto' AND kind = 'revision_cours' AND done_at IS NULL AND photo IS NULL", T);
    const { maxPerDay } = await limits();
    const todays = await all(`SELECT DISTINCT s.* FROM timetable tt JOIN subjects s ON s.id = tt.subject_id WHERE tt.weekday = ? AND s.review_daily = 1`, weekday(T));
    todays.sort((x, y) => y.is_spe - x.is_spe || x.position - y.position);
    for (const sub of todays) {
      if ((await one('SELECT COUNT(*)::int AS n FROM tasks WHERE date = ?', T)).n >= maxPerDay) break;
      await run(`INSERT INTO tasks(date, original_date, title, subject_id, kind, source, auto_key) VALUES (?,?,?,?, 'revision_cours', 'auto', ?) ON CONFLICT DO NOTHING`,
        T, T, `Revoir le cours de ${sub.name} d'aujourd'hui`, sub.id, `rev-${sub.id}-${T}`);
    }
    return { count: rows.length, newSubjects: Object.keys(created) };
  });
  res.json(result);
}));

// ---------- Réglages ----------
app.get('/api/settings', ALL, wrap(async (req, res) => res.json(await limits())));
app.patch('/api/settings', ADMIN, wrap(async (req, res) => {
  for (const k of ['maxPerDay', 'maxCarry', 'dsWindow', 'bacBlancWindow', 'weeklyQuizPass']) {
    if (req.body[k] != null) {
      const n = Number(req.body[k]);
      if (!(n >= 0 && n <= (k === 'weeklyQuizPass' ? 100 : 30))) throw fail(400, `Valeur invalide pour ${k}`);
      await setSetting(k, n);
    }
  }
  res.json(await limits());
}));

// ---------- Tâches ----------
const taskRow = `SELECT t.*, s.name AS subject_name, s.short AS subject_short FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id`;
const getTask = (id) => one(`${taskRow} WHERE t.id = ?`, id);
const sortTasks = (list) => list.sort((a, b) => (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0)
  || (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || '') || priority(a.kind) - priority(b.kind) || a.id - b.id);
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const defaultDuration = (kind) => (['ds', 'refaire_ds', 'devoir'].includes(kind) ? 60 : 30);
const withDays = (D) => (e) => (e ? { ...e, days: diffDays(D, e.date) } : null);

app.get('/api/today', ALL, wrap(async (req, res) => {
  const D = today();
  await ensureUpTo(D);
  const [nextExams, tasks, classes, devoirs, late, week, nextSpeDs, nextBac, L] = await Promise.all([
    all(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
      WHERE e.type IN ('ds','bac_blanc','bac','oral') AND e.date >= ? ORDER BY e.date LIMIT 3`, D),
    all(`${taskRow} WHERE t.date = ?`, D),
    all(`SELECT tt.*, s.name AS subject_name, s.short AS subject_short FROM timetable tt JOIN subjects s ON s.id = tt.subject_id
      WHERE tt.weekday = ? ORDER BY tt.start`, weekday(D)),
    all(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
      WHERE e.type = 'devoir' AND e.date > ? AND e.date <= ? ORDER BY e.date`, D, addDays(D, 7)),
    all(`${taskRow} WHERE t.done_at IS NULL AND t.date < ? AND t.date >= ? ORDER BY t.date DESC`, D, addDays(D, -14)),
    weekStats(weekStart(D)),
    // Indicateurs de l'accueil : prochain DS de spécialité, prochain bac blanc ou bac
    one(`SELECT e.*, s.name AS subject_name FROM events e JOIN subjects s ON s.id = e.subject_id
      WHERE e.type = 'ds' AND s.is_spe = 1 AND e.date >= ? ORDER BY e.date LIMIT 1`, D),
    one(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
      WHERE e.type IN ('bac_blanc','bac') AND e.date >= ? ORDER BY e.date LIMIT 1`, D),
    limits(),
  ]);
  const wd = withDays(D);
  res.json({ date: D, nextExams: nextExams.map(wd), nextSpeDs: wd(nextSpeDs), nextBac: wd(nextBac), tasks: sortTasks(tasks), classes, devoirs: devoirs.map(wd), late, week, limits: L });
}));

app.post('/api/tasks', ALL, wrap(async (req, res) => {
  const title = str(req.body.title, 140); if (!title) throw fail(400, 'Titre requis');
  const date = isDate(req.body.date) ? req.body.date : today();
  const kind = ['revision_cours', 'bac_francais', 'refaire_ds', 'exercice', 'devoir', 'ds', 'autre'].includes(req.body.kind) ? req.body.kind : 'autre';
  const subject = req.body.subject_id ? Number(req.body.subject_id) : null;
  // Les tâches ajoutées par les parents sont marquées pour que l'élève le voie
  const source = req.user.role === 'parent' ? 'parent' : 'manuel';
  const id = await insert(`INSERT INTO tasks(date, original_date, title, subject_id, kind, source, time, duration) VALUES (?,?,?,?,?,?,?,?)`,
    date, date, title, subject, kind, source, isTime(req.body.time) ? req.body.time : null, defaultDuration(kind));
  res.json(await getTask(id));
}));
app.patch('/api/tasks/:id', ALL, wrap(async (req, res) => {
  const t = await one('SELECT * FROM tasks WHERE id = ?', int(req.params.id)); if (!t) throw fail(404, 'Tâche introuvable');
  // Les parents peuvent placer les tâches dans l'agenda, mais seul l'élève les coche
  if (req.user.role === 'parent' && ('done' in req.body || req.body.title)) throw fail(403, "Seul l'élève peut cocher ses tâches.");
  if ('time' in req.body) {
    if (req.body.time !== null && !isTime(req.body.time)) throw fail(400, 'Heure invalide');
    await run('UPDATE tasks SET time = ? WHERE id = ?', req.body.time, t.id);
  }
  if (req.body.duration != null) {
    const d = Number(req.body.duration);
    if (!(d >= 15 && d <= 240)) throw fail(400, 'Durée invalide (15 à 240 minutes)');
    await run('UPDATE tasks SET duration = ? WHERE id = ?', Math.round(d / 15) * 15, t.id);
  }
  if ('done' in req.body) await run('UPDATE tasks SET done_at = ? WHERE id = ?', req.body.done ? nowIso() : null, t.id);
  if (req.body.title) await run('UPDATE tasks SET title = ? WHERE id = ?', str(req.body.title, 140), t.id);
  if (isDate(req.body.date)) await run('UPDATE tasks SET date = ? WHERE id = ?', req.body.date, t.id);
  res.json(await getTask(t.id));
}));
app.delete('/api/tasks/:id', ALL, wrap(async (req, res) => {
  const t = await one('SELECT source, photo FROM tasks WHERE id = ?', int(req.params.id));
  if (!t) throw fail(404, 'Tâche introuvable');
  // Les parents ne suppriment que les tâches qu'ils ont ajoutées
  if (req.user.role === 'parent' && t.source !== 'parent') throw fail(403, 'Seules les tâches ajoutées par les parents peuvent être supprimées ici.');
  await run('DELETE FROM tasks WHERE id = ?', int(req.params.id));
  if (t.photo) deletePhoto(t.photo).catch(() => {});
  res.json({ ok: true });
}));
app.post('/api/tasks/:id/photo', STUDENT, upload.single('photo'), wrap(async (req, res) => {
  const t = await one('SELECT * FROM tasks WHERE id = ?', int(req.params.id)); if (!t) throw fail(404, 'Tâche introuvable');
  if (!req.file) throw fail(400, 'Photo manquante (formats image uniquement).');
  const name = await savePhoto(req.file.buffer, req.file.mimetype);
  if (t.photo) deletePhoto(t.photo).catch(() => {});
  await run('UPDATE tasks SET photo = ?, done_at = COALESCE(done_at, ?) WHERE id = ?', name, nowIso(), t.id);
  res.json(await getTask(t.id));
}));
app.get('/uploads/:file', ALL, wrap(async (req, res) => {
  const p = await readPhoto(req.params.file);
  if (!p) return res.status(404).end();
  res.set('Content-Type', p.mime).set('Cache-Control', 'private, max-age=86400').send(p.buffer);
}));

// ---------- Agenda (semaine) ----------
app.get('/api/week', ALL, wrap(async (req, res) => {
  const ws = weekStart(isDate(req.query.start) ? req.query.start : today());
  if (ws <= today()) await ensureUpTo();
  const we = addDays(ws, 6);
  const [tt, events, tasks] = await Promise.all([
    all(`SELECT tt.*, s.name AS subject_name, s.short AS subject_short FROM timetable tt JOIN subjects s ON s.id = tt.subject_id ORDER BY tt.start`),
    all(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date`, ws, we),
    all(`${taskRow} WHERE t.date BETWEEN ? AND ?`, ws, we),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i);
    return { date, classes: tt.filter((c) => c.weekday === i + 1), events: events.filter((e) => e.date === date), tasks: sortTasks(tasks.filter((t) => t.date === date)) };
  });
  res.json({ week_start: ws, today: today(), days });
}));

// ---------- Événements : DS, bacs blancs, devoirs ----------
const EVENT_TYPES = ['ds', 'bac_blanc', 'bac', 'devoir', 'oral', 'autre'];
app.get('/api/events', ALL, wrap(async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : addDays(today(), -30);
  res.json(await all(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id WHERE e.date >= ? ORDER BY e.date`, from));
}));
const eventFields = (b) => {
  if (!EVENT_TYPES.includes(b.type)) throw fail(400, "Type d'événement invalide");
  if (!isDate(b.date)) throw fail(400, 'Date invalide');
  const title = str(b.title, 120); if (!title) throw fail(400, 'Titre requis');
  return [b.type, title, b.subject_id ? Number(b.subject_id) : null, b.date, str(b.notes, 500)];
};
app.post('/api/events', ALL, wrap(async (req, res) => res.json({ id: await insert('INSERT INTO events(type,title,subject_id,date,notes) VALUES (?,?,?,?,?)', ...eventFields(req.body)) })));
app.patch('/api/events/:id', ALL, wrap(async (req, res) => {
  await run('UPDATE events SET type=?, title=?, subject_id=?, date=?, notes=? WHERE id=?', ...eventFields(req.body), int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/events/:id', ALL, wrap(async (req, res) => { await run('DELETE FROM events WHERE id = ?', int(req.params.id)); res.json({ ok: true }); }));

// ---------- Rendu de la semaine ----------
async function weekReport(ws) {
  const we = addDays(ws, 6);
  const [tasks, report, days, quiz, stats] = await Promise.all([
    all(`${taskRow} WHERE t.original_date BETWEEN ? AND ? ORDER BY t.original_date, t.id`, ws, we),
    one(`SELECT r.*, u.display_name AS seen_by_name FROM weekly_reports r LEFT JOIN users u ON u.id = r.seen_by WHERE week_start = ?`, ws),
    all('SELECT date, submitted_at FROM daily_reports WHERE date BETWEEN ? AND ? ORDER BY date', ws, we),
    weeklyQuizSummary(ws),
    weekStats(ws),
  ]);
  return { week_start: ws, today: today(), stats, report: report || null, tasks, dayReports: days,
    quiz: quiz ? { ...quiz, required: true } : { required: await weeklyQuizPossible(ws), passed_at: null } };
}

// ---------- Quiz de la semaine (obligatoire pour le rendu) ----------
const wsOf = (v) => weekStart(isDate(v) ? v : today());
app.get('/api/weekly-quiz', ALL, wrap(async (req, res) => res.json(await publicQuiz(wsOf(req.query.week)))));
app.post('/api/weekly-quiz/generate', STUDENT, wrap(async (req, res) => res.json(await generateWeeklyQuiz(wsOf(req.body.week), { force: !!req.body.force }))));
app.post('/api/weekly-quiz/answer', STUDENT, wrap(async (req, res) => res.json(await answerQuestion(wsOf(req.body.week), Number(req.body.i), req.body.choice))));
app.post('/api/weekly-quiz/finish', STUDENT, wrap(async (req, res) => res.json(await finishAttempt(wsOf(req.body.week)))));

// ---------- Rendu du jour ----------
async function dayReport(D) {
  const [tasks, report] = await Promise.all([all(`${taskRow} WHERE t.date = ?`, D), one('SELECT * FROM daily_reports WHERE date = ?', D)]);
  return { date: D, today: today(), tasks: sortTasks(tasks), report: report || null };
}
app.get('/api/day-report', ALL, wrap(async (req, res) => {
  const D = isDate(req.query.date) ? req.query.date : today();
  if (D <= today()) await ensureUpTo();
  res.json(await dayReport(D));
}));
app.post('/api/day-report/submit', STUDENT, wrap(async (req, res) => {
  const D = isDate(req.body.date) ? req.body.date : today();
  if (D > today()) throw fail(400, 'On ne peut pas valider une journée à venir.');
  await run(`INSERT INTO daily_reports(date, submitted_at, comment) VALUES (?,?,?)
    ON CONFLICT(date) DO UPDATE SET submitted_at = excluded.submitted_at, comment = excluded.comment`, D, nowIso(), str(req.body.comment, 500));
  res.json(await dayReport(D));
}));
app.get('/api/report', ALL, wrap(async (req, res) => res.json(await weekReport(wsOf(req.query.week)))));
app.post('/api/report/submit', STUDENT, wrap(async (req, res) => {
  const ws = wsOf(req.body.week);
  // Le rendu de la semaine ne part qu'après avoir réussi le quiz de la semaine
  // (sauf s'il n'y a vraiment rien pour le construire : aucune tâche cochée ni quiz)
  if (!(await weeklyQuizPassed(ws)) && ((await weeklyQuizSummary(ws)) || (await weeklyQuizPossible(ws)))) {
    throw fail(400, `Réussis d'abord le quiz de la semaine (${(await limits()).weeklyQuizPass} % de bonnes réponses) pour envoyer ton rendu.`);
  }
  await run(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment) VALUES (?,?,?)
    ON CONFLICT(week_start) DO UPDATE SET submitted_at = excluded.submitted_at, student_comment = excluded.student_comment,
      status = CASE WHEN weekly_reports.status = 'a_revoir' THEN NULL ELSE weekly_reports.status END`, ws, nowIso(), str(req.body.comment, 1000));
  res.json(await weekReport(ws));
}));
// Les parents valident le rendu de la semaine, ou le renvoient « à revoir » avec un commentaire
app.post('/api/report/seen', PARENT, wrap(async (req, res) => {
  const ws = wsOf(req.body.week);
  const status = req.body.status === 'a_revoir' ? 'a_revoir' : 'validee';
  if (status === 'a_revoir' && !str(req.body.comment)) throw fail(400, 'Ajoute un commentaire pour dire ce qu’il faut revoir.');
  if (!(await one('SELECT submitted_at FROM weekly_reports WHERE week_start = ?', ws))?.submitted_at) throw fail(400, "Le rendu de cette semaine n'a pas encore été envoyé.");
  await run(`UPDATE weekly_reports SET seen_at = ?, seen_by = ?, parent_comment = ?, status = ? WHERE week_start = ?`, nowIso(), req.user.id, str(req.body.comment, 1000), status, ws);
  res.json(await weekReport(ws));
}));

// ---------- Bilan parents ----------
app.get('/api/overview', ALL, wrap(async (req, res) => {
  await ensureUpTo();
  const T = today(), cur = weekStart(T);
  const reports = Object.fromEntries((await all('SELECT week_start, submitted_at, seen_at, parent_comment, status FROM weekly_reports WHERE week_start >= ?', addDays(cur, -77))).map((r) => [r.week_start, r]));
  const stats = await Promise.all(Array.from({ length: 12 }, (_, i) => weekStats(addDays(cur, -7 * i))));
  const weeks = stats.map((s, i) => ({ s, r: reports[s.week_start], i }))
    .filter(({ s, r, i }) => !(s.total === 0 && !r && i > 0))
    .map(({ s, r }) => ({ ...s, submitted_at: r?.submitted_at ?? null, seen_at: r?.seen_at ?? null, parent_comment: r?.parent_comment ?? '', status: r?.status ?? null }));
  const [lateTasks, nextExams] = await Promise.all([
    all(`${taskRow} WHERE t.done_at IS NULL AND t.date < ? AND t.original_date >= ? ORDER BY t.date DESC LIMIT 30`, T, addDays(T, -14)),
    all(`SELECT e.*, s.name AS subject_name FROM events e LEFT JOIN subjects s ON s.id = e.subject_id
      WHERE e.date >= ? AND e.type <> 'autre' ORDER BY e.date LIMIT 6`, T),
  ]);
  res.json({ weeks, lateTasks, nextExams: nextExams.map(withDays(T)) });
}));

// ---------- Notes ----------
app.get('/api/grades', ALL, wrap(async (req, res) => res.json(await all(`SELECT g.*, s.name AS subject_name FROM grades g JOIN subjects s ON s.id = g.subject_id ORDER BY g.date, g.id`))));
app.post('/api/grades', ALL, wrap(async (req, res) => {
  const value = Number(req.body.value), out_of = Number(req.body.out_of || 20), coef = Number(req.body.coef || 1);
  if (!(out_of > 0) || !(value >= 0 && value <= out_of)) throw fail(400, 'Note invalide');
  if (!isDate(req.body.date)) throw fail(400, 'Date invalide');
  if (!(await one('SELECT 1 FROM subjects WHERE id = ?', Number(req.body.subject_id)))) throw fail(400, 'Matière inconnue');
  res.json({ id: await insert('INSERT INTO grades(subject_id,date,title,value,out_of,coef) VALUES (?,?,?,?,?,?)',
    Number(req.body.subject_id), req.body.date, str(req.body.title, 80) || 'DS', value, out_of, coef > 0 ? coef : 1) });
}));
app.delete('/api/grades/:id', ALL, wrap(async (req, res) => { await run('DELETE FROM grades WHERE id = ?', int(req.params.id)); res.json({ ok: true }); }));

// ---------- Récompenses ----------
app.get('/api/rewards', ALL, wrap(async (req, res) => {
  const list = await all('SELECT * FROM rewards ORDER BY given_at IS NOT NULL, id');
  res.json(await Promise.all(list.map(async (r) => ({ ...r, params: JSON.parse(r.params), progress: await rewardProgress(r) }))));
}));
app.post('/api/rewards', PARENT, wrap(async (req, res) => {
  const rule = req.body.rule; if (!['semaines', 'note', 'manuel'].includes(rule)) throw fail(400, 'Règle invalide');
  const title = str(req.body.title, 100); if (!title) throw fail(400, 'Titre requis');
  const p = req.body.params || {};
  let params = {};
  if (rule === 'semaines') params = { pct: Math.min(100, Math.max(10, Number(p.pct) || 80)), weeks: Math.min(20, Math.max(1, Number(p.weeks) || 3)) };
  if (rule === 'note') {
    if (!(await one('SELECT 1 FROM subjects WHERE id = ?', Number(p.subject_id)))) throw fail(400, 'Choisis une matière');
    params = { subject_id: Number(p.subject_id), points: Math.max(0.5, Number(p.points) || 2), last: 2 };
  }
  res.json({ id: await insert('INSERT INTO rewards(title, prize, rule, params, created_at) VALUES (?,?,?,?,?)', title, str(req.body.prize, 120), rule, JSON.stringify(params), today()) });
}));
app.post('/api/rewards/:id/given', PARENT, wrap(async (req, res) => {
  await run('UPDATE rewards SET given_at = ? WHERE id = ?', req.body.given === false ? null : today(), int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/rewards/:id', PARENT, wrap(async (req, res) => { await run('DELETE FROM rewards WHERE id = ?', int(req.params.id)); res.json({ ok: true }); }));

// ---------- Quiz (Gemini) ----------
app.get('/api/quizzes', ALL, wrap(async (req, res) => {
  const list = await all(`SELECT q.id, q.chapter, q.created_at, q.best_score, q.attempts, q.subject_id, q.questions, s.name AS subject_name
    FROM quizzes q LEFT JOIN subjects s ON s.id = q.subject_id ORDER BY q.id DESC`);
  res.json(list.map(({ questions, ...q }) => ({ ...q, count: JSON.parse(questions).length })));
}));
app.get('/api/quizzes/:id', ALL, wrap(async (req, res) => {
  const q = await one(`SELECT q.*, s.name AS subject_name FROM quizzes q LEFT JOIN subjects s ON s.id = q.subject_id WHERE q.id = ?`, int(req.params.id));
  if (!q) throw fail(404, 'Quiz introuvable');
  res.json({ ...q, questions: JSON.parse(q.questions) });
}));
app.post('/api/quizzes', STUDENT, memUpload.array('photos', 4), wrap(async (req, res) => {
  if (!geminiEnabled()) throw fail(503, 'Le quiz est désactivé : ajoute une clé GEMINI_API_KEY.');
  const files = (req.files || []).filter((f) => /^image\//.test(f.mimetype));
  if (!files.length) throw fail(400, 'Ajoute au moins une photo de cours.');
  const subj = await one('SELECT * FROM subjects WHERE id = ?', Number(req.body.subject_id));
  const chapter = str(req.body.chapter, 80) || 'Chapitre';
  const out = await quizFromImages(files.map((f) => ({ mime: f.mimetype, buffer: f.buffer })), { subject: subj?.name, chapter, count: Number(req.body.count) || 8 });
  res.json({ id: await insert('INSERT INTO quizzes(subject_id, chapter, questions) VALUES (?,?,?)', subj?.id ?? null, chapter, JSON.stringify(out.questions)) });
}));
app.post('/api/quizzes/:id/score', STUDENT, wrap(async (req, res) => {
  const score = Math.max(0, Math.round(Number(req.body.score) || 0));
  await run('UPDATE quizzes SET attempts = attempts + 1, best_score = GREATEST(COALESCE(best_score, 0), ?) WHERE id = ?', score, int(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/quizzes/:id', STUDENT, wrap(async (req, res) => { await run('DELETE FROM quizzes WHERE id = ?', int(req.params.id)); res.json({ ok: true }); }));

// ---------- Comptes (admin) ----------
app.get('/api/users', ADMIN, wrap(async (req, res) => res.json(await all('SELECT id, username, display_name, role FROM users ORDER BY role, id'))));
app.post('/api/users', ADMIN, wrap(async (req, res) => {
  const username = str(req.body.username, 30).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw fail(400, 'Identifiant : 3 à 30 caractères (lettres, chiffres, . _ -).');
  if (!['eleve', 'parent', 'admin'].includes(req.body.role)) throw fail(400, 'Rôle invalide');
  if (String(req.body.password ?? '').length < 6) throw fail(400, 'Mot de passe : 6 caractères minimum.');
  if (await one('SELECT 1 FROM users WHERE username = ?', username)) throw fail(400, 'Cet identifiant existe déjà.');
  await run('INSERT INTO users(username, display_name, role, password_hash) VALUES (?,?,?,?)',
    username, str(req.body.display_name, 40) || username, req.body.role, hashPassword(String(req.body.password)));
  res.json({ ok: true });
}));
app.patch('/api/users/:id', ADMIN, wrap(async (req, res) => {
  const id = int(req.params.id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw fail(400, 'Mot de passe : 6 caractères minimum.');
    await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(req.body.password)), id);
    await run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  if (req.body.display_name) await run('UPDATE users SET display_name = ? WHERE id = ?', str(req.body.display_name, 40), id);
  res.json({ ok: true });
}));
app.delete('/api/users/:id', ADMIN, wrap(async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) throw fail(400, 'Tu ne peux pas supprimer ton propre compte.');
  await run('DELETE FROM users WHERE id = ?', id);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// Gestion des erreurs (le message n'est montré que pour les erreurs prévues)
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500 && status !== 502 && status !== 503 && status !== 504) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Erreur du serveur.' : status === 413 ? 'Photo trop lourde.' : err.message });
}
