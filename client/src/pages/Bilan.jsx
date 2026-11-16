import { useCallback, useEffect, useState } from 'react';
import { Eye, Camera, TriangleAlert, ChevronRight, Plus, CircleCheck, Undo2 } from 'lucide-react';
import { api, weekLabel, shortDate, EVENT_LABEL } from '../lib.js';
import { useApp, Skeleton, Sheet, Pct, Bar, Lightbox, Empty, Flag, AddSheet, useAutoRefresh } from '../ui.jsx';
import { WeekTasks, WeekStatus, DaysChecklist } from './Rendu.jsx';
import { NotificationsBanner } from '../Notifications.jsx';
import { ProgressCard, useProgress } from './Progression.jsx';

function WeeksChart({ weeks }) {
  const list = [...weeks].reverse().filter((w) => w.total > 0);
  if (list.length < 2) return null;
  const W = 320, H = 120, bw = Math.min(36, (W - 20) / list.length - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="Pourcentage de tâches faites par semaine">
      <line x1="0" x2={W} y1={H - H * 0.8} y2={H - H * 0.8} stroke="var(--ink)" strokeDasharray="4 4" strokeWidth="1.5" />
      {list.map((w, i) => {
        const x = 10 + i * ((W - 20) / list.length) + 4, h = (H * (w.pct || 0)) / 100;
        const color = w.pct >= 80 ? 'var(--green)' : w.pct < 50 ? 'var(--red)' : 'var(--ink)';
        return (
          <g key={w.week_start}>
            <rect x={x} y={H - h} width={bw} height={h} fill={color} stroke="var(--ink)" strokeWidth="2" rx="3" />
            <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--ink)">{w.pct}</text>
            <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize="9" fill="var(--muted)">{w.week_start.slice(8)}/{w.week_start.slice(5, 7)}</text>
          </g>
        );
      })}
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}

