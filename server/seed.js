// Création des comptes, des matières, de l'emploi du temps d'exemple et des données de démonstration.
//   npm run db:reset   -> base locale : repart de zéro AVEC 3 semaines de données d'exemple
//   npm run db:vide    -> base locale : repart de zéro sans historique
//   npm run db:init    -> base en ligne (Supabase) : crée tables + comptes avec des mots de passe aléatoires,
//                         écrits dans identifiants.txt (jamais envoyé sur GitHub). Refuse d'écraser une base déjà remplie.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, randomPassword } from './auth.js';
import { all, one, run, insert, tx, ensureSchema, TABLES, usingSupabaseDb } from './db.js';

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

export async function seed({ demo, accounts = DEFAULT_ACCOUNTS }) {
  await ensureSchema();
  const T0 = Date.now();
  await tx(async () => {
    await run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    for (const a of accounts) await run('INSERT INTO users(username, display_name, role, password_hash) VALUES (?,?,?,?)', a.username, a.display_name, a.role, hashPassword(a.password));
    for (const [i, [name, short, spe, rev]] of SUBJECTS.entries()) await run('INSERT INTO subjects(name, short, is_spe, review_daily, position) VALUES (?,?,?,?,?)', name, short, spe, rev, i);
    const sid = Object.fromEntries((await all('SELECT id, short FROM subjects')).map((s) => [s.short, s.id]));
    for (const [wd, st, e, subj, room] of TIMETABLE) await run('INSERT INTO timetable(weekday, start, "end", subject_id, room) VALUES (?,?,?,?,?)', wd, st, e, sid[subj], room);
  });
  if (!demo) return console.log(`Base prête (sans données d'exemple) en ${Date.now() - T0} ms.`);

  const { today, addDays, weekStart, generateDay, diffDays } = await import('./planner.js');
  const sid = Object.fromEntries((await all('SELECT id, short FROM subjects')).map((s) => [s.short, s.id]));
  const parentId = (await one("SELECT id FROM users WHERE role = 'parent' ORDER BY id LIMIT 1"))?.id ?? null;
  const T = today();
  const ev = (type, title, subj, d, notes = '') => run('INSERT INTO events(type,title,subject_id,date,notes) VALUES (?,?,?,?,?)', type, title, subj ? sid[subj] : null, addDays(T, d), notes);
  // Événements passés (pour l'historique) et à venir
  await ev('ds', 'DS de maths : second degré', 'MATH', -23);
  await ev('ds', 'DS de SES : marchés', 'SES', -16);
  await ev('ds', 'DS de physique : mouvement', 'PC', -9);
  await ev('devoir', 'Exercices 34 à 37 p. 112', 'PC', 3);
  await ev('devoir', 'DM de maths n°3 : dérivation', 'MATH', 5);
  await ev('ds', 'DS de maths : dérivation', 'MATH', 6, 'Chapitres 3 et 4, calculatrice autorisée');
  await ev('devoir', 'Commentaire de texte (rédaction)', 'FR', 8);
  await ev('ds', 'DS de SES : monnaie et financement', 'SES', 11);
  await ev('ds', 'DS de physique : énergie', 'PC', 18);
  await ev('bac_blanc', 'Bac blanc de français (écrit)', 'FR', 53, '4 heures, commentaire ou dissertation');
  await ev('bac', 'Bac de français (écrit)', 'FR', 209, 'Date indicative, à corriger quand elle sera officielle');

  // 3 semaines d'historique avec des taux de réussite différents
  const rate = (d) => { const w = Math.floor(diffDays(addDays(weekStart(T), -21), d) / 7); return [0.62, 0.92, 0.86, 0.7][w] ?? 0.6; };
  let n = 0;
  for (let d = addDays(weekStart(T), -21); d < T; d = addDays(d, 1)) {
    await generateDay(d);
    for (const t of await all('SELECT id FROM tasks WHERE date = ? AND original_date = ? AND done_at IS NULL ORDER BY id', d, d)) {
      n++;
      if ((n * 37) % 100 < rate(d) * 100) await run('UPDATE tasks SET done_at = ? WHERE id = ?', `${d}T19:30:00.000Z`, t.id);
    }
  }
  const ws = weekStart(T);
  await run(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment, seen_at, seen_by, parent_comment, status) VALUES (?,?,?,?,?,?, 'validee')`,
    addDays(ws, -21), `${addDays(ws, -16)}T20:00:00.000Z`, 'DS de maths refait en entier.', `${addDays(ws, -15)}T10:00:00.000Z`, parentId, 'Très bien, continue comme ça.');
  await run(`INSERT INTO weekly_reports(week_start, submitted_at, student_comment, seen_at, seen_by, parent_comment, status) VALUES (?,?,?,?,?,?, 'validee')`,
    addDays(ws, -14), `${addDays(ws, -9)}T20:00:00.000Z`, '', `${addDays(ws, -8)}T11:00:00.000Z`, parentId, 'Super semaine !');
  await run('INSERT INTO weekly_reports(week_start, submitted_at, student_comment) VALUES (?,?,?)',
    addDays(ws, -7), `${addDays(ws, -2)}T21:00:00.000Z`, 'Semaine chargée avec le DS de physique.');

  // Rendus du jour : la plupart des soirs des 3 dernières semaines
  for (let d = addDays(ws, -21); d < T; d = addDays(d, 1)) {
    if (diffDays(addDays(ws, -21), d) % 5 !== 3) await run('INSERT INTO daily_reports(date, submitted_at) VALUES (?,?)', d, `${d}T20:30:00.000Z`);
  }
  const g = (subj, d, title, v, coef = 1) => run('INSERT INTO grades(subject_id,date,title,value,out_of,coef) VALUES (?,?,?,?,20,?)', sid[subj], addDays(T, d), title, v, coef);
  await g('MATH', -60, 'DS 1 : fonctions', 9.5); await g('MATH', -40, 'DS 2 : suites', 11); await g('MATH', -23, 'DS 3 : second degré', 10.5);
  await g('SES', -55, 'DS 1 : la science économique', 12); await g('SES', -16, 'DS 2 : marchés', 13.5);
  await g('PC', -50, 'DS 1 : constitution de la matière', 8); await g('PC', -9, 'DS 2 : mouvement', 10);
  await g('FR', -45, 'Commentaire 1', 11); await g('FR', -20, 'Dissertation 1', 12);

  const rw = (title, prize, rule, params, created) => run('INSERT INTO rewards(title, prize, rule, params, created_at) VALUES (?,?,?,?,?)', title, prize, rule, JSON.stringify(params), created);
  await rw('3 semaines à 80 %', 'Sortie ciné', 'semaines', { pct: 80, weeks: 3 }, addDays(T, -30));
  await rw('+2 points en maths', 'Le jeu de son choix', 'note', { subject_id: sid.MATH, points: 2, last: 2 }, addDays(T, -30));
  await rw('Bac blanc de français préparé', 'Resto en famille', 'manuel', {}, addDays(T, -5));

  await generateDay(T);
  // Quelques tâches déjà placées dans l'agenda pour la démo (les autres restent « à placer »)
  const todays = await all('SELECT id FROM tasks WHERE date = ? ORDER BY id', T);
  for (const [i, h] of ['17:30', '18:30'].entries()) if (todays[i]) await run('UPDATE tasks SET time = ? WHERE id = ?', h, todays[i].id);
  console.log(`Base prête avec données d'exemple en ${Date.now() - T0} ms.`);
}

