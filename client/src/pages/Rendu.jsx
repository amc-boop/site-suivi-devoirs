import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Send, TriangleAlert, CircleCheck, Hourglass, CalendarCheck } from 'lucide-react';
import { api, addDays, weekStart, todayStr, weekLabel, dayLabel, weekday, DAYS_SHORT, parse } from '../lib.js';
import { useApp, TaskItem, Skeleton, Empty, Bar, Pct, Flag } from '../ui.jsx';

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

// État du rendu de la semaine (utilisé aussi côté parents)
export function WeekStatus({ report }) {
  if (report?.status === 'validee') return <Flag ok>Validée par les parents</Flag>;
  if (report?.status === 'a_revoir') return <Flag>À revoir</Flag>;
  if (report?.submitted_at) return <span className="flag"><Hourglass size={14} /> En attente de validation</span>;
  return <span className="flag">Pas encore envoyée</span>;
}

// Les 7 jours de la semaine : journée validée ou non
export function DaysChecklist({ ws, dayReports, today }) {
  const done = new Set((dayReports || []).map((d) => d.date));
  return (
    <div className="days-check" aria-label="Journées validées">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(ws, i), ok = done.has(d), past = d < today;
        return (
          <div key={d} className={`dc ${ok ? 'ok' : past ? 'miss' : ''}`} title={dayLabel(d)}>
            <span>{DAYS_SHORT[i + 1]}</span>
            {ok ? <CircleCheck size={16} /> : past ? <TriangleAlert size={14} /> : <b>{parse(d).getDate()}</b>}
          </div>
        );
      })}
    </div>
  );
}

function DayRendu() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const d = await api('/day-report'); setData(d); setComment(d.report?.comment || ''); } catch (e) { toast(e.message, 'red'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    setBusy(true);
    try { setData(await api('/day-report/submit', { method: 'POST', body: { date: data.date, comment } })); toast('Journée validée !'); }
    catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  }
  const onTask = (t) => setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? t : x)) }));

  if (!data) return <Skeleton n={3} />;
  const done = data.tasks.filter((t) => t.done_at).length, total = data.tasks.length;
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><div className="small muted">{dayLabel(data.date)}</div><h1 className="h1">Rendu du jour</h1></div>
        <span className="kpi-value" style={{ fontSize: '2.4rem' }}>{done}/{total}</span>
      </div>
      <div style={{ marginTop: 8 }}><Bar value={total ? (done / total) * 100 : 0} color={total && done === total ? 'green' : ''} /></div>

      {data.report && (
        <div className="alert ok" style={{ marginTop: 14 }} role="status">
          <CalendarCheck size={28} />
          <div><span className="sfx-title">JOURNÉE VALIDÉE !</span><div className="small">Envoyée {when(data.report.submitted_at)}. Tu peux encore cocher et mettre à jour.</div></div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {total === 0 ? <Empty sfx="RIEN AUJOURD'HUI">Aucune tâche prévue aujourd'hui.</Empty>
          : data.tasks.map((t, i) => <TaskItem key={t.id} task={t} allowPhoto onChange={onTask} delay={i * 80} />)}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Coche ce qui est fait. Pour un exercice ou un DS refait, ajoute une photo avec l'appareil.</div>

      <div className="panel section">
        <label className="f" htmlFor="dcmt">Un mot sur ta journée (facultatif)</label>
        <input id="dcmt" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex. Fiche de SES finie, exercice 37 pas compris" />
        <button className="btn green block big" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
          <CircleCheck size={20} /> {data.report ? 'Mettre à jour ma journée' : 'Valider ma journée'}
        </button>
        {total > 0 && done < total && !data.report && <div className="small muted center" style={{ marginTop: 6 }}>Les tâches non cochées seront reportées à demain.</div>}
      </div>
    </>
  );
}