function WeekDetail({ ws, onClose, onSeen }) {
  const { toast, user } = useApp();
  const [d, setD] = useState(null);
  const [comment, setComment] = useState('');
  const [zoom, setZoom] = useState(null);
  useEffect(() => { api(`/report?week=${ws}`).then((x) => { setD(x); setComment(x.report?.parent_comment || ''); }).catch((e) => toast(e.message, 'red')); }, [ws, toast]);

  async function decide(status) {
    try {
      const x = await api('/report/seen', { method: 'POST', body: { week: ws, comment, status } });
      setD(x); toast(status === 'validee' ? 'Semaine validée' : 'Renvoyée à Martin pour être revue'); onSeen();
    } catch (e) { toast(e.message, 'red'); }
  }
  const photos = d?.tasks.filter((t) => t.photo) || [];
  const late = d?.tasks.filter((t) => !t.done_at && t.date < d.today) || [];
  const canAct = user.role !== 'eleve';

  return (
    <Sheet title={`Semaine ${weekLabel(ws)}`} onClose={onClose}>
      {!d ? <Skeleton /> : (
        <div className="stack">
          <div className="panel tone flat row">
            <div className="grow"><div className="small muted">Tâches faites</div><div className="stat">{d.stats.done}/{d.stats.total}</div></div>
            <Pct value={d.stats.pct} />
          </div>
          <div><WeekStatus report={d.report} /></div>
          <div><div className="small muted" style={{ marginBottom: 6 }}>Rendus de Martin (jour par jour + week-end)</div><DaysChecklist ws={ws} dayReports={d.dayReports} today={d.today} weekendReport={d.report} /></div>
          {d.report?.submitted_at
            ? <div className="small"><b>Rendu envoyé</b> le {new Date(d.report.submitted_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            : <div className="small warn-text"><TriangleAlert size={16} /> Rendu pas encore envoyé</div>}
          {d.report?.student_comment && <div className="speech">{d.report.student_comment}</div>}
          {d.quiz?.total ? (
            d.quiz.passed_at
              ? <div className="small"><Flag ok>Quiz de la semaine réussi</Flag> <span className="muted">{d.quiz.best_score}/{d.quiz.total} · {d.quiz.attempts} essai{d.quiz.attempts > 1 ? 's' : ''}{d.quiz.sources ? ` · ${d.quiz.sources}` : ''}</span></div>
              : <div className="small"><Flag>Quiz pas encore réussi</Flag> <span className="muted">{d.quiz.attempts} essai{d.quiz.attempts > 1 ? 's' : ''}{d.quiz.best_score != null ? ` · meilleur ${d.quiz.best_score}/${d.quiz.total}` : ''}</span></div>
          ) : null}

          {photos.length > 0 && (
            <div>
              <div className="h2" style={{ marginTop: 10 }}>Photos ({photos.length})</div>
              <div className="row wrap" style={{ marginTop: 8 }}>
                {photos.map((t) => <img key={t.id} className="photo-thumb" style={{ width: 88, height: 88 }} src={`/uploads/${t.photo}`} alt={t.title} title={t.title} onClick={() => setZoom(`/uploads/${t.photo}`)} />)}
              </div>
            </div>
          )}
          {late.length > 0 && <div className="small warn-text"><TriangleAlert size={16} /> {late.length} tâche{late.length > 1 ? 's' : ''} non faite{late.length > 1 ? 's' : ''}</div>}

          {canAct && d.report?.submitted_at && (
            <div className="panel">
              <label className="f" htmlFor="pc">Commentaire pour lui</label>
              <textarea id="pc" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex. Bravo pour le DS refait ! / Il manque la photo de l'exercice" />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn red" style={{ flex: 1 }} onClick={() => decide('a_revoir')}><Undo2 size={20} /> À revoir</button>
                <button className="btn green big" style={{ flex: 1.4 }} onClick={() => decide('validee')}><CircleCheck size={20} /> Valider</button>
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>« À revoir » lui renvoie la semaine avec ton commentaire.</div>
            </div>
          )}
          {canAct && !d.report?.submitted_at && <div className="small muted">Tu pourras valider la semaine quand il l'aura envoyée.</div>}
          <div className="h2" style={{ marginTop: 10 }}>Détail</div>
          <WeekTasks tasks={d.tasks} readOnly />
        </div>
      )}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </Sheet>
  );
}

export default function Bilan() {
  const { toast, user, refreshAlerts } = useApp();
  const progress = useProgress();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const load = useCallback((silent) => Promise.all([api('/overview'), user.role === 'eleve' ? [] : api('/alerts')])
    .then(([o, a]) => { setData(o); setAlerts(a); }).catch((e) => !silent && toast(e.message, 'red')), [toast, user.role]);
  async function seen(a) {
    setAlerts((l) => l.filter((x) => x !== a));
    await api('/alerts/seen', { method: 'POST', body: a.id ? { id: a.id } : { kind: a.kind, date: a.date } }).catch(() => {});
    refreshAlerts?.();
  }
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  if (!data) return <div className="page"><Skeleton n={5} /></div>;

  const cur = data.weeks[0];
  const toSee = data.weeks.filter((w) => w.submitted_at && !w.status);
  return (
    <div className="page">
      <div className="row"><h1 className="h1 grow">Bilan</h1><button className="btn sm" onClick={() => setAdding(true)}><Plus size={18} /> Tâche</button></div>

      <ProgressCard p={progress} />
      <NotificationsBanner />

      {alerts.length > 0 && (
        <div className="section stack" aria-label="Alertes">
          {alerts.map((a) => (
            <div key={`${a.kind}-${a.date}-${a.id || ''}`} className="alert bad" role="alert" style={{ alignItems: 'flex-start' }}>
              <TriangleAlert size={24} />
              <div className="grow">
                <b>{a.message}</b>
                {a.details && <div className="small" style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{a.details}</div>}
              </div>
              <button className="btn sm ghost" onClick={() => seen(a)} style={{ flex: 'none' }}>Vu</button>
            </div>
          ))}
        </div>
      )}

      {toSee.length > 0 && (
        <button className="panel red row section" style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(toSee[0].week_start)}>
          <Eye size={22} />
          <div className="grow"><b>Rendu à valider</b><div className="small muted">Semaine {weekLabel(toSee[0].week_start)}</div></div>
          <ChevronRight />
        </button>
      )}

      <div className="grid2 section">
        <div className="panel tilt">
          <div className="small muted">Cette semaine</div>
          <div className="row"><Pct value={cur?.pct} /><span className="small muted">{cur?.done}/{cur?.total}</span></div>
          <div style={{ marginTop: 6 }}><Bar value={cur?.pct} /></div>
        </div>
        <div className={`panel tilt-r ${data.lateTasks.length ? 'red' : 'green'}`}>
          <div className="small muted">En retard (14 j)</div>
          <div className="stat">{data.lateTasks.length}</div>
          <div style={{ marginTop: 4 }}>{data.lateTasks.length ? <Flag>À rattraper</Flag> : <Flag ok>Aucun</Flag>}</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h2 className="h2">Prochaines échéances</h2></div>
        {data.nextExams.length === 0 ? <div className="muted small">Rien de prévu.</div> : data.nextExams.map((e) => (
          <div key={e.id} className={`event ${['ds', 'bac_blanc', 'bac'].includes(e.type) ? 'exam' : ''}`}>
            <span className={`tag solid ${e.days <= 3 && e.type !== 'devoir' ? 'red' : ''}`}>J-{e.days}</span>
            <div className="grow"><b>{e.title}</b><div className="small muted">{EVENT_LABEL[e.type]} · {shortDate(e.date)}</div></div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-head"><h2 className="h2">Historique</h2><span className="aside">% de tâches faites (pointillés : 80 %)</span></div>
        <div className="panel flat"><WeeksChart weeks={data.weeks} /></div>
        <div style={{ marginTop: 12 }}>
          {data.weeks.map((w) => (
            <button key={w.week_start} className="week-row" onClick={() => setOpen(w.week_start)}>
              <div>
                <b>Semaine {weekLabel(w.week_start)}</b>
                <div className="t-meta" style={{ marginTop: 4 }}>
                  <span>{w.done}/{w.total} faites</span>
                  {w.photos > 0 && <span className="row" style={{ gap: 3 }}><Camera size={13} />{w.photos}</span>}
                  {w.late > 0 && <span className="tag"><TriangleAlert size={12} /> {w.late} en retard</span>}
                  {w.submitted_at ? <span className="tag">rendu</span> : <span className="tag red"><TriangleAlert size={12} /> pas rendu</span>}
                  {w.status === 'validee' && <span className="tag green"><CircleCheck size={12} /> validée</span>}
                  {w.status === 'a_revoir' && <span className="tag red"><Undo2 size={12} /> à revoir</span>}
                  {w.submitted_at && !w.status && <span className="tag">à valider</span>}
                </div>
              </div>
              <Pct value={w.pct} />
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h2 className="h2">Tâches en retard</h2></div>
        {data.lateTasks.length === 0 ? <Empty sfx="RAS !">Aucune tâche en retard.</Empty> : (
          <div className="panel flat">
            {data.lateTasks.slice(0, 12).map((t) => (
              <div className="slot" key={t.id}><span className="time">{shortDate(t.original_date)}</span><div className="row"><TriangleAlert size={14} color="var(--red)" /><span>{t.title}</span></div></div>
            ))}
          </div>
        )}
      </div>

      {adding && <AddSheet onClose={() => setAdding(false)} onDone={load} />}
      {open && <WeekDetail ws={open} onClose={() => setOpen(null)} onSeen={load} />}
    </div>
  );
}
