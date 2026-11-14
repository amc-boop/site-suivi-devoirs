import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api, addDays, weekStart, todayStr, weekLabel, dayLabel, parse, DAYS_SHORT, EVENT_LABEL } from '../lib.js';
import { useApp, TaskItem, AddSheet, Skeleton, Empty } from '../ui.jsx';

export default function Agenda() {
  const { user, toast } = useApp();
  const [ws, setWs] = useState(weekStart(todayStr()));
  const [sel, setSel] = useState(todayStr());
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const canEdit = true; // élève, parents et admin peuvent ajouter tâches et événements
  const isParent = user.role === 'parent';

  const load = useCallback(async () => {
    try { setData(await api(`/week?start=${ws}`)); } catch (e) { toast(e.message, 'red'); }
  }, [ws, toast]);
  useEffect(() => { load(); }, [load]);

  const move = (n) => { const nws = addDays(ws, 7 * n); setWs(nws); setSel(nws <= todayStr() && todayStr() <= addDays(nws, 6) ? todayStr() : nws); setData(null); };
  const day = data?.days.find((d) => d.date === sel);

  async function delEvent(ev) {
    if (!confirm(`Supprimer « ${ev.title} » de l'agenda ?`)) return;
    try { await api(`/events/${ev.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'red'); }
  }

  return (
    <div className="page">
      <div className="week-nav">
        <button className="icon-btn" onClick={() => move(-1)} aria-label="Semaine précédente"><ChevronLeft /></button>
        <div className="grow center">
          <div className="h2">Semaine</div>
          <div className="small muted">{weekLabel(ws)}</div>
        </div>
        <button className="icon-btn" onClick={() => move(1)} aria-label="Semaine suivante"><ChevronRight /></button>
      </div>

      {!data ? <Skeleton n={4} /> : (
        <>
          <div className="days-strip" role="tablist">
            {data.days.map((d, i) => {
              const exam = d.events.some((e) => ['ds', 'bac_blanc', 'oral'].includes(e.type));
              return (
                <button key={d.date} role="tab" aria-selected={sel === d.date} className={`day-pill ${sel === d.date ? 'on' : ''} ${d.date === data.today ? 'today' : ''}`} onClick={() => setSel(d.date)}>
                  <div className="d">{DAYS_SHORT[i + 1]}</div>
                  <div className="n">{parse(d.date).getDate()}</div>
                  <div className="marks">
                    {exam && <i className="red" />}
                    {d.events.some((e) => e.type === 'devoir') && <i />}
                    {d.tasks.length > 0 && !exam && <i style={{ opacity: 0.35 }} />}
                  </div>
                </button>
              );
            })}
          </div>

          {day && (
            <>
              <div className="h2">{dayLabel(day.date)}</div>

              {day.events.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {day.events.map((e) => (
                    <div key={e.id} className={`event ${['ds', 'bac_blanc', 'oral'].includes(e.type) ? 'exam' : ''}`}>
                      <span className={`tag solid ${['ds', 'bac_blanc'].includes(e.type) ? 'red' : ''}`}>{EVENT_LABEL[e.type]}</span>
                      <div className="grow"><b>{e.title}</b>{e.notes && <div className="small muted">{e.notes}</div>}</div>
                      {canEdit && <button className="icon-btn plain" onClick={() => delEvent(e)} aria-label="Supprimer"><Trash2 size={18} /></button>}
                    </div>
                  ))}
                </div>
              )}

              <div className="section">
                <div className="section-head"><h3 className="h2">Tâches</h3><span className="aside">{day.tasks.filter((t) => t.done_at).length}/{day.tasks.length}</span></div>
                {day.tasks.length === 0
                  ? <div className="muted small">{day.date > data.today ? 'Les tâches automatiques apparaissent le jour même. Tu peux en planifier avec +.' : 'Aucune tâche.'}</div>
                  : day.tasks.map((t) => <TaskItem key={t.id} task={t} onChange={() => load()} readOnly={isParent} allowDelete />)}
              </div>

              <div className="section">
                <div className="section-head"><h3 className="h2">Cours</h3></div>
                {day.classes.length === 0 ? <Empty>Pas cours.</Empty> : (
                  <div className="panel flat">
                    {day.classes.map((c) => (
                      <div className="slot" key={c.id}><span className="time">{c.start}<br />{c.end}</span><div><b>{c.subject_name}</b>{c.room && <span className="small muted"> · {c.room}</span>}</div></div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {canEdit && <button className="fab" onClick={() => setAdding(true)} aria-label="Ajouter"><Plus size={32} strokeWidth={3} /></button>}
      {adding && <AddSheet defaultDate={sel < todayStr() ? todayStr() : sel} onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}