// En local uniquement : une base vide est remplie automatiquement avec la démo
export async function seedIfEmpty() {
  if (usingSupabaseDb) return;
  await ensureSchema();
  if (!(await one('SELECT COUNT(*)::int AS n FROM users')).n) await seed({ demo: true });
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  await ensureSchema();
  if (args.includes('--init')) {
    // Mise en ligne : comptes avec mots de passe aléatoires, sans données d'exemple
    const existing = (await one('SELECT COUNT(*)::int AS n FROM users')).n;
    if (existing && !args.includes('--ecraser')) {
      console.error(`La base contient déjà ${existing} compte(s) : rien n'a été modifié. (Ajoute --ecraser pour tout effacer et recommencer.)`);
      process.exit(1);
    }
    const accounts = DEFAULT_ACCOUNTS.map((a) => ({ ...a, password: randomPassword() }));
    await seed({ demo: false, accounts });
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'identifiants.txt');
    fs.writeFileSync(file, `Identifiants du site de suivi (créés le ${new Date().toLocaleString('fr-FR')})\n\n${accounts.map((a) => `${a.display_name} (${a.role}) : identifiant « ${a.username} », mot de passe « ${a.password} »`).join('\n')}\n\nChaque personne peut changer son mot de passe depuis l'icône de profil.\n`, { mode: 0o600 });
    console.log(`Comptes créés. Identifiants enregistrés dans ${file}`);
  } else {
    if (usingSupabaseDb && !args.includes('--ecraser')) {
      console.error('DATABASE_URL pointe vers la base en ligne : db:reset / db:vide refusent de l’effacer. Utilise db:init, ou ajoute --ecraser si tu es sûr.');
      process.exit(1);
    }
    await seed({ demo: !args.includes('--vide') });
  }
  process.exit(0);
}
