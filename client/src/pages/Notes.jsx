import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, todayStr, shortDate } from '../lib.js';
import { useApp, Skeleton, Sheet, Empty, SubjectChips, Flag, useAutoRefresh } from '../ui.jsx';

const on20 = (g) => (g.value / g.out_of) * 20;
const average = (list) => { const c = list.reduce((s, g) => s + g.coef, 0); return c ? list.reduce((s, g) => s + on20(g) * g.coef, 0) / c : null; };

function Curve({ grades }) {
  if (grades.length === 0) return null;
  const W = 320, H = 150, P = 24;
  const xs = (i) => (grades.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (grades.length - 1));
  const ys = (v) => H - 10 - (v / 20) * (H - 20);
  const pts = grades.map((g, i) => [xs(i), ys(on20(g))]);
  const avg = average(grades);
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label="Courbe des notes sur 20">
      {[0, 5, 10, 15, 20].map((v) => (
        <g key={v}>
          <line x1={P - 6} x2={W} y1={ys(v)} y2={ys(v)} stroke="var(--tone)" strokeWidth="1" strokeDasharray={v === 10 ? '' : '3 4'} />
          <text x="0" y={ys(v) + 4} fontSize="10" fill="var(--muted)">{v}</text>
        </g>
      ))}
      <line x1={P - 6} x2={W} y1={ys(avg)} y2={ys(avg)} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="6 4" />
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      {pts.map(([x, y], i) => {
        const v = on20(grades[i]);
        const col = v >= 12 ? 'var(--green)' : v < 10 ? 'var(--red)' : 'var(--ink)';
        return (
          <g key={grades[i].id}>
            <circle cx={x} cy={y} r="7" fill={col === 'var(--ink)' ? 'var(--paper)' : col} stroke="var(--ink)" strokeWidth="2.5" />
            <text x={x} y={y - 12} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">{Math.round(v * 10) / 10}</text>
            <text x={x} y={H + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">{grades[i].date.slice(8)}/{grades[i].date.slice(5, 7)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AddGrade({ onClose, onDone, subjectId }) {
  const { toast } = useApp();
  const [subject, setSubject] = useState(subjectId);
  const [value, setValue] = useState('');
  const [outOf, setOutOf] = useState(20);
  const [coef, setCoef] = useState(1);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setErr('');
    if (!subject) return setErr('Choisis une matière.');
    try {
      await api('/grades', { method: 'POST', body: { subject_id: subject, value: Number(String(value).replace(',', '.')), out_of: Number(outOf), coef: Number(coef), title: title || 'DS', date } });
      toast('Note ajoutée'); onDone(); onClose();
    } catch (e2) { setErr(e2.message); }
  }
  return (
    <Sheet title="Nouvelle note" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div><label className="f">Matière</label><SubjectChips value={subject} onChange={setSubject} /></div>
        <div className="row">
          <div className="grow"><label className="f" htmlFor="gv">Note</label><input id="gv" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="12,5" required /></div>
          <div style={{ width: 90 }}><label className="f" htmlFor="go">Sur</label><input id="go" className="input" type="number" min="1" value={outOf} onChange={(e) => setOutOf(e.target.value)} /></div>
          <div style={{ width: 80 }}><label className="f" htmlFor="gc">Coef</label><input id="gc" className="input" type="number" min="0.5" step="0.5" value={coef} onChange={(e) => setCoef(e.target.value)} /></div>
        </div>
        <div><label className="f" htmlFor="gt">Intitulé</label><input id="gt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. DS 4 : dérivation" /></div>
        <div><label className="f" htmlFor="gd">Date</label><input id="gd" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn big block">Ajouter la note</button>
      </form>
    </Sheet>
  );
}

// Moyenne générale = moyenne des moyennes de chaque matière (toutes les matières comptent pareil)
function generalAverage(grades) {
  const bySubj = {};
  for (const g of grades) (bySubj[g.subject_id] ||= []).push(g);
  const avgs = Object.values(bySubj).map(average).filter((a) => a != null);
  return avgs.length ? avgs.reduce((x, y) => x + y, 0) / avgs.length : null;
}
// Évolution : moyenne générale recalculée à chaque nouvelle note
function generalHistory(grades) {
  const dates = [...new Set(grades.map((g) => g.date))].sort();
  return dates.map((d, i) => ({ id: `g${i}`, date: d, value: Math.round(generalAverage(grades.filter((g) => g.date <= d)) * 100) / 100, out_of: 20, coef: 1 }));
}

function General({ grades, subjects, onPick }) {
  const gen = generalAverage(grades);
  const hist = generalHistory(grades);
  const rows = subjects.map((s) => ({ s, list: grades.filter((g) => g.subject_id === s.id) })).map((r) => ({ ...r, avg: average(r.list) }));
  return (
    <>
      <div className="panel section">
        <div className="row">
          <div className="grow">
            <div className="small muted">Moyenne générale</div>
            <div className="row"><span className="stat" style={{ fontSize: '2.8rem' }}>{gen == null ? '—' : gen.toFixed(2)}</span>{gen != null && gen >= 12 && <Flag ok>Bien</Flag>}{gen != null && gen < 10 && <Flag>Sous 10</Flag>}</div>
          </div>
          <span className="small muted">{rows.filter((r) => r.avg != null).length} matière{rows.filter((r) => r.avg != null).length > 1 ? 's' : ''} notée{rows.filter((r) => r.avg != null).length > 1 ? 's' : ''}</span>
        </div>
        {hist.length > 1 && <><div className="small muted" style={{ marginTop: 8 }}>Évolution après chaque note</div><Curve grades={hist} /></>}
      </div>
      <div className="section">
        <div className="section-head"><h2 className="h2">Par matière</h2><span className="aside">touche pour le détail</span></div>
        {rows.map(({ s, list, avg }) => (
          <button key={s.id} className="subj-row" onClick={() => onPick(s.id)}>
            <span className="subj-name"><b>{s.name}</b>{s.is_spe ? <span className="tag">spé</span> : null}</span>
            <span className="subj-bar"><span style={{ transform: `scaleX(${avg == null ? 0 : avg / 20})` }} className={avg == null ? '' : avg >= 12 ? 'ok' : avg < 10 ? 'bad' : ''} /></span>
            <span className="mono subj-avg">{avg == null ? '—' : avg.toFixed(1)}</span>
            <span className="small muted subj-n">{list.length ? `${list.length} note${list.length > 1 ? 's' : ''}` : 'aucune'}</span>
          </button>
        ))}
        <div className="small muted" style={{ marginTop: 8 }}>Chaque matière compte pareil dans la moyenne générale ; dans une matière, les notes sont pondérées par leur coefficient.</div>
      </div>
    </>
  );
}

export default function Notes() {
  const { subjects, toast } = useApp();
  const [grades, setGrades] = useState(null);
  const [subj, setSubj] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback((silent) => api('/grades').then(setGrades).catch((e) => !silent && toast(e.message, 'red')), [toast]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const current = subj ?? 'general';
  const list = (grades || []).filter((g) => g.subject_id === current);
  const avg = average(list);

  async function del(g) { if (!confirm('Supprimer cette note ?')) return; await api(`/grades/${g.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'red')); load(); }

  return (
    <div className="page">
      <div className="row"><h1 className="h1 grow">Notes</h1><button className="btn sm" onClick={() => setAdding(true)}><Plus size={18} /> Note</button></div>
      {!grades ? <Skeleton /> : (
        <>
          <div className="tabs section" style={{ marginTop: 14 }}>
            <button className={`chip ${current === 'general' ? 'on' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setSubj('general')}>
              Générale{generalAverage(grades) != null && <span className="mono" style={{ marginLeft: 6, opacity: 0.8 }}>{generalAverage(grades).toFixed(1)}</span>}
            </button>
            {subjects.map((s) => {
              const a = average(grades.filter((g) => g.subject_id === s.id));
              return (
                <button key={s.id} className={`chip ${current === s.id ? 'on' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setSubj(s.id)}>
                  {s.name}{a != null && <span className="mono" style={{ marginLeft: 6, opacity: 0.8 }}>{a.toFixed(1)}</span>}
                </button>
              );
            })}
          </div>
          {current === 'general' ? <General grades={grades} subjects={subjects} onPick={setSubj} /> : list.length === 0 ? <div className="section"><Empty sfx="PAS DE NOTE">Aucune note dans cette matière. Ajoute-la avec le bouton « Note ».</Empty></div> : (
            <>
              <div className="panel section">
                <div className="row"><div className="grow"><div className="small muted">Moyenne</div><div className="row"><span className="stat">{avg.toFixed(2)}</span>{avg >= 12 && <Flag ok>Bien</Flag>}{avg < 10 && <Flag>Sous 10</Flag>}</div></div><span className="small muted">{list.length} note{list.length > 1 ? 's' : ''}</span></div>
                <Curve grades={list} />
              </div>
              <table className="table section">
                <tbody>
                  {[...list].reverse().map((g) => (
                    <tr key={g.id}>
                      <td><b>{g.title}</b><div className="small muted">{shortDate(g.date)}{g.coef !== 1 ? ` · coef ${g.coef}` : ''}</div></td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{String(g.value).replace('.', ',')}/{g.out_of}</td>
                      <td style={{ width: 44 }}><button className="icon-btn plain" onClick={() => del(g)} aria-label="Supprimer la note"><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      {adding && <AddGrade subjectId={current === 'general' ? null : current} onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}
