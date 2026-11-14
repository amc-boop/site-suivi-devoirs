// Comptes par défaut, emploi du temps d'exemple et données de démonstration.
//   npm run db:reset  -> repart de zéro AVEC des données d'exemple (3 semaines d'historique)
//   npm run db:vide   -> repart de zéro avec seulement les comptes, les matières et l'emploi du temps d'exemple
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const DEFAULT_ACCOUNTS = [
  { username: 'alexandre', display_name: 'Alexandre', role: 'admin', password: 'admin123' },
  { username: 'martin', display_name: 'Martin', role: 'eleve', password: 'martin123' },
  { username: 'parents', display_name: 'Parents', role: 'parent', password: 'parents123' },
];

const SUBJECTS = [
  ['Maths', 'MATH', 1, 1], ['SES', 'SES', 1, 1], ['Physique-chimie', 'PC', 1, 1], ['Français', 'FR', 0, 1],
  ['Histoire-géo', 'HG', 0, 1], ['Anglais', 'ANG', 0, 1], ['Espagnol', 'ESP', 0, 0], ['Enseignement scientifique', 'ES', 0, 0],
  ['EMC', 'EMC', 0, 0], ['EPS', 'EPS', 0, 0],
];
// Emploi du temps d'exemple de 1ère générale (à remplacer dans l'éditeur)
const TIMETABLE = [
  [1, '08:00', '10:00', 'MATH', 'B12'], [1, '10:15', '12:15', 'FR', 'A04'], [1, '13:30', '15:30', 'SES', 'C21'], [1, '15:30', '16:30', 'ANG', 'A10'],
  [2, '08:00', '10:00', 'PC', 'Labo 2'], [2, '10:15', '12:15', 'HG', 'A07'], [2, '14:00', '16:00', 'EPS', 'Gymnase'],
  [3, '08:00', '09:00', 'ESP', 'A12'], [3, '09:00', '11:00', 'MATH', 'B12'], [3, '11:00', '12:00', 'FR', 'A04'],
  [4, '08:00', '10:00', 'SES', 'C21'], [4, '10:15', '12:15', 'ES', 'Labo 1'], [4, '13:30', '14:30', 'ANG', 'A10'], [4, '14:30', '16:30', 'PC', 'Labo 2'],
  [5, '08:00', '09:00', 'FR', 'A04'], [5, '09:00', '10:00', 'HG', 'A07'], [5, '10:15', '11:15', 'ESP', 'A12'], [5, '11:15', '12:15', 'EMC', 'A07'],
  [5, '13:30', '15:30', 'MATH', 'B12'],
];

