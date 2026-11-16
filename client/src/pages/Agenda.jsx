import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, Undo2, CalendarX2, GripVertical, TriangleAlert } from 'lucide-react';
import { api, addDays, weekStart, todayStr, weekLabel, dayLabel, parse, DAYS_SHORT, EVENT_LABEL, KIND_LABEL } from '../lib.js';
import { useApp, AddSheet, Skeleton, Sheet, useAutoRefresh } from '../ui.jsx';

// Grille horaire : de 7 h à 23 h, 1 heure = 60 px, pas de 15 minutes
const START = 7, END = 23, PPH = 60, PPM = PPH / 60, SNAP = 15;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const isExam = (e) => ['ds', 'bac_blanc', 'bac', 'oral'].includes(e.type);

function useWide() {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return wide;
}

// Répartit les tâches qui se chevauchent sur plusieurs colonnes
function layoutLanes(tasks) {
  const items = tasks.map((t) => ({ t, s: toMin(t.time), e: toMin(t.time) + (t.duration || 30) })).sort((a, b) => a.s - b.s);
  const out = []; let group = []; let groupEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of group) { let l = lanes.findIndex((end) => end <= it.s); if (l === -1) { l = lanes.length; lanes.push(0); } lanes[l] = it.e; it.lane = l; }
    for (const it of group) out.push({ ...it, lanes: lanes.length });
    group = [];
  };
  for (const it of items) { if (it.s >= groupEnd && group.length) flush(); group.push(it); groupEnd = Math.max(groupEnd, it.e); }
  if (group.length) flush();
  return out;
}

const shortTitle = (t) => t.title.replace("Revoir le cours de ", 'Cours de ').replace(" d'aujourd'hui", '');

