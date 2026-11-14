import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Send, TriangleAlert } from 'lucide-react';
import { api, addDays, weekStart, todayStr, weekLabel, dayLabel } from '../lib.js';
import { useApp, TaskItem, Skeleton, Empty, Bar, Pct } from '../ui.jsx';

const when = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Liste de la semaine groupée par jour (utilisée aussi par le bilan des parents)
export function WeekTasks({ tasks, readOnly, onChange }) {
  const byDay = {};
  for (const t of tasks) (byDay[t.original_date] ||= []).push(t);
  const days = Object.keys(byDay).sort();
  if (!days.length) return <Empty sfx="SEMAINE VIDE">Aucune tâche cette semaine.</Empty>;
  return days.map((d) => (
    <div key={d} className="section" style={{ marginTop: 16 }}>
      <div className="small" style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{dayLabel(d)}</div>
      {byDay[d].map((t) => <TaskItem key={t.id} task={t} readOnly={readOnly} allowPhoto={!readOnly} onChange={onChange} />)}
    </div>
  ));
}

export default function Rendu() {
  const { toast } = useApp();
  const [ws, setWs] = useState(weekStart(todayStr()));
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api(`/report?week=${ws}`); setData(d); setComment(d.report?.student_comment || ''); } catch (e) { toast(e.message, 'red'); }
  }, [ws, toast]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    setBusy(true);
    try { const d = await api('/report/submit', { method: 'POST', body: { week: ws, comment } }); setData(d); toast('Semaine envoyée aux parents !'); }
    catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  }

  const isCurrent = ws === weekStart(todayStr());
  const r = data?.report;
  return (
    <div className="page">
      <div className="week-nav">
        <button className="icon-btn" onClick={() => { setWs(addDays(ws, -7)); setData(null); }} aria-label="Semaine précédente"><ChevronLeft /></button>
        <div className="grow center"><div className="h2">Rendu de la semaine</div><div className="small muted">{weekLabel(ws)}</div></div>
        <button className="icon-btn" onClick={() => { setWs(addDays(ws, 7)); setData(null); }} disabled={isCurrent} aria-label="Semaine suivante"><ChevronRight /></button>
      </div>

      {!data ? <div className="section"><Skeleton n={5} /></div> : (
        <>
          <div className="panel tone section">
            <div className="row">
              <div className="grow">
                <div className="small muted">Fait cette semaine</div>
                <div className="stat">{data.stats.done} / {data.stats.total}</div>
              </div>
              <Pct value={data.stats.pct} />
            </div>
            <div style={{ marginTop: 8 }}><Bar value={data.stats.pct} /></div>
            {data.stats.late > 0 && <div className="small warn-text" style={{ marginTop: 8 }}><TriangleAlert size={16} /> {data.stats.late} tâche{data.stats.late > 1 ? 's' : ''} pas encore faite{data.stats.late > 1 ? 's' : ''}</div>}
          </div>

          <div className="small muted" style={{ marginTop: 12 }}>Coche ce qui est fait. Pour prouver un DS refait ou un exercice, ajoute une photo avec l'appareil.</div>
          <WeekTasks tasks={data.tasks} onChange={() => load()} />

          {r?.seen_at && (
            <div className="panel green section">
              <div className="row"><Eye size={18} /><b>Vu par {r.seen_by_name || 'les parents'}</b></div>
              {r.parent_comment && <div className="speech" style={{ marginTop: 10 }}>{r.parent_comment}</div>}
            </div>
          )}

          <div className="section panel">
            <label className="f" htmlFor="cmt">Un mot pour les parents (facultatif)</label>
            <textarea id="cmt" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex. J'ai refait le DS de maths en entier" />
            <button className="btn green block big" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
              <Send size={20} /> {r?.submitted_at ? 'Mettre à jour mon rendu' : 'Valider ma semaine'}
            </button>
            {r?.submitted_at && <div className="small muted center" style={{ marginTop: 8 }}>Envoyé {when(r.submitted_at)}</div>}
          </div>
        </>
      )}
    </div>
  );
}
