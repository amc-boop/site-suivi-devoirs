import { useCallback, useEffect, useState } from 'react';
import { Gift, Plus, Trash2, Check } from 'lucide-react';
import { api } from '../lib.js';
import { useApp, Skeleton, Sheet, Bar, Empty, SubjectChips, Flag, useAutoRefresh } from '../ui.jsx';

function NewReward({ onClose, onDone }) {
  const { toast } = useApp();
  const [rule, setRule] = useState('semaines');
  const [prize, setPrize] = useState('');
  const [pct, setPct] = useState(80);
  const [weeks, setWeeks] = useState(3);
  const [subject, setSubject] = useState(null);
  const [points, setPoints] = useState(2);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault(); setErr('');
    const auto = rule === 'semaines' ? `${weeks} semaine${weeks > 1 ? 's' : ''} à ${pct} %` : rule === 'note' ? `+${points} points de moyenne` : title;
    try {
      await api('/rewards', { method: 'POST', body: { rule, prize, title: (rule === 'manuel' ? title : auto) || 'Objectif', params: { pct, weeks, subject_id: subject, points } } });
      toast('Récompense créée'); onDone(); onClose();
    } catch (e2) { setErr(e2.message); }
  }
  return (
    <Sheet title="Nouvelle récompense" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div>
          <label className="f">Objectif</label>
          <div className="chips">
            <button type="button" className={`chip ${rule === 'semaines' ? 'on' : ''}`} onClick={() => setRule('semaines')}>Régularité</button>
            <button type="button" className={`chip ${rule === 'note' ? 'on' : ''}`} onClick={() => setRule('note')}>Progrès en notes</button>
            <button type="button" className={`chip ${rule === 'manuel' ? 'on' : ''}`} onClick={() => setRule('manuel')}>Libre</button>
          </div>
        </div>
        {rule === 'semaines' && (
          <div className="row">
            <div className="grow"><label className="f" htmlFor="rp">% de tâches faites</label><input id="rp" className="input" type="number" min="10" max="100" step="5" value={pct} onChange={(e) => setPct(Number(e.target.value))} /></div>
            <div className="grow"><label className="f" htmlFor="rw">Semaines de suite</label><input id="rw" className="input" type="number" min="1" max="20" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} /></div>
          </div>
        )}
        {rule === 'note' && (
          <>
            <div><label className="f">Matière</label><SubjectChips value={subject} onChange={setSubject} /></div>
            <div><label className="f" htmlFor="rpts">Points gagnés sur la moyenne (sur 20)</label><input id="rpts" className="input" type="number" min="0.5" max="10" step="0.5" value={points} onChange={(e) => setPoints(Number(e.target.value))} /></div>
            <div className="small muted">Comparé à la moyenne actuelle, avec la moyenne des 2 prochaines notes.</div>
          </>
        )}
        {rule === 'manuel' && <div><label className="f" htmlFor="rt">Objectif</label><input id="rt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Bac blanc de français préparé" required /></div>}
        <div><label className="f" htmlFor="rz">Récompense</label><input id="rz" className="input" value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="Ex. Sortie ciné" required /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn big block">Créer</button>
      </form>
    </Sheet>
  );
}

export default function Rewards() {
  const { user, toast } = useApp();
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback((silent) => api('/rewards').then(setList).catch((e) => !silent && toast(e.message, 'red')), [toast]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  const canEdit = user.role !== 'eleve';

  async function give(r, given) { try { await api(`/rewards/${r.id}/given`, { method: 'POST', body: { given } }); load(); } catch (e) { toast(e.message, 'red'); } }
  async function del(r) { if (!confirm('Supprimer cette récompense ?')) return; try { await api(`/rewards/${r.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'red'); } }

  return (
    <div className="page">
      <div className="row"><h1 className="h1 grow">Récompenses</h1>{canEdit && <button className="btn sm" onClick={() => setAdding(true)}><Plus size={18} /> Ajouter</button>}</div>
      <div className="small muted" style={{ marginTop: 4 }}>Des paliers à atteindre : régularité dans les tâches ou progrès en notes. Il voit sa progression sur sa page d'accueil.</div>
      <div className="section stack">
        {!list ? <Skeleton /> : list.length === 0 ? <Empty sfx="À VOUS !">Aucune récompense pour l'instant.</Empty> : list.map((r, i) => (
          <div key={r.id} className={`panel ${r.given_at ? 'flat' : r.progress.reached ? 'green' : ''} ${i % 2 ? 'tilt-r' : 'tilt'}`} style={{ opacity: r.given_at ? 0.6 : 1 }}>
            <div className="row">
              <Gift size={22} />
              <div className="grow"><b style={{ fontSize: '1.1rem' }}>{r.prize || r.title}</b><div className="small muted">{r.title}</div></div>
              {r.given_at ? <span className="tag">donnée</span> : r.progress.reached ? <Flag ok>Débloquée</Flag> : null}
            </div>
            <div className="small" style={{ margin: '8px 0 6px' }}>{r.progress.label}</div>
            {r.rule !== 'manuel' && <Bar value={(Math.max(0, r.progress.current) / r.progress.target) * 100} />}
            {r.progress.hint && <div className="small muted" style={{ marginTop: 6 }}>{r.progress.hint}</div>}
            {canEdit && (
              <div className="row" style={{ marginTop: 10 }}>
                {!r.given_at
                  ? <button className="btn sm green" onClick={() => give(r, true)}><Check size={16} /> Donnée</button>
                  : <button className="btn sm ghost" onClick={() => give(r, false)}>Annuler « donnée »</button>}
                <span className="grow" />
                <button className="icon-btn plain" onClick={() => del(r)} aria-label="Supprimer"><Trash2 size={18} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      {adding && <NewReward onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}
