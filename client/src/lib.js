// Appels au serveur et petits utilitaires de dates.
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    if (res.status === 401) window.dispatchEvent(new Event('auth-lost'));
    throw err;
  }
  return data;
}

const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
export const weekday = (s) => { const w = parse(s).getDay(); return w === 0 ? 7 : w; };
export const weekStart = (s) => addDays(s, 1 - weekday(s));
export const todayStr = () => fmt(new Date());

export const DAYS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const DAYS_SHORT = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const dayLabel = (s) => { const d = parse(s); return `${DAYS[weekday(s)]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`; };
export const shortDate = (s) => { const d = parse(s); return `${DAYS_SHORT[weekday(s)].toLowerCase()}. ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const weekLabel = (ws) => { const a = parse(ws), b = parse(addDays(ws, 6)); return `du ${a.getDate()} ${a.getMonth() !== b.getMonth() ? MONTHS[a.getMonth()] + ' ' : ''}au ${b.getDate()} ${MONTHS[b.getMonth()]}`; };
export const relDays = (n) => (n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : n === -1 ? 'hier' : n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`);

export const EVENT_LABEL = { ds: 'DS', bac_blanc: 'Bac blanc', devoir: 'Devoir à rendre', oral: 'Oral', autre: 'Autre' };
export const KIND_LABEL = {
  revision_cours: 'Révision', bac_francais: 'Bac de français', refaire_ds: 'Refaire un DS', exercice: 'Exercice',
  devoir: 'Devoir', ds: 'Préparation DS', autre: 'Tâche',
};
export const ROLE_LABEL = { eleve: 'Élève', parent: 'Parent', admin: 'Admin' };
