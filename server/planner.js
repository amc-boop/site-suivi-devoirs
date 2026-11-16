// Génération automatique des tâches du jour à partir de l'emploi du temps,
// des DS / bacs blancs à venir et des devoirs, avec report limité des tâches non faites.
import { all, one, run, getSetting, tx } from './db.js';

// ---------- Dates (heure de Paris, format AAAA-MM-JJ) ----------
// Les serveurs en ligne sont en UTC : « aujourd'hui » est toujours calculé à l'heure française.
const TZ = process.env.APP_TIMEZONE || 'Europe/Paris';
const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const today = () => parisDay.format(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
export const weekday = (s) => { const w = parse(s).getDay(); return w === 0 ? 7 : w; }; // 1 = lundi
export const weekStart = (s) => addDays(s, 1 - weekday(s));
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const limits = async () => ({
  maxPerDay: await getSetting('maxPerDay', 5),
  maxCarry: await getSetting('maxCarry', 2),
  dsWindow: await getSetting('dsWindow', 6),
  bacBlancWindow: await getSetting('bacBlancWindow', 12),
  weeklyQuizPass: await getSetting('weeklyQuizPass', 70),
});

// Priorité pour l'ordre d'affichage et le remplissage
const PRIORITY = { devoir: 0, ds: 1, refaire_ds: 2, bac_francais: 3, exercice: 4, revision_cours: 5, autre: 6 };
export const priority = (kind) => PRIORITY[kind] ?? 6;

const subjectsById = async () => Object.fromEntries((await all('SELECT * FROM subjects')).map((s) => [s.id, s]));

const insertTask = (...p) => run(`INSERT INTO tasks
  (date, original_date, title, subject_id, kind, source, event_id, auto_key, duration)
  VALUES (?1, ?2, ?3, ?4, ?5, 'auto', ?6, ?7, CASE WHEN ?5 IN ('ds','refaire_ds','devoir') THEN 60 ELSE 30 END)
  ON CONFLICT DO NOTHING`, ...p);

const countOn = async (date) => (await one('SELECT COUNT(*)::int AS n FROM tasks WHERE date = ?', date)).n;

export async function generateDay(D) {
  if (await one('SELECT 1 FROM generated_days WHERE date = ?', D)) return;
  const L = await limits();
  const subjects = await subjectsById();

  await tx(async () => {
    // Verrou : si un autre serveur a déjà préparé ce jour, on ne refait rien
    const claimed = await run('INSERT INTO generated_days(date) VALUES (?) ON CONFLICT DO NOTHING', D);
    if (!claimed.changes) return;

    // 1. Report des tâches non faites (au plus maxCarry fois, et pas plus vieilles que 7 jours)
    const late = (await all(`SELECT * FROM tasks WHERE done_at IS NULL AND date < ? AND date >= ? AND carried < ?`, D, addDays(D, -7), L.maxCarry))
      .sort((a, b) => priority(a.kind) - priority(b.kind) || a.date.localeCompare(b.date));
    let free = L.maxPerDay - await countOn(D);
    for (const t of late) {
      // Un devoir dont la date de rendu est passée ne se reporte plus
      if (t.event_id) {
        const ev = await one('SELECT date FROM events WHERE id = ?', t.event_id);
        if (ev && ev.date <= D) continue;
      }
      if (free <= 0 && t.kind !== 'devoir') continue;
      await run('UPDATE tasks SET date = ?, carried = carried + 1 WHERE id = ?', D, t.id);
      free--;
    }

    // 2. Devoirs à rendre dans les 2 jours : toujours ajoutés
    for (const ev of await all(`SELECT * FROM events WHERE type = 'devoir' AND date > ? AND date <= ?`, D, addDays(D, 2))) {
      await insertTask(D, D, `Finir : ${ev.title}`, ev.subject_id, 'devoir', ev.id, `devoir-${ev.id}`);
    }

    const candidates = [];
    // 3. Révisions avant DS / bac blanc
    for (const ev of await all(`SELECT * FROM events WHERE type IN ('ds','bac_blanc','bac','oral') AND date > ? AND date <= ?`, D, addDays(D, L.bacBlancWindow))) {
      const j = diffDays(D, ev.date);
      if (!['bac_blanc', 'bac'].includes(ev.type) && j > L.dsWindow) continue;
      const label = j === 1 ? 'demain' : `J-${j}`;
      candidates.push({ title: `Réviser pour ${ev.title} (${label})`, subject: ev.subject_id, kind: 'ds', event: ev.id, key: `prep-${ev.id}-${D}` });
    }

    // 4. Revoir le cours des matières qu'il a eues aujourd'hui
    const wd = weekday(D);
    const todays = (await all(`SELECT DISTINCT subject_id FROM timetable WHERE weekday = ?`, wd))
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
      if (await countOn(D) >= L.maxPerDay) break;
      await insertTask(D, D, c.title, c.subject ?? null, c.kind, c.event ?? null, c.key);
    }
  });
}

// Génère tous les jours manquants jusqu'à aujourd'hui (7 jours en arrière au maximum)
export async function ensureUpTo(D = today()) {
  const last = (await one('SELECT MAX(date) AS d FROM generated_days')).d;
  let start = last ? addDays(last, 1) : D;
  if (diffDays(start, D) > 7) start = addDays(D, -7);
  for (let d = start; d <= D; d = addDays(d, 1)) await generateDay(d);
}

// Statistiques d'une semaine (lundi -> dimanche), sur la date d'origine des tâches
export async function weekStats(ws) {
  const we = addDays(ws, 6);
  const rows = await all(`SELECT done_at, date, photo FROM tasks WHERE original_date BETWEEN ? AND ?`, ws, we);
  const t = today();
  const total = rows.length;
  const done = rows.filter((r) => r.done_at).length;
  const late = rows.filter((r) => !r.done_at && r.date < t).length;
  const photos = rows.filter((r) => r.photo).length;
  return { week_start: ws, total, done, late, photos, pct: total ? Math.round((done / total) * 100) : null };
}