export async function seed({ demo }) {
  const { db, tx, DB_PATH } = await import('./db.js');
  tx(() => {
    for (const t of ['quizzes', 'rewards', 'grades', 'daily_reports', 'weekly_reports', 'generated_days', 'tasks', 'events', 'timetable', 'subjects', 'sessions', 'users']) db.exec(`DELETE FROM ${t}`);
    for (const a of DEFAULT_ACCOUNTS) {
      db.prepare('INSERT INTO users(username, display_name, role, password_hash) VALUES (?,?,?,?)').run(a.username, a.display_name, a.role, hashPassword(a.password));
    }
    SUBJECTS.forEach(([name, short, spe, rev], i) => db.prepare('INSERT INTO subjects(name, short, is_spe, review_daily, position) VALUES (?,?,?,?,?)').run(name, short, spe, rev, i));
    const sid = Object.fromEntries(db.prepare('SELECT id, short FROM subjects').all().map((s) => [s.short, s.id]));
    for (const [wd, s, e, subj, room] of TIMETABLE) db.prepare('INSERT INTO timetable(weekday,start,end,subject_id,room) VALUES (?,?,?,?,?)').run(wd, s, e, sid[subj], room);
  });
  if (!demo) return console.log(`Base prête (sans données d'exemple) : ${DB_PATH}`);

  const { today, addDays, weekStart, generateDay, diffDays } = await import('./planner.js');
  const sid = Object.fromEntries(db.prepare('SELECT id, short FROM subjects').all().map((s) => [s.short, s.id]));
  const T = today();
  const ev = (type, title, subj, d, notes = '') => db.prepare('INSERT INTO events(type,title,subject_id,date,notes) VALUES (?,?,?,?,?)').run(type, title, subj ? sid[subj] : null, addDays(T, d), notes);
  // Événements passés (pour l'historique) et à venir
  ev('ds', 'DS de maths : second degré', 'MATH', -23);
  ev('ds', 'DS de SES : marchés', 'SES', -16);
  ev('ds', 'DS de physique : mouvement', 'PC', -9);
  ev('devoir', 'Exercices 34 à 37 p. 112', 'PC', 3);
  ev('devoir', 'DM de maths n°3 : dérivation', 'MATH', 5);
  ev('ds', 'DS de maths : dérivation', 'MATH', 6, 'Chapitres 3 et 4, calculatrice autorisée');
  ev('devoir', 'Commentaire de texte (rédaction)', 'FR', 8);
  ev('ds', 'DS de SES : monnaie et financement', 'SES', 11);
  ev('ds', 'DS de physique : énergie', 'PC', 18);
  ev('bac_blanc', 'Bac blanc de français (écrit)', 'FR', 53, '4 heures, commentaire ou dissertation');
  ev('bac', 'Bac de français (écrit)', 'FR', 209, 'Date indicative, à corriger quand elle sera officielle');

  // 3 semaines d'historique avec des taux de réussite différents
  const rate = (d) => { const w = Math.floor(diffDays(addDays(weekStart(T), -21), d) / 7); return [0.62, 0.92, 0.86, 0.7][w] ?? 0.6; };
  let n = 0;
  for (let d = addDays(weekStart(T), -21); d < T; d = addDays(d, 1)) {
    generateDay(d);
    for (const t of db.prepare('SELECT id FROM tasks WHERE date = ? AND original_date = ? AND done_at IS NULL').all(d, d)) {
      n++;
      if ((n * 37) % 100 < rate(d) * 100) db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(`${d}T19:30:00.000Z`, t.id);
    }
  }
  const ws = weekStart(T);
  db.prepare(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment, seen_at, seen_by, parent_comment, status) VALUES (?,?,?,?,?,?, 'validee')`)
    .run(addDays(ws, -21), `${addDays(ws, -16)}T20:00:00.000Z`, 'DS de maths refait en entier.', `${addDays(ws, -15)}T10:00:00.000Z`, 3, 'Très bien, continue comme ça.');
  db.prepare(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment, seen_at, seen_by, parent_comment, status) VALUES (?,?,?,?,?,?, 'validee')`)
    .run(addDays(ws, -14), `${addDays(ws, -9)}T20:00:00.000Z`, '', `${addDays(ws, -8)}T11:00:00.000Z`, 3, 'Super semaine !');
  db.prepare(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment) VALUES (?,?,?)`)
    .run(addDays(ws, -7), `${addDays(ws, -2)}T21:00:00.000Z`, 'Semaine chargée avec le DS de physique.');

  // Rendus du jour : la plupart des soirs des 3 dernières semaines
  for (let d = addDays(ws, -21); d < T; d = addDays(d, 1)) {
    if (diffDays(addDays(ws, -21), d) % 5 !== 3) db.prepare('INSERT INTO daily_reports(date, submitted_at) VALUES (?,?)').run(d, `${d}T20:30:00.000Z`);
  }
  const g = (subj, d, title, v, coef = 1) => db.prepare('INSERT INTO grades(subject_id,date,title,value,out_of,coef) VALUES (?,?,?,?,20,?)').run(sid[subj], addDays(T, d), title, v, coef);
  g('MATH', -60, 'DS 1 : fonctions', 9.5); g('MATH', -40, 'DS 2 : suites', 11); g('MATH', -23, 'DS 3 : second degré', 10.5);
  g('SES', -55, 'DS 1 : la science économique', 12); g('SES', -16, 'DS 2 : marchés', 13.5);
  g('PC', -50, 'DS 1 : constitution de la matière', 8); g('PC', -9, 'DS 2 : mouvement', 10);
  g('FR', -45, 'Commentaire 1', 11); g('FR', -20, 'Dissertation 1', 12);

  const rw = (title, prize, rule, params, created) => db.prepare('INSERT INTO rewards(title, prize, rule, params, created_at) VALUES (?,?,?,?,?)').run(title, prize, rule, JSON.stringify(params), created);
  rw('3 semaines à 80 %', 'Sortie ciné', 'semaines', { pct: 80, weeks: 3 }, addDays(T, -30));
  rw('+2 points en maths', 'Le jeu de son choix', 'note', { subject_id: sid.MATH, points: 2, last: 2 }, addDays(T, -30));
  rw('Bac blanc de français préparé', 'Resto en famille', 'manuel', {}, addDays(T, -5));

  generateDay(T);
  // Quelques tâches déjà placées dans l'agenda pour la démo (les autres restent « à placer »)
  const todays = db.prepare('SELECT id FROM tasks WHERE date = ? ORDER BY id').all(T);
  ['17:30', '18:30'].forEach((h, i) => todays[i] && db.prepare('UPDATE tasks SET time = ? WHERE id = ?').run(h, todays[i].id));
  console.log(`Base prête avec données d'exemple : ${DB_PATH}`);
}

export function seedIfEmpty() {
  // appelé au démarrage du serveur (db.js est déjà chargé à ce moment-là)
  import('./db.js').then(({ db }) => {
    if (!db.prepare('SELECT COUNT(*) AS n FROM users').get().n) seed({ demo: true });
  });
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const demo = !process.argv.includes('--vide');
  // Repartir d'un fichier propre
  const { DATA_DIR } = await import('./db.js');
  await seed({ demo });
}