export default function Agenda() {
  const { user, toast } = useApp();
  const wide = useWide();
  const [ws, setWs] = useState(weekStart(todayStr()));
  const [sel, setSel] = useState(todayStr());
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null); // tâche touchée (sans glisser)
  const [drag, setDrag] = useState(null); // { task, x, y, target }
  const scrollRef = useRef(null), colsRef = useRef(null), trayRef = useRef(null), dragRef = useRef(null), lastY = useRef(0);
  const isParent = user.role === 'parent';

  const load = useCallback(async (silent) => {
    try { setData(await api(`/week?start=${ws}`)); } catch (e) { if (!silent) toast(e.message, 'red'); }
  }, [ws, toast]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  // À l'ouverture : faire défiler vers 16 h (ou l'heure actuelle si plus tard)
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (!data || scrolled.current || !scrollRef.current) return;
    const now = new Date(); const h = Math.max(16, Math.min(now.getHours() - 1, END - 4));
    scrollRef.current.scrollTop = (h - START) * PPH; scrolled.current = true;
  }, [data]);

  const move = (n) => { const nws = addDays(ws, 7 * n); setWs(nws); setSel(nws <= todayStr() && todayStr() <= addDays(nws, 6) ? todayStr() : nws); setData(null); };
  const days = data ? (wide ? data.days : data.days.filter((d) => d.date === sel)) : [];
  const trayTasks = days.flatMap((d) => d.tasks.filter((t) => !t.time && !t.done_at).map((t) => ({ ...t, _day: d.date })));

  // ---------- Glisser-déposer (souris et doigt, via Pointer Events) ----------
  function hitTest(x, y, d) {
    const tray = trayRef.current?.getBoundingClientRect();
    if (tray && x >= tray.left && x <= tray.right && y >= tray.top && y <= tray.bottom) return { tray: true };
    const sc = scrollRef.current?.getBoundingClientRect(), cols = colsRef.current?.getBoundingClientRect();
    if (!sc || !cols || x < cols.left || x > cols.right || y < sc.top || y > sc.bottom) return null;
    const col = Math.min(days.length - 1, Math.floor((x - cols.left) / (cols.width / days.length)));
    const dur = d.task.duration || 30;
    let min = START * 60 + (y - cols.top - d.offsetY) / PPM;
    min = Math.round(min / SNAP) * SNAP;
    min = Math.max(START * 60, Math.min(END * 60 - dur, min));
    return { date: days[col].date, col, min };
  }

  function onPointerDown(e, task, fromGrid) {
    if (e.button !== undefined && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { task, sx: e.clientX, sy: e.clientY, active: false, offsetY: fromGrid ? e.clientY - rect.top : 12 };
    window.__suiviBusy = true; // pas de rafraîchissement automatique pendant un glisser-déposer
    lastY.current = e.clientY;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }
  function onPointerMove(e) {
    const d = dragRef.current; if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    if (!d.active) { d.active = true; navigator.vibrate?.(15); }
    e.preventDefault();
    lastY.current = e.clientY;
    setDrag({ task: d.task, x: e.clientX, y: e.clientY, target: hitTest(e.clientX, e.clientY, d) });
  }
  function cleanup() {
    window.__suiviBusy = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    dragRef.current = null; setDrag(null);
  }
  function onPointerCancel() { cleanup(); }
  function onPointerUp(e) {
    const d = dragRef.current;
    if (d && !d.active) { cleanup(); setOpen(d.task); return; }
    const target = d ? hitTest(e.clientX, e.clientY, d) : null;
    const task = d?.task;
    cleanup();
    if (!task || !target) return;
    if (target.tray) { if (task.time) save(task, { time: null }); return; }
    const time = toTime(target.min);
    if (task.time === time && task.date === target.date) return;
    save(task, { time, date: target.date });
  }

  // Défilement automatique quand on glisse près du haut ou du bas de la grille
  useEffect(() => {
    if (!drag) return undefined;
    // On attend 350 ms dans la zone du bord pour ne pas défiler quand on ne fait qu'y passer
    let since = 0;
    const id = setInterval(() => {
      const sc = scrollRef.current; if (!sc) return;
      const r = sc.getBoundingClientRect(), y = lastY.current;
      const dir = y < r.top + 48 && y > r.top - 40 ? -1 : y > r.bottom - 48 && y < r.bottom + 40 ? 1 : 0;
      if (!dir) { since = 0; return; }
      if (!since) since = Date.now();
      if (Date.now() - since > 350) sc.scrollTop += dir * 10;
    }, 16);
    return () => clearInterval(id);
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(task, body) {
    // Mise à jour immédiate à l'écran, puis enregistrement
    setData((cur) => {
      const all = cur.days.flatMap((d) => d.tasks).map((t) => (t.id === task.id ? { ...t, ...body } : t));
      return { ...cur, days: cur.days.map((d) => ({ ...d, tasks: all.filter((t) => t.date === d.date) })) };
    });
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body });
      if (body.time) toast(`Placée à ${body.time}${body.date && body.date !== task.date ? ` (${dayLabel(body.date)})` : ''}`);
      else if (body.time === null) toast('Remise dans « À placer »');
    } catch (err) { toast(err.message, 'red'); load(); }
  }

  async function toggleDone(task) {
    try { await api(`/tasks/${task.id}`, { method: 'PATCH', body: { done: !task.done_at } }); setOpen(null); load(); }
    catch (e) { toast(e.message, 'red'); }
  }
  async function remove(task) {
    if (!confirm('Supprimer cette tâche ?')) return;
    try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); setOpen(null); load(); } catch (e) { toast(e.message, 'red'); }
  }
  async function delEvent(ev) {
    if (!confirm(`Supprimer « ${ev.title} » de l'agenda ?`)) return;
    try { await api(`/events/${ev.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'red'); }
  }

  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const canDelete = (t) => (isParent ? t.source === 'parent' : ['manuel', 'parent'].includes(t.source));

  return (
    <div className="page agenda-page">
      <div className="week-nav">
        <button className="icon-btn" onClick={() => move(-1)} aria-label="Semaine précédente"><ChevronLeft /></button>
        <div className="grow center"><div className="h2">Agenda</div><div className="small muted">Semaine {weekLabel(ws)}</div></div>
        <button className="icon-btn" onClick={() => move(1)} aria-label="Semaine suivante"><ChevronRight /></button>
        <button className="icon-btn" style={{ background: 'var(--ink)', color: 'var(--paper)' }} onClick={() => setAdding(true)} aria-label="Ajouter une tâche ou un DS"><Plus size={24} strokeWidth={3} /></button>
      </div>

      {!data ? <div className="section"><Skeleton n={4} /></div> : (
        <>
          {!wide && (
            <div className="days-strip" role="tablist">
              {data.days.map((d, i) => (
                <button key={d.date} role="tab" aria-selected={sel === d.date} className={`day-pill ${sel === d.date ? 'on' : ''} ${d.date === data.today ? 'today' : ''}`} onClick={() => setSel(d.date)}>
                  <div className="d">{DAYS_SHORT[i + 1]}</div>
                  <div className="n">{parse(d.date).getDate()}</div>
                  <div className="marks">
                    {d.events.some(isExam) && <i className="red" />}
                    {d.tasks.some((t) => !t.done_at) && !d.events.some(isExam) && <i style={{ opacity: 0.35 }} />}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className={`cal-layout ${wide ? 'wide' : ''}`}>
            {/* Tâches à placer */}
            <div ref={trayRef} className={`tray ${drag?.target?.tray ? 'over' : ''}`} aria-label="Tâches à placer">
              <div className="tray-head">
                <b>À placer</b>
                <span className="small muted">{trayTasks.length ? 'glisse une tâche sur une heure' : ''}</span>
              </div>
              {trayTasks.length === 0 ? (
                <div className="small muted">{drag ? 'Lâche ici pour retirer l’heure.' : 'Tout est placé dans l’agenda.'}</div>
              ) : (
                <div className="tray-list">
                  {trayTasks.map((t) => (
                    <div key={t.id} className={`tray-item ${t.done_at ? 'done' : ''} ${drag?.task.id === t.id ? 'ghosted' : ''}`}
                      onPointerDown={(e) => onPointerDown(e, t, false)} role="button" tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen(t)} aria-label={`${t.title}, à placer`}>
                      <GripVertical size={16} className="grip" />
                      <span className="grow">
                        <span className="ti-title">{shortTitle(t)}</span>
                        <span className="ti-meta">{t.subject_short && <span className="tag">{t.subject_short}</span>}{wide && <span>{DAYS_SHORT[(parse(t._day).getDay() || 7)]}</span>}{t.done_at && <Check size={14} />}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Grille horaire */}
            <div className="cal" ref={scrollRef}>
              <div className="cal-head" style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)` }}>
                <div />
                {days.map((d) => (
                  <div key={d.date} className={`cal-day ${d.date === data.today ? 'today' : ''}`}>
                    {wide && <div className="cal-day-name">{DAYS_SHORT[parse(d.date).getDay() || 7]} <b>{parse(d.date).getDate()}</b></div>}
                    {d.events.map((ev) => (
                      <button key={ev.id} className={`allday ${isExam(ev) ? 'exam' : ''}`} onClick={() => delEvent(ev)} title="Toucher pour supprimer">
                        {isExam(ev) && <TriangleAlert size={12} />}<span>{EVENT_LABEL[ev.type]} · {ev.subject_name || ev.title}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <div className="cal-body" style={{ height: (END - START) * PPH }}>
                <div className="cal-hours">
                  {Array.from({ length: END - START }, (_, i) => <div key={i} className="cal-hour" style={{ top: i * PPH }}>{START + i}h</div>)}
                </div>
                <div className="cal-cols" ref={colsRef} style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
                  {days.map((d, ci) => (
                    <div key={d.date} className={`cal-col ${d.date === data.today ? 'today' : ''}`}>
                      {d.classes.map((c) => (
                        <div key={`c${c.id}`} className="cal-class" style={{ top: (toMin(c.start) - START * 60) * PPM, height: (toMin(c.end) - toMin(c.start)) * PPM }}>
                          <b>{c.subject_name}</b>{(toMin(c.end) - toMin(c.start)) >= 60 && <span>{c.start}–{c.end}{c.room ? ` · ${c.room}` : ''}</span>}
                        </div>
                      ))}
                      {layoutLanes(d.tasks.filter((t) => t.time)).map(({ t, s, e, lane, lanes }) => (
                        <div key={t.id} className={`cal-task ${(e - s) < 45 ? 'short' : ''} ${t.done_at ? 'done' : ''} ${t.source === 'parent' ? 'from-parent' : ''} ${drag?.task.id === t.id ? 'ghosted' : ''}`}
                          style={{ top: (s - START * 60) * PPM, height: Math.max(22, (e - s) * PPM - 2), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                          onPointerDown={(ev) => onPointerDown(ev, t, true)} role="button" tabIndex={0}
                          onKeyDown={(ev) => ev.key === 'Enter' && setOpen(t)} aria-label={`${t.title} à ${t.time}`}>
                          <span className="ct-time">{t.time}</span>
                          <span className="ct-title">{t.done_at && <Check size={13} strokeWidth={3} />} {shortTitle(t)}</span>
                        </div>
                      ))}
                      {drag?.target && !drag.target.tray && drag.target.col === ci && (
                        <div className="cal-drop" style={{ top: (drag.target.min - START * 60) * PPM, height: (drag.task.duration || 30) * PPM }}>
                          {toTime(drag.target.min)}
                        </div>
                      )}
                      {d.date === data.today && nowMin >= START * 60 && nowMin <= END * 60 && <div className="cal-now" style={{ top: (nowMin - START * 60) * PPM }} />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Aperçu qui suit le doigt */}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.target?.tray ? 'Retirer l’heure' : drag.target ? `${toTime(drag.target.min)} · ${shortTitle(drag.task)}` : shortTitle(drag.task)}
        </div>
      )}

      {open && (
        <Sheet title={open.time ? `${open.time} · ${dayLabel(open.date)}` : 'Tâche à placer'} onClose={() => setOpen(null)}>
          <div className="stack">
            <div className="t-title" style={{ fontSize: '1.1rem' }}>{open.title}</div>
            <div className="t-meta">{open.subject_name && <span className="tag">{open.subject_name}</span>}<span>{KIND_LABEL[open.kind]}</span>{open.source === 'parent' && <span className="tag">ajoutée par les parents</span>}</div>
            {!isParent && (
              <button className={`btn big block ${open.done_at ? 'ghost' : 'green'}`} onClick={() => toggleDone(open)}>
                {open.done_at ? <><Undo2 size={20} /> Décocher</> : <><Check size={20} /> C'est fait</>}
              </button>
            )}
            <div>
              <label className="f">Durée</label>
              <div className="chips">
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <button key={m} type="button" className={`chip ${(open.duration || 30) === m ? 'on' : ''}`}
                    onClick={() => { save(open, { duration: m }); setOpen({ ...open, duration: m }); }}>{m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`}</button>
                ))}
              </div>
            </div>
            {open.time && <button className="btn ghost block" onClick={() => { save(open, { time: null }); setOpen(null); }}><CalendarX2 size={18} /> Retirer l'heure</button>}
            {canDelete(open) && <button className="btn ghost block" onClick={() => remove(open)}><Trash2 size={18} /> Supprimer</button>}
            <div className="small muted center">Pour changer l'heure, fais glisser la tâche dans l'agenda.</div>
          </div>
        </Sheet>
      )}

      {adding && <AddSheet defaultDate={sel < todayStr() ? todayStr() : sel} onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}
