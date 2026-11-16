// Notifications sur le téléphone (Web Push, gratuit). Fonctionne sur Android et, sur iPhone,
// quand le site est ajouté à l'écran d'accueil (iOS 16.4+).
import * as webpush from 'web-push';
import { all, one, run, getSetting, setSetting } from './db.js';
import { today, weekday, addDays, weekStart, diffDays } from './planner.js';

const PUB = process.env.VAPID_PUBLIC_KEY, PRIV = process.env.VAPID_PRIVATE_KEY;
export const pushEnabled = () => Boolean(PUB && PRIV);
export const publicKey = () => PUB || null;
if (pushEnabled()) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://site-suivi-devoirs.vercel.app', PUB, PRIV);

export async function saveSubscription(userId, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw Object.assign(new Error('Abonnement invalide'), { status: 400 });
  await run(`INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    userId, String(sub.endpoint).slice(0, 1000), sub.keys.p256dh, sub.keys.auth);
}
export const removeSubscription = (endpoint) => run('DELETE FROM push_subscriptions WHERE endpoint = ?', String(endpoint || ''));
export const countSubscriptions = async (userId) => (await one('SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ?', userId)).n;

// Envoie à tous les appareils des utilisateurs visés ; les abonnements expirés sont supprimés
async function sendTo(where, params, payload) {
  if (!pushEnabled()) return 0;
  const subs = await all(`SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE ${where}`, ...params);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
      else console.error('Notification', e.statusCode || e.message);
    }
  }));
  return sent;
}
export const notifyUser = (userId, payload) => sendTo('u.id = ?', [userId], payload);
export const notifyRole = (roles, payload) => sendTo(`u.role IN (${roles.map(() => '?').join(',')})`, roles, payload);
export const notifyParents = (payload) => notifyRole(['parent', 'admin'], payload);

const DAY_NAMES = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

// Notification de 18 h (heure de Paris). Appelée par la tâche planifiée ; une seule fois par jour.
export async function eveningRun({ force = false } = {}) {
  const T = today();
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: process.env.APP_TIMEZONE || 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()));
  if (!force && hour < 18) return { skipped: `il est ${hour} h à Paris, envoi à partir de 18 h` };
  if (!force && (await getSetting('lastEvening', null)) === T) return { skipped: 'déjà envoyé aujourd’hui' };
  await setSetting('lastEvening', T);

  const wd = weekday(T);
  const tasks = await all('SELECT done_at FROM tasks WHERE date = ?', T);
  const left = tasks.filter((t) => !t.done_at).length;
  const ds = await one(`SELECT e.title, e.date FROM events e JOIN subjects s ON s.id = e.subject_id
    WHERE e.type IN ('ds','bac_blanc','bac') AND e.date > ? ORDER BY e.date LIMIT 1`, T);
  const jx = ds ? diffDays(T, ds.date) : null;
  const dsLine = ds && jx <= 7 ? ` · J-${jx} : ${ds.title}` : '';

  let student;
  if (wd === 7) {
    const ws = weekStart(T);
    const sent = await one('SELECT submitted_at FROM weekly_reports WHERE week_start = ?', ws);
    if (!sent?.submitted_at) student = { title: 'Rendu du week-end ce soir', body: `Coche tes tâches de samedi et dimanche, réussis le quiz de la semaine, puis envoie ton rendu.${dsLine}`, url: '/#/rendu' };
  } else if (left > 0) {
    student = { title: `Ce soir : ${plural(left, 'tâche')}`, body: `${wd <= 5 ? 'N’oublie pas ton rendu du jour après.' : 'Garde-les pour ton rendu du week-end demain soir.'}${dsLine}`, url: '/#/' };
  } else if (tasks.length && wd <= 5) {
    student = { title: 'Tout est fait, bravo !', body: `Pense juste à valider ton rendu du jour.${dsLine}`, url: '/#/rendu' };
  }
  const sentStudent = student ? await notifyRole(['eleve'], { ...student, tag: `soir-${T}` }) : 0;

  // Parents : rendu d'hier oublié (jour de semaine avec des tâches prévues)
  let sentParents = 0;
  const y = addDays(T, -1);
  if (weekday(y) <= 5) {
    const [n, rep] = await Promise.all([
      one('SELECT COUNT(*)::int AS n FROM tasks WHERE date = ?', y),
      one('SELECT 1 FROM daily_reports WHERE date = ?', y),
    ]);
    if (n.n > 0 && !rep) sentParents = await notifyParents({ title: 'Rendu oublié', body: `Pas de rendu ${DAY_NAMES[weekday(y)]} (${plural(n.n, 'tâche')} prévue${n.n > 1 ? 's' : ''}).`, url: '/#/bilan', tag: `oubli-${y}` });
  }
  return { date: T, sentStudent, sentParents };
}
