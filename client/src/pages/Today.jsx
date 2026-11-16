import { useCallback, useEffect, useState } from 'react';
import { Plus, TriangleAlert, ChevronRight, CircleCheck, ListTodo, FileText, TrendingUp } from 'lucide-react';
import { api, dayLabel, relDays, shortDate } from '../lib.js';
import { useApp, TaskItem, AddSheet, Skeleton, Empty, Bar, useAutoRefresh } from '../ui.jsx';
import { NotificationsBanner } from '../Notifications.jsx';

// Tuile de compte à rebours (J-x) ; rouge à J-3 ou moins
function CountdownKpi({ label, ev, empty, wide }) {
  if (!ev) {
    return (
      <div className={`kpi ${wide ? 'kpi-wide' : ''}`}>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value muted">—</div>
        <div className="kpi-sub">{empty}</div>
      </div>
    );
  }
  const urgent = ev.days <= 3;
  return (
    <div className={`kpi ${wide ? 'kpi-wide hero-kpi' : ''} ${urgent ? 'kpi-bad' : ''}`}>
      <div className="kpi-label">{urgent && <TriangleAlert size={14} />}{label}</div>
      <div className="kpi-value">{ev.days === 0 ? "AUJ. !" : `J-${ev.days}`}</div>
      <div className="kpi-sub">{ev.title} · {shortDate(ev.date)}</div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, icon: Icon, href }) {
  const Tag = href ? 'a' : 'div';
  return (
    <Tag href={href} className={`kpi ${tone === 'ok' ? 'kpi-ok' : tone === 'bad' ? 'kpi-bad' : ''}`}>
      <div className="kpi-label">{Icon && <Icon size={14} />}{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </Tag>
  );
}

export default function Today() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showLate, setShowLate] = useState(false);

  const load = useCallback(async (silent) => {
    try {
      setData(await api('/today'));
    } catch (e) { if (!silent) toast(e.message, 'red'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

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
  const todo = total - done;

  return (
    <div className="page">
      <div className="small muted">{dayLabel(data.date)}</div>
      <div className="kpi-grid">
        <CountdownKpi wide label="Prochain DS de spé" ev={data.nextSpeDs} empty="Aucun DS de spé prévu" />
        <CountdownKpi label="Bac blanc / bac" ev={data.nextBac} empty="Rien de prévu" />
        <Kpi label="À faire ce soir" icon={todo === 0 && total > 0 ? CircleCheck : ListTodo} value={total ? todo : '0'}
          sub={total ? `${done} faite${done > 1 ? 's' : ''} sur ${total}` : 'Aucune tâche'} tone={total > 0 && todo === 0 ? 'ok' : ''} />
        <Kpi label="En retard" icon={lateOpen.length ? TriangleAlert : CircleCheck} value={lateOpen.length}
          sub={lateOpen.length ? 'à rattraper' : 'Rien en retard'} tone={lateOpen.length ? 'bad' : 'ok'} />
        <Kpi label="Devoirs (7 j)" icon={FileText} value={data.devoirs.length}
          sub={data.devoirs[0] ? `Prochain ${relDays(data.devoirs[0].days)}` : 'Rien à rendre'} />
        <Kpi label="Semaine" icon={TrendingUp} value={`${data.week.pct ?? 0}%`} sub={`${data.week.done}/${data.week.total} tâches faites`}
          tone={data.week.pct >= 80 ? 'ok' : ''} />
      </div>

      <NotificationsBanner />

      <div className="section row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
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

      <div className="section">
        <div className="section-head"><h2 className="h2">Devoirs à venir</h2><span className="aside">7 jours</span></div>
        {data.devoirs.length === 0 ? <div className="muted small">Rien à rendre cette semaine.</div> : data.devoirs.map((e) => (
          <div className={`event ${e.days <= 1 ? 'exam' : ''}`} key={e.id}>
            <span className={`tag ${e.days <= 1 ? 'solid red' : 'solid'}`}>{relDays(e.days)}</span>
            <div className="grow"><b>{e.title}</b><div className="small muted">{e.subject_name} · pour {shortDate(e.date)}</div></div>
          </div>
        ))}
      </div>

      <button className="fab" onClick={() => setAdding(true)} aria-label="Ajouter une tâche ou un DS"><Plus size={32} strokeWidth={3} /></button>
      {adding && <AddSheet onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}
