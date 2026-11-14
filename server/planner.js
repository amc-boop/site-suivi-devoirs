// Génération automatique des tâches du jour à partir de l'emploi du temps,
// des DS / bacs blancs à venir et des devoirs, avec report limité des tâches non faites.
import { db, getSetting, tx } from './db.js';

// ---------- Dates (heure locale, format AAAA-MM-JJ) ----------
const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const today = () => fmt(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
export const weekday = (s) => { const w = parse(s).getDay(); return w === 0 ? 7 : w; }; // 1 = lundi
export const weekStart = (s) => addDays(s, 1 - weekday(s));
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const limits = () => ({
  maxPerDay: getSetting('maxPerDay', 5),
  maxCarry: getSetting('maxCarry', 2),
  dsWindow: getSetting('dsWindow', 6),
  bacBlancWindow: getSetting('bacBlancWindow', 12),
});

// Priorité pour l'ordre d'affichage et le remplissage
const PRIORITY = { devoir: 0, ds: 1, refaire_ds: 2, bac_francais: 3, exercice: 4, revision_cours: 5, autre: 6 };
export const priority = (kind) => PRIORITY[kind] ?? 6;

const subjectsById = () => Object.fromEntries(db.prepare('SELECT * FROM subjects').all().map((s) => [s.id, s]));

const insertTask = db.prepare(`INSERT OR IGNORE INTO tasks
  (date, original_date, title, subject_id, kind, source, event_id, auto_key)
  VALUES (?, ?, ?, ?, ?, 'auto', ?, ?)`);

function countOn(date) {
  return db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE date = ?').get(date).n;
}

export function generateDay(D) {
  if (db.prepare('SELECT 1 FROM generated_days WHERE date = ?').get(D)) return;
  const L = limits();
  const subjects = subjectsById();

  tx(() => {
    // 1. Report des tâches non faites (au plus maxCarry fois, et pas plus vieilles que 7 jours)
    const late = db.prepare(`SELECT * FROM tasks WHERE done_at IS NULL AND date < ? AND date >= ? AND carried < ?`)
      .all(D, addDays(D, -7), L.maxCarry)
      .sort((a, b) => priority(a.kind) - priority(b.kind) || a.date.localeCompare(b.date));
    let free = L.maxPerDay - countOn(D);
    for (const t of late) {
      // Un devoir dont la date de rendu est passée ne se reporte plus
      if (t.event_id) {
        const ev = db.prepare('SELECT date FROM events WHERE id = ?').get(t.event_id);
        if (ev && ev.date <= D) continue;
      }
      if (free <= 0 && t.kind !== 'devoir') continue;
      db.prepare('UPDATE tasks SET date = ?, carried = carried + 1 WHERE id = ?').run(D, t.id);
      free--;
    }

    // 2. Devoirs à rendre dans les 2 jours : toujours ajoutés
    for (const ev of db.prepare(`SELECT * FROM events WHERE type = 'devoir' AND date > ? AND date <= ?`).all(D, addDays(D, 2))) {
      insertTask.run(D, D, `Finir : ${ev.title}`, ev.subject_id, 'devoir', ev.id, `devoir-${ev.id}`);
    }

    const candidates = [];
    // 3. Révisions avant DS / bac blanc
    for (const ev of db.prepare(`SELECT * FROM events WHERE type IN ('ds','bac_blanc','oral') AND date > ? AND date <= ?`)
      .all(D, addDays(D, L.bacBlancWindow))) {
      const j = diffDays(D, ev.date);
      if (ev.type !== 'bac_blanc' && j > L.dsWindow) continue;
      const label = j === 1 ? 'demain' : `J-${j}`;
      candidates.push({ title: `Réviser pour ${ev.title} (${label})`, subject: ev.subject_id, kind: 'ds', event: ev.id, key: `prep-${ev.id}-${D}` });
    }

    // 4. Revoir le cours des matières qu'il a eues aujourd'hui
    const wd = weekday(D);
    const todays = db.prepare(`SELECT DISTINCT subject_id FROM timetable WHERE weekday = ?`).all(wd)
      .map((r) => subjects[r.subject_id]).filter((s) => s && s.review_daily)
      .sort((a, b) => b.is_spe - a.is_spe || a.position - b.position);
    for (const s of todays) {
      candidates.push({ title: `Revoir le cours de ${s.name} d'aujourd'hui`, subject: s.id, kind: 'revision_cours', key: `rev-${s.id}-${D}` });
    }

    // 5. Week-end : bac de français + refaire un ancien DS (rotation entre spécialités)
    if (wd >= 6) {
      const fr = Object.values(subjects).find((s) => s.short === 'FR');
      if (fr) candidates.push({ title: 'Bac de français : relire et expliquer un texte de la liste', subject: fr.id, kind: 'bac_francais', key: `bacfr-${D}` });
      const spes = Object.values(subjects).filter((s) => s.is_spe).sort((a, b) => a.position - b.position);
      if (spes.length) {
        const s = spes[diffDays('2024-01-01', D) % spes.length];
        candidates.push({ title: `Refaire un DS de l'an dernier en ${s.name}`, subject: s.id, kind: 'refaire_ds', key: `refaire-${D}` });
      }
    }

    candidates.sort((a, b) => priority(a.kind) - priority(b.kind));
    for (const c of candidates) {
      if (countOn(D) >= L.maxPerDay) break;
      insertTask.run(D, D, c.title, c.subject ?? null, c.kind, c.event ?? null, c.key);
    }
    db.prepare('INSERT INTO generated_days(date) VALUES (?)').run(D);
  });
}

// Génère tous les jours manquants jusqu'à aujourd'hui (7 jours en arrière au maximum)
export function ensureUpTo(D = today()) {
  const last = db.prepare('SELECT MAX(date) AS d FROM generated_days').get().d;
  let start = last ? addDays(last, 1) : D;
  if (diffDays(start, D) > 7) start = addDays(D, -7);
  for (let d = start; d <= D; d = addDays(d, 1)) generateDay(d);
}

// Statistiques d'une semaine (lundi -> dimanche), sur la date d'origine des tâches
export function weekStats(ws) {
  const we = addDays(ws, 6);
  const rows = db.prepare(`SELECT done_at, date, photo FROM tasks WHERE original_date BETWEEN ? AND ?`).all(ws, we);
  const t = today();
  const total = rows.length;
  const done = rows.filter((r) => r.done_at).length;
  const late = rows.filter((r) => !r.done_at && r.date < t).length;
  const photos = rows.filter((r) => r.photo).length;
  return { week_start: ws, total, done, late, photos, pct: total ? Math.round((done / total) * 100) : null };
}
