import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, KeyRound, Send, LineChart, Brain } from 'lucide-react';
import { api, DAYS, ROLE_LABEL } from '../lib.js';
import { useApp, Skeleton } from '../ui.jsx';

function SlotRow({ slot, subjects, onSaved, onDelete }) {
  const { toast } = useApp();
  const [s, setS] = useState(slot);
  const dirty = JSON.stringify(s) !== JSON.stringify(slot);
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  async function save() {
    try {
      if (s.id) await api(`/timetable/${s.id}`, { method: 'PATCH', body: s });
      else await api('/timetable', { method: 'POST', body: s });
      toast('Créneau enregistré'); onSaved();
    } catch (e) { toast(e.message, 'red'); }
  }
  return (
    <div className="row wrap" style={{ padding: '8px 0', borderBottom: '1.5px dashed var(--tone)', gap: 6 }}>
      <input className="input mono" style={{ width: 124, minHeight: 42, padding: "8px" }} type="time" value={s.start} onChange={(e) => set('start', e.target.value)} aria-label="Début" />
      <input className="input mono" style={{ width: 124, minHeight: 42, padding: "8px" }} type="time" value={s.end} onChange={(e) => set('end', e.target.value)} aria-label="Fin" />
      <select className="input grow" style={{ minHeight: 42, minWidth: 140 }} value={s.subject_id || ''} onChange={(e) => set('subject_id', Number(e.target.value))} aria-label="Matière">
        <option value="" disabled>Matière…</option>
        {subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <input className="input" style={{ width: 90, minHeight: 42 }} value={s.room || ''} onChange={(e) => set('room', e.target.value)} placeholder="Salle" aria-label="Salle" />
      {(dirty || !s.id) && <button className="icon-btn" onClick={save} aria-label="Enregistrer"><Save size={18} /></button>}
      <button className="icon-btn plain" onClick={() => onDelete(s)} aria-label="Supprimer le créneau"><Trash2 size={18} /></button>
    </div>
  );
}

export function Timetable() {
  const { subjects, toast } = useApp();
  const [slots, setSlots] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const load = useCallback(() => api('/timetable').then((x) => { setSlots(x); setDrafts([]); }).catch((e) => toast(e.message, 'red')), [toast]);
  useEffect(() => { load(); }, [load]);
  async function del(s) {
    if (!s.id) return setDrafts((d) => d.filter((x) => x !== s.__key && x.__key !== s.__key));
    if (!confirm('Supprimer ce créneau ?')) return;
    await api(`/timetable/${s.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'red')); load();
  }
  if (!slots) return <Skeleton />;
  return (
    <div className="stack">
      <div className="small muted">Les tâches « Revoir le cours de … » sont créées chaque jour pour les matières de ce jour-là. Les horaires sont enregistrés dès que tu touches l’icône disquette.</div>
      {[1, 2, 3, 4, 5, 6].map((wd) => {
        const list = [...slots.filter((s) => s.weekday === wd), ...drafts.filter((d) => d.weekday === wd)];
        return (
          <div key={wd} className="panel flat">
            <div className="row"><b className="grow">{DAYS[wd]}</b>
              <button className="btn sm ghost" onClick={() => setDrafts((d) => [...d, { __key: Math.random(), weekday: wd, start: '08:00', end: '09:00', subject_id: null, room: '' }])}><Plus size={16} /> Créneau</button>
            </div>
            {list.length === 0 && <div className="small muted">Pas cours.</div>}
            {list.map((s) => <SlotRow key={s.id || s.__key} slot={s} subjects={subjects} onSaved={load} onDelete={del} />)}
          </div>
        );
      })}
    </div>
  );
}

function Subjects() {
  const { subjects, reloadSubjects, toast } = useApp();
  const [name, setName] = useState('');
  async function patch(s, body) { await api(`/subjects/${s.id}`, { method: 'PATCH', body }).catch((e) => toast(e.message, 'red')); reloadSubjects(); }
  async function add(e) { e.preventDefault(); if (!name.trim()) return; await api('/subjects', { method: 'POST', body: { name } }).catch((er) => toast(er.message, 'red')); setName(''); reloadSubjects(); }
  async function del(s) { if (!confirm(`Supprimer ${s.name} ? Ses créneaux et notes seront supprimés.`)) return; await api(`/subjects/${s.id}`, { method: 'DELETE' }); reloadSubjects(); }
  return (
    <div className="stack">
      <table className="table">
        <thead><tr><th>Matière</th><th>Spé</th><th>Révision du soir</th><th /></tr></thead>
        <tbody>
          {subjects.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b> <span className="tag">{s.short}</span></td>
              <td><input type="checkbox" checked={!!s.is_spe} onChange={(e) => patch(s, { is_spe: e.target.checked })} aria-label={`${s.name} spécialité`} style={{ width: 22, height: 22 }} /></td>
              <td><input type="checkbox" checked={!!s.review_daily} onChange={(e) => patch(s, { review_daily: e.target.checked })} aria-label={`${s.name} révision du soir`} style={{ width: 22, height: 22 }} /></td>
              <td><button className="icon-btn plain" onClick={() => del(s)} aria-label="Supprimer"><Trash2 size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="row" onSubmit={add}><input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle matière" /><button className="btn">Ajouter</button></form>
    </div>
  );
}

function Accounts() {
  const { toast, user } = useApp();
  const [users, setUsers] = useState(null);
  const [f, setF] = useState({ username: '', display_name: '', role: 'parent', password: '' });
  const load = useCallback(() => api('/users').then(setUsers).catch((e) => toast(e.message, 'red')), [toast]);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault();
    try { await api('/users', { method: 'POST', body: f }); toast('Compte créé'); setF({ username: '', display_name: '', role: 'parent', password: '' }); load(); }
    catch (er) { toast(er.message, 'red'); }
  }
  async function reset(u) {
    const pw = prompt(`Nouveau mot de passe pour ${u.display_name} (6 caractères min.)`);
    if (!pw) return;
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { password: pw } }); toast('Mot de passe changé'); } catch (er) { toast(er.message, 'red'); }
  }
  async function del(u) { if (!confirm(`Supprimer le compte ${u.username} ?`)) return; try { await api(`/users/${u.id}`, { method: 'DELETE' }); load(); } catch (er) { toast(er.message, 'red'); } }
  if (!users) return <Skeleton />;
  return (
    <div className="stack">
      {users.map((u) => (
        <div key={u.id} className="event">
          <div className="grow"><b>{u.display_name}</b><div className="small muted mono">{u.username} · {ROLE_LABEL[u.role]}</div></div>
          <button className="icon-btn" onClick={() => reset(u)} aria-label="Changer le mot de passe"><KeyRound size={18} /></button>
          {u.id !== user.id && <button className="icon-btn plain" onClick={() => del(u)} aria-label="Supprimer"><Trash2 size={16} /></button>}
        </div>
      ))}
      <form className="panel flat stack" onSubmit={add}>
        <b>Nouveau compte</b>
        <div className="chips">{['eleve', 'parent', 'admin'].map((r) => <button type="button" key={r} className={`chip ${f.role === r ? 'on' : ''}`} onClick={() => setF({ ...f, role: r })}>{ROLE_LABEL[r]}</button>)}</div>
        <input className="input" placeholder="Identifiant (ex. maman)" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" required />
        <input className="input" placeholder="Nom affiché (ex. Maman)" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        <input className="input" placeholder="Mot de passe" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required />
        <button className="btn">Créer le compte</button>
      </form>
    </div>
  );
}

function Limits() {
  const { toast } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => { api('/settings').then(setS); }, []);
  async function save(e) { e.preventDefault(); try { setS(await api('/settings', { method: 'PATCH', body: s })); toast('Réglages enregistrés'); } catch (er) { toast(er.message, 'red'); } }
  if (!s) return <Skeleton n={1} />;
  const field = (k, label, help) => (
    <div><label className="f" htmlFor={k}>{label}</label><input id={k} className="input" type="number" min="0" max="30" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /><div className="small muted">{help}</div></div>
  );
  return (
    <form className="stack" onSubmit={save}>
      {field('maxPerDay', 'Tâches automatiques par soir (max.)', 'Les devoirs à rendre sont toujours ajoutés, même au-delà.')}
      {field('maxCarry', 'Nombre de reports maximum', 'Après ce nombre, la tâche reste « en retard » et les parents la voient.')}
      {field('dsWindow', 'Révisions avant un DS (jours)', 'Une tâche de révision par jour pendant ces jours-là.')}
      {field('bacBlancWindow', 'Révisions avant un bac blanc (jours)', '')}
      <button className="btn">Enregistrer</button>
    </form>
  );
}

const TABS = [['edt', 'Emploi du temps', Timetable], ['comptes', 'Comptes', Accounts], ['matieres', 'Matières', Subjects], ['reglages', 'Tâches', Limits]];

export default function Admin() {
  const [tab, setTab] = useState('edt');
  const Cur = TABS.find((t) => t[0] === tab)[2];
  return (
    <div className="page">
      <h1 className="h1">Réglages</h1>
      <div className="row wrap" style={{ margin: '10px 0 4px', gap: 8 }}>
        <a className="btn sm ghost" href="#/rendu"><Send size={16} /> Rendu</a>
        <a className="btn sm ghost" href="#/notes"><LineChart size={16} /> Notes</a>
        <a className="btn sm ghost" href="#/quiz"><Brain size={16} /> Quiz</a>
      </div>
      <div className="tabs section">
        {TABS.map(([k, label]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="section"><Cur /></div>
    </div>
  );
}
