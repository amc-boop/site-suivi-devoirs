// Calcul de la progression des récompenses par paliers.
import { db } from './db.js';
import { today, weekStart, addDays, weekStats } from './planner.js';

function avg(grades) {
  if (!grades.length) return null;
  const tot = grades.reduce((s, g) => s + g.coef, 0);
  return grades.reduce((s, g) => s + (g.value / g.out_of) * 20 * g.coef, 0) / tot;
}

export function rewardProgress(r) {
  const p = JSON.parse(r.params || '{}');
  if (r.rule === 'semaines') {
    // Semaines terminées consécutives (la plus récente d'abord) au-dessus du seuil
    const pct = p.pct ?? 80, weeks = p.weeks ?? 3;
    let ws = addDays(weekStart(today()), -7), streak = 0;
    for (let i = 0; i < 52; i++, ws = addDays(ws, -7)) {
      const s = weekStats(ws);
      if (s.total === 0 || s.pct < pct) break;
      streak++;
    }
    // La semaine en cours compte si elle est déjà au-dessus du seuil
    const cur = weekStats(weekStart(today()));
    const curOk = cur.total > 0 && cur.pct >= pct;
    return {
      current: streak, target: weeks, reached: streak >= weeks,
      label: `${Math.min(streak, weeks)} / ${weeks} semaines à ${pct} % ou plus`,
      hint: curOk ? 'Cette semaine est bien partie.' : `Cette semaine : ${cur.pct ?? 0} %`,
    };
  }
  if (r.rule === 'note') {
    const gain = p.points ?? 2, n = p.last ?? 2;
    const all = db.prepare('SELECT * FROM grades WHERE subject_id = ? ORDER BY date').all(p.subject_id);
    const before = all.filter((g) => g.date < r.created_at);
    const after = all.filter((g) => g.date >= r.created_at);
    const base = p.baseline ?? avg(before);
    const recent = avg(after.slice(-n));
    const diff = base != null && recent != null ? recent - base : null;
    const subj = db.prepare('SELECT name FROM subjects WHERE id = ?').get(p.subject_id);
    return {
      current: diff == null ? 0 : Math.round(diff * 10) / 10, target: gain,
      reached: diff != null && diff >= gain,
      label: `+${gain} points en ${subj?.name ?? '?'} (départ : ${base == null ? '—' : base.toFixed(1)})`,
      hint: recent == null ? 'Pas encore de nouvelle note.' : `Moyenne des ${Math.min(n, after.length)} dernières notes : ${recent.toFixed(1)}`,
    };
  }
  return { current: r.given_at ? 1 : 0, target: 1, reached: Boolean(r.given_at), label: 'Décidée par les parents', hint: '' };
}
