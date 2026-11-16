// Quiz de la semaine : à réussir pour pouvoir envoyer le rendu du week-end.
// Questions construites à partir de ce qu'il a travaillé : photos jointes aux tâches,
// questions des quiz créés dans la semaine, et liste des cours révisés.
import path from 'node:path';
import { all, one, run } from './db.js';
import { readPhoto, MIME } from './storage.js';
import { addDays, limits } from './planner.js';
import { geminiEnabled, quizFromImages } from './gemini.js';

const TOTAL = 10;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const row = async (ws) => one('SELECT * FROM weekly_quizzes WHERE week_start = ?', ws);

// Vue envoyée au navigateur : jamais les bonnes réponses avant que la question soit répondue
export async function publicQuiz(ws) {
  const q = await row(ws);
  const pass = (await limits()).weeklyQuizPass;
  if (!q) return { week_start: ws, exists: false, pass, canGenerate: await canBuild(ws) };
  const questions = JSON.parse(q.questions);
  const answers = JSON.parse(q.current_answers || '{}');
  return {
    week_start: ws, exists: true, pass, total: questions.length, sources: q.sources,
    attempts: q.attempts, best_score: q.best_score, last_score: q.last_score, passed_at: q.passed_at,
    questions: questions.map((x, i) => ({
      question: x.question, choix: x.choix, matiere: x.matiere || '',
      ...(i in answers ? { answered: answers[i], bonne: x.bonne, explication: x.explication } : {}),
    })),
  };
}

async function weekMaterial(ws) {
  const we = addDays(ws, 6);
  const tasks = await all(`SELECT t.*, s.name AS subject_name FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE t.original_date BETWEEN ? AND ? ORDER BY t.original_date`, ws, we);
  const done = tasks.filter((t) => t.done_at);
  // Photos jointes : au plus 4, en variant les matières
  const withPhoto = done.filter((t) => t.photo);
  const photos = []; const seen = new Set();
  for (const t of [...withPhoto.filter((t) => !seen.has(t.subject_id) && seen.add(t.subject_id)), ...withPhoto]) {
    if (photos.length >= 4) break;
    if (!photos.includes(t)) photos.push(t);
  }
  // Questions des quiz créés pendant la semaine
  const pool = (await all(`SELECT q.questions, s.name AS subject_name FROM quizzes q LEFT JOIN subjects s ON s.id = q.subject_id
    WHERE substr(q.created_at, 1, 10) BETWEEN ? AND ?`, ws, we))
    .flatMap((q) => JSON.parse(q.questions).map((x) => ({ ...x, matiere: q.subject_name || '' })));
  return { done, photos, pool };
}

async function canBuild(ws) {
  const m = await weekMaterial(ws);
  return m.pool.length >= 3 || (geminiEnabled() && m.done.length > 0);
}