function WeekRendu() {
  const { toast } = useApp();
  const [ws, setWs] = useState(weekStart(todayStr()));
  const [data, setData] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const weekend = weekday(todayStr()) >= 6;
  const [showDetail, setShowDetail] = useState(weekend);

  const load = useCallback(async () => {
    try { const d = await api(`/report?week=${ws}`); setData(d); setComment(d.report?.student_comment || ''); } catch (e) { toast(e.message, 'red'); }
  }, [ws, toast]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    setBusy(true);
    try { setData(await api('/report/submit', { method: 'POST', body: { week: ws, comment } })); toast('Semaine envoyée aux parents pour validation'); }
    catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  }

  const isCurrent = ws === weekStart(todayStr());
  const r = data?.report;
  const validated = r?.status === 'validee';
  return (
    <div className="section" style={{ marginTop: 34 }}>
      <div className="section-head"><h2 className="h2">Rendu de la semaine</h2></div>
      <div className="week-nav">
        <button className="icon-btn" onClick={() => { setWs(addDays(ws, -7)); setData(null); }} aria-label="Semaine précédente"><ChevronLeft /></button>
        <div className="grow center"><b>Semaine {weekLabel(ws)}</b></div>
        <button className="icon-btn" onClick={() => { setWs(addDays(ws, 7)); setData(null); }} disabled={isCurrent} aria-label="Semaine suivante"><ChevronRight /></button>
      </div>

      {!data ? <div className="section"><Skeleton n={2} /></div> : (
        <>
          <div className="panel tone section">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="small muted">Tâches faites</div>
                <div className="stat">{data.stats.done} / {data.stats.total}</div>
                <div style={{ marginTop: 6 }}><WeekStatus report={r} /></div>
              </div>
              <Pct value={data.stats.pct} />
            </div>
            <div style={{ marginTop: 10 }}><Bar value={data.stats.pct} /></div>
            <div className="small muted" style={{ margin: '12px 0 6px' }}>Journées validées</div>
            <DaysChecklist ws={ws} dayReports={data.dayReports} today={data.today} />
          </div>

          {r?.status === 'a_revoir' && (
            <div className="alert bad section" role="alert">
              <TriangleAlert size={26} />
              <div><span className="sfx-title" style={{ fontSize: '1.3rem' }}>À REVOIR</span><div className="small">{r.parent_comment}</div></div>
            </div>
          )}
          {validated && (
            <div className="alert ok section">
              <CircleCheck size={26} />
              <div><span className="sfx-title" style={{ fontSize: '1.3rem' }}>SEMAINE VALIDÉE !</span>{r.parent_comment && <div className="small">{r.seen_by_name ? `${r.seen_by_name} : ` : ''}{r.parent_comment}</div>}</div>
            </div>
          )}

          <button className="btn ghost block section" onClick={() => setShowDetail((v) => !v)} aria-expanded={showDetail}>
            <ChevronDown size={18} style={{ transform: showDetail ? 'rotate(180deg)' : '' }} /> {showDetail ? 'Masquer' : 'Voir'} le détail de la semaine
          </button>
          {showDetail && <WeekTasks tasks={data.tasks} onChange={() => load()} />}

          {!validated && (
            <div className="section panel">
              {isCurrent && !weekend && !r?.submitted_at && <div className="small muted" style={{ marginBottom: 10 }}>Le rendu de la semaine se fait le week-end : vérifie que tout est coché, puis envoie-le aux parents.</div>}
              <label className="f" htmlFor="cmt">Un mot pour les parents (facultatif)</label>
              <textarea id="cmt" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex. J'ai refait le DS de maths en entier" />
              <button className="btn block big" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>
                <Send size={20} /> {r?.status === 'a_revoir' ? 'Renvoyer aux parents' : r?.submitted_at ? 'Mettre à jour mon rendu' : 'Envoyer aux parents pour validation'}
              </button>
              {r?.submitted_at && <div className="small muted center" style={{ marginTop: 8 }}>Envoyé {when(r.submitted_at)}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Rendu() {
  return (
    <div className="page">
      <DayRendu />
      <WeekRendu />
    </div>
  );
}
