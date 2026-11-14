import { useCallback, useEffect, useState } from 'react';
import { Plus, Send, Gift, TriangleAlert, ChevronRight, CircleCheck } from 'lucide-react';
import { api, dayLabel, relDays, weekday, EVENT_LABEL, shortDate } from '../lib.js';
import { useApp, TaskItem, AddSheet, Skeleton, Empty, Bar, Flag } from '../ui.jsx';

export function Countdown({ exams }) {
  if (!exams?.length) {
    return (
      <div className="panel tone tilt">
        <div className="small muted">PROCHAIN DS</div>
        <div className="h2" style={{ marginTop: 4 }}>Aucun DS prévu</div>
        <div className="small muted">Ajoute tes DS et bacs blancs avec le bouton +.</div>
      </div>
    );
  }
  const [first, ...others] = exams;
  const urgent = first.days <= 3;
  return (
    <div className={`hero ${urgent ? 'urgent' : ''}`}>
      <div className="label">Prochain {EVENT_LABEL[first.type]}</div>
      <div className="big">{first.days === 0 ? "AUJOURD'HUI !" : `J-${first.days}`}</div>
      <div className="title">{first.title}</div>
      <div className="small" style={{ opacity: 0.85 }}>{dayLabel(first.date)}{first.notes ? ` · ${first.notes}` : ''}</div>
      {others.length > 0 && (
        <div className="others">
          {others.map((e) => <span key={e.id} className="chip-dark">J-{e.days} · {e.subject_name || EVENT_LABEL[e.type]}</span>)}
        </div>
      )}
    </div>
  );
}

export default function Today() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [adding, setAdding] = useState(false);
  const [showLate, setShowLate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api('/today'), api('/rewards')]);
      setData(d); setRewards(r.filter((x) => !x.given_at));
    } catch (e) { toast(e.message, 'red'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="page"><Skeleton n={4} /></div>;

  const onTask = (t, what) => {
    if (what === 'moved' || what === 'deleted') return load();
    setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? t : x)), late: d.late.map((x) => (x.id === t.id ? t : x)) }));
    api('/today').then((d) => setData((cur) => ({ ...cur, week: d.week })));
  };
  const done = data.tasks.filter((t) => t.done_at).length;
  const total = data.tasks.length;
  const allDone = total > 0 && done === total;
  const lateOpen = data.late.filter((t) => !t.done_at);
  const wd = weekday(data.date);

  return (
    <div className="page">
      <Countdown exams={data.nextExams} />

      <div className="section row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="small muted">{dayLabel(data.date)}</div>
          <div className="h1">Ce soir</div>
        </div>
        <div className="counter">
          <span className="num">{done}/{total}</span>
        </div>
      </div>
      <div style={{ marginTop: 8 }}><Bar value={total ? (done / total) * 100 : 0} color={allDone ? 'green' : ''} /></div>

      {allDone && (
        <div className="alert ok" style={{ marginTop: 14 }} role="status">
          <CircleCheck size={30} />
          <div><span className="sfx-title">TOUT EST FAIT !</span><div className="small">Soirée libre. Cette semaine : {data.week.pct ?? 0} % des tâches faites.</div></div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {total === 0 ? (
          <Empty sfx="RIEN CE SOIR">Aucune tâche prévue. Tu peux en ajouter une avec le bouton +.</Empty>
        ) : data.tasks.map((t, i) => <TaskItem key={t.id} task={t} onChange={onTask} allowDelete delay={i * 80} />)}
      </div>

      {lateOpen.length > 0 && (
        <div className="section">
          <button className="alert bad" style={{ cursor: 'pointer' }} onClick={() => setShowLate((v) => !v)} aria-expanded={showLate}>
            <TriangleAlert size={24} />
            <span className="grow"><span className="sfx-title" style={{ fontSize: '1.3rem' }}>EN RETARD !</span><span className="small" style={{ display: 'block' }}>{lateOpen.length} tâche{lateOpen.length > 1 ? 's' : ''} à rattraper</span></span>
            <ChevronRight size={18} style={{ transform: showLate ? 'rotate(90deg)' : '' }} />
          </button>
          {showLate && <div style={{ marginTop: 10 }}>{lateOpen.map((t) => <TaskItem key={t.id} task={t} onChange={onTask} showDate />)}</div>}
        </div>
      )}

      {wd >= 6 && (
        <a href="#/rendu" className="panel tone row section" style={{ textDecoration: 'none' }}>
          <Send size={22} />
          <div className="grow"><b>C'est le week-end : rendu de la semaine</b><div className="small muted">Coche ce qui est fait, ajoute une photo, valide.</div></div>
          <ChevronRight size={20} />
        </a>
      )}

      <div className="section">
        <div className="section-head"><h2 className="h2">Cours du jour</h2></div>
        {data.classes.length === 0 ? <div className="muted small">Pas cours aujourd'hui.</div> : (
          <div className="panel flat">
            {data.classes.map((c) => (
              <div className="slot" key={c.id}>
                <span className="time">{c.start}<br />{c.end}</span>
                <div><b>{c.subject_name}</b>{c.room && <span className="small muted"> · {c.room}</span>}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head"><h2 className="h2">Devoirs à venir</h2><span className="aside">7 jours</span></div>
        {data.devoirs.length === 0 ? <div className="muted small">Rien à rendre cette semaine.</div> : data.devoirs.map((e) => (
          <div className={`event ${e.days <= 1 ? 'exam' : ''}`} key={e.id}>
            <span className={`tag ${e.days <= 1 ? 'solid red' : 'solid'}`}>{relDays(e.days)}</span>
            <div className="grow"><b>{e.title}</b><div className="small muted">{e.subject_name} · pour {shortDate(e.date)}</div></div>
          </div>
        ))}
      </div>

      {rewards.length > 0 && (
        <div className="section">
          <div className="section-head"><h2 className="h2">Récompenses</h2></div>
          <div className="stack">
            {rewards.slice(0, 3).map((r) => (
              <div key={r.id} className={`panel flat ${r.progress.reached ? 'green' : ''}`}>
                <div className="row"><Gift size={18} /><b className="grow">{r.prize || r.title}</b>{r.progress.reached && <Flag ok>Débloquée</Flag>}</div>
                <div className="small muted" style={{ margin: '4px 0 6px' }}>{r.progress.label}</div>
                {r.rule !== 'manuel' && <Bar value={(Math.max(0, r.progress.current) / r.progress.target) * 100} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="fab" onClick={() => setAdding(true)} aria-label="Ajouter une tâche ou un DS"><Plus size={32} strokeWidth={3} /></button>
      {adding && <AddSheet onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}
