// Partie « jeu » : série de jours avec rendu complet, points, niveaux et badges.
// Tout est recalculé à partir des données (rien à stocker, rien qui puisse se désynchroniser).
import { all } from './db.js';
import { today, addDays, weekday, weekStart } from './planner.js';

// Points
export const XP = { task: 10, dayReport: 20, weekendReport: 40, weekValidated: 100, quizPassed: 30, focus25: 5 };

// Niveaux : il faut un peu plus de points à chaque niveau (100, puis 150, 200…)
const TITLES = ['Débutant', 'Apprenti', 'Élève motivé', 'Bosseur', 'Samouraï des révisions', 'Ninja des DS', 'Maître des fiches', 'Champion du bac blanc', 'Sensei', 'Légende du bac'];
export function levelOf(xp) {
  let level = 1, floor = 0, need = 100;
  while (xp >= floor + need) { floor += need; level++; need += 50; }
  return { level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], floor, next: floor + need, into: xp - floor, need };
}

export async function computeProgress() {
  const T = today();
  const from = addDays(T, -400);
  const [counts, days, weekends, quizzes, quizzesOwn, focus] = await Promise.all([
    all('SELECT date, COUNT(*)::int AS total, COUNT(done_at)::int AS done FROM tasks WHERE date >= ? GROUP BY date', from),
    all(`SELECT date, missing FROM daily_reports WHERE date >= ?`, from),
    all(`SELECT week_start, submitted_at, status, missing FROM weekly_reports WHERE week_start >= ?`, addDays(from, -6)),
    all('SELECT week_start, best_score, questions, passed_at FROM weekly_quizzes'),
    all('SELECT best_score, questions FROM quizzes'),
    all('SELECT COALESCE(SUM(focus_seconds), 0)::int AS s FROM tasks'),
  ]);
  const taskOn = Object.fromEntries(counts.map((c) => [c.date, c]));
  const complete = (r) => r && JSON.parse(r.missing || '[]').length === 0;
  const dayRep = Object.fromEntries(days.map((d) => [d.date, d]));
  const weRep = Object.fromEntries(weekends.filter((w) => w.submitted_at).map((w) => [w.week_start, w]));

  // ---------- Série ----------
  // Un jour de semaine compte s'il a un rendu du jour complet ; le week-end compte pour 2 jours si son rendu est complet.
  // Les jours sans aucune tâche prévue ne cassent pas la série. Aujourd'hui (et le week-end en cours) ne la cassent pas
  // tant qu'ils ne sont pas terminés.
  const units = []; // du plus ancien au plus récent : { ok: true | false | null (neutre), n }
  const start = (() => { const first = counts.map((c) => c.date).sort()[0]; return first ? weekStart(first) : T; })();
  for (let d = start; d <= T; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (wd <= 5) {
      const has = (taskOn[d]?.total || 0) > 0;
      if (complete(dayRep[d])) units.push({ ok: true, n: 1 });
      else if (d === T || (!has && !dayRep[d])) units.push({ ok: null, n: 0 });
      else units.push({ ok: false, n: 0 });
    } else if (wd === 7) {
      const ws = weekStart(d), sat = addDays(d, -1);
      const has = (taskOn[sat]?.total || 0) + (taskOn[d]?.total || 0) > 0;
      if (complete(weRep[ws])) units.push({ ok: true, n: 2 });
      else if (d >= T || (!has && !weRep[ws])) units.push({ ok: null, n: 0 });
      else units.push({ ok: false, n: 0 });
    } else if (d === T) units.push({ ok: null, n: 0 }); // samedi en cours : rendu du week-end à venir
  }
  let streak = 0;
  for (let i = units.length - 1; i >= 0; i--) { if (units[i].ok === false) break; streak += units[i].n; }
  let best = 0, run = 0;
  for (const u of units) { if (u.ok === false) run = 0; else { run += u.n; best = Math.max(best, run); } }

  // ---------- Points ----------
  const tasksDone = counts.reduce((s, c) => s + c.done, 0);
  const dayReports = days.filter(complete).length;
  const weekendReports = Object.values(weRep).filter(complete).length;
  const weeksValidated = weekends.filter((w) => w.status === 'validee').length;
  const quizPassed = quizzes.filter((q) => q.passed_at).length;
  const focusHours = focus[0].s / 3600;
  const xp = tasksDone * XP.task + dayReports * XP.dayReport + weekendReports * XP.weekendReport
    + weeksValidated * XP.weekValidated + quizPassed * XP.quizPassed + Math.floor(focus[0].s / 1500) * XP.focus25;

  // ---------- Badges ----------
  const perfect = [...quizzes, ...quizzesOwn].some((q) => q.best_score != null && q.best_score >= JSON.parse(q.questions).length);
  const fullWeek = Object.keys(weRep).some((ws) => complete(weRep[ws]) && [0, 1, 2, 3, 4].every((i) => complete(dayRep[addDays(ws, i)])));
  const badges = [
    { id: 'semaine', label: 'Semaine validée', desc: 'Les parents ont validé ton rendu de la semaine', earned: weeksValidated > 0, count: weeksValidated },
    { id: 'serie3', label: 'En route', desc: '3 jours d’affilée avec un rendu complet', earned: best >= 3 },
    { id: 'serie7', label: 'Semaine de feu', desc: '7 jours d’affilée avec un rendu complet', earned: best >= 7 },
    { id: 'serie30', label: 'Inarrêtable', desc: '30 jours d’affilée avec un rendu complet', earned: best >= 30 },
    { id: 'semaine-parfaite', label: 'Semaine parfaite', desc: 'Tous les rendus du lundi au dimanche complets', earned: fullWeek },
    { id: 'quiz', label: 'Quiz de la semaine', desc: 'Réussir un quiz de la semaine', earned: quizPassed > 0, count: quizPassed },
    { id: 'parfait', label: 'Sans faute', desc: 'Un quiz réussi à 100 %', earned: perfect },
    { id: 'focus10', label: 'Concentré', desc: '10 heures en mode « No Work, No Porsche »', earned: focusHours >= 10 },
    { id: 'taches100', label: 'Centurion', desc: '100 tâches faites', earned: tasksDone >= 100 },
  ];
  return { streak, best, xp, ...levelOf(xp), tasksDone, weeksValidated, focusMinutes: Math.round(focus[0].s / 60), badges, points: XP };
}