export async function generateWeeklyQuiz(ws, { force = false } = {}) {
  const existing = await row(ws);
  if (existing && !force) return publicQuiz(ws);
  if (existing?.passed_at) throw err('Le quiz de cette semaine est déjà réussi.');
  const { done, photos, pool } = await weekMaterial(ws);
  if (!done.length && pool.length < 3) throw err("Aucune tâche cochée cette semaine : il n'y a rien sur quoi l'interroger.", 422);

  const fromPool = shuffle([...pool]).slice(0, Math.min(4, pool.length));
  let generated = [];
  const sources = [];
  if (fromPool.length) sources.push(`${fromPool.length} question${fromPool.length > 1 ? 's' : ''} de ses quiz de la semaine`);

  if (geminiEnabled() && done.length) {
    const need = TOTAL - fromPool.length;
    const list = [...new Set(done.map((t) => `- ${t.subject_name ? `${t.subject_name} : ` : ''}${t.title}`))].slice(0, 40).join('\n');
    // Chapitres en cours : titres des DS / bacs blancs proches et des quiz récents (les tâches seules sont souvent vagues)
    const chapters = [...new Set([
      ...(await all(`SELECT title FROM events WHERE type IN ('ds','bac_blanc','bac') AND date BETWEEN ? AND ?`, addDays(ws, -14), addDays(ws, 21))).map((e) => e.title),
      ...(await all(`SELECT q.chapter, s.name FROM quizzes q LEFT JOIN subjects s ON s.id = q.subject_id WHERE substr(q.created_at, 1, 10) >= ?`, addDays(ws, -21))).map((q) => `${q.name ? `${q.name} : ` : ''}${q.chapter}`),
    ])].slice(0, 15);
    const prompt = `Tu es professeur en classe de première générale en France (spécialités maths, SES, physique-chimie, et bac de français).
Cette semaine, l'élève a travaillé ceci :
${list}
${photos.length ? `Les ${photos.length} photo(s) jointe(s) montrent ce qu'il a fait (cours, exercices, DS refaits).` : ''}
${chapters.length ? `Chapitres en cours (priorité à ces notions) :\n${chapters.map((c) => `- ${c}`).join('\n')}\n` : ''}Priorité aux spécialités (maths, SES, physique-chimie) et au français.
Écris ${need} questions de vérification en français pour contrôler qu'il a vraiment révisé :
- ${photos.length ? "d'abord à partir du contenu des photos," : ''} puis sur les notions des cours listés, au niveau du programme de première ;
- couvre plusieurs matières, pas toutes sur la même ;
- questions précises (définition, formule, mécanisme, petite application), pas de culture générale ;
- 4 choix, une seule bonne réponse, une explication d'une ou deux phrases ;
- indique la matière de chaque question dans le champ « matiere ».`;
    const images = (await Promise.all(photos.map((t) => readPhoto(t.photo)))).filter(Boolean);
    try {
      const out = await quizFromImages(images, { count: need, prompt, allowEmptyImages: true, withSubject: true });
      generated = out.questions.slice(0, need);
      if (generated.length) sources.push(`${generated.length} questions générées à partir de ${photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} et ` : ''}${done.length} tâche${done.length > 1 ? 's' : ''} cochée${done.length > 1 ? 's' : ''}`);
    } catch (e) {
      if (fromPool.length < 3) throw e; // sans assez de questions de secours, on remonte l'erreur (quota, réseau…)
    }
  }
  const questions = shuffle([...fromPool, ...generated]).map((q) => ({
    question: q.question, choix: q.choix, bonne: q.bonne, explication: q.explication || '', matiere: q.matiere || '',
  }));
  if (questions.length < 3) throw err('Pas assez de matière pour construire le quiz. Ajoute des photos à tes tâches ou crée un quiz depuis un cours.', 422);

  await run(`INSERT INTO weekly_quizzes(week_start, questions, sources) VALUES (?,?,?)
    ON CONFLICT(week_start) DO UPDATE SET questions = excluded.questions, sources = excluded.sources, current_answers = '{}', created_at = to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')`, ws, JSON.stringify(questions), sources.join(' + '));
  return publicQuiz(ws);
}

// Répond à une question de l'essai en cours (une seule réponse par question et par essai)
export async function answerQuestion(ws, i, choice) {
  const q = await row(ws); if (!q) throw err("Le quiz n'existe pas encore.", 404);
  const questions = JSON.parse(q.questions);
  if (!(i >= 0 && i < questions.length)) throw err('Question inconnue');
  const answers = JSON.parse(q.current_answers || '{}');
  if (!(i in answers)) {
    answers[i] = Number(choice);
    await run('UPDATE weekly_quizzes SET current_answers = ? WHERE week_start = ?', JSON.stringify(answers), ws);
  }
  const x = questions[i];
  return { correct: answers[i] === x.bonne, answered: answers[i], bonne: x.bonne, explication: x.explication };
}

// Termine l'essai : score calculé côté serveur, réussite si score >= seuil
export async function finishAttempt(ws) {
  const q = await row(ws); if (!q) throw err("Le quiz n'existe pas encore.", 404);
  const questions = JSON.parse(q.questions);
  const answers = JSON.parse(q.current_answers || '{}');
  if (Object.keys(answers).length < questions.length) throw err('Réponds à toutes les questions avant de terminer.');
  const score = questions.reduce((s, x, i) => s + (answers[i] === x.bonne ? 1 : 0), 0);
  const pct = Math.round((score / questions.length) * 100);
  const pass = (await limits()).weeklyQuizPass;
  const passed = pct >= pass;
  await run(`UPDATE weekly_quizzes SET attempts = attempts + 1, last_score = ?, best_score = GREATEST(COALESCE(best_score, 0), ?),
    passed_at = COALESCE(passed_at, ?), current_answers = '{}' WHERE week_start = ?`, score, score, passed ? new Date().toISOString() : null, ws);
  // Après un échec, les choix et l'ordre des questions sont mélangés pour le prochain essai
  if (!passed) {
    const reshuffled = shuffle(questions.map((x) => {
      const order = shuffle(x.choix.map((_, k) => k));
      return { ...x, choix: order.map((k) => x.choix[k]), bonne: order.indexOf(x.bonne) };
    }));
    await run('UPDATE weekly_quizzes SET questions = ? WHERE week_start = ?', JSON.stringify(reshuffled), ws);
  }
  return { score, total: questions.length, pct, passed, pass };
}

export const weeklyQuizPassed = async (ws) => Boolean((await row(ws))?.passed_at);
export const weeklyQuizSummary = async (ws) => {
  const q = await row(ws);
  if (!q) return null;
  return { total: JSON.parse(q.questions).length, attempts: q.attempts, best_score: q.best_score, passed_at: q.passed_at, sources: q.sources };
};
export { canBuild as weeklyQuizPossible };
