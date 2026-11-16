import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Camera, X, BookOpen, FileText, RotateCcw, PenLine, CalendarPlus, Plus, Trash2, CalendarClock, CircleCheck, TriangleAlert, UsersRound, Play, Timer } from 'lucide-react';
import { api, compressImage, addDays, todayStr, weekday, shortDate, KIND_LABEL, EVENT_LABEL, DAYS } from './lib.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Mise à jour automatique : toutes les 30 s et dès que l'appli revient au premier plan.
// On ne rafraîchit pas pendant une saisie, une fenêtre ouverte ou un glisser-déposer.
export function useAutoRefresh(cb, ms = 30000) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const run = () => {
      const el = document.activeElement;
      if (document.hidden || window.__suiviBusy || document.body.style.overflow === 'hidden') return;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      ref.current(true);
    };
    const id = setInterval(run, ms);
    const onShow = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    // Rafraîchissement immédiat demandé par l'appli (ex. fin d'une tâche en mode concentration)
    const now = () => ref.current(true);
    window.addEventListener('suivi-refresh', now);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); window.removeEventListener('suivi-refresh', now); };
  }, [ms]);
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="h2 grow">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Skeleton({ n = 3 }) {
  return <div aria-busy="true">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}

export function Empty({ sfx, children, action }) {
  return (
    <div className="empty">
      {sfx && <div className="sfx-text">{sfx}</div>}
      <div className="muted" style={{ marginTop: 6 }}>{children}</div>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return createPortal(<div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo"><img src={src} alt="Photo jointe" /></div>, document.body);
}

// Pourcentage : le chiffre reste à l'encre, la pastille de couleur porte le sens (icône + libellé)
export function Pct({ value }) {
  if (value == null) return <span className="pct muted">—</span>;
  return (
    <span className="pct-wrap">
      <span className="pct">{value}%</span>
      {value >= 80 && <Flag ok>Objectif</Flag>}
      {value < 50 && <Flag>Trop bas</Flag>}
    </span>
  );
}

export function Flag({ ok, children }) {
  return <span className={`flag ${ok ? 'ok' : 'bad'}`}>{ok ? <CircleCheck size={14} /> : <TriangleAlert size={14} />}{children}</span>;
}

export function Bar({ value, color }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={`bar ${color || (v >= 80 ? 'green' : '')}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ transform: `scaleX(${v / 100})` }} />
    </div>
  );
}

// « d'aujourd'hui » devient « de jeudi » quand la tâche a été reportée
const displayTitle = (t, today) => (t.original_date !== today && t.title.endsWith("d'aujourd'hui")
  ? t.title.replace("d'aujourd'hui", `de ${DAYS[weekday(t.original_date)].toLowerCase()}`) : t.title);

// ---------- Une tâche à cocher ----------
export function TaskItem({ task, onChange, readOnly, showDate, allowPhoto, allowDelete, delay = 0 }) {
  const { toast, user, startFocus } = useApp();
  // Élève/admin : tâches ajoutées à la main ; parents : seulement celles qu'ils ont ajoutées
  const canDelete = allowDelete && (user.role === 'parent' ? task.source === 'parent' : ['manuel', 'parent'].includes(task.source));
  const [busy, setBusy] = useState(false);
  const [sfx, setSfx] = useState(false);
  const [zoom, setZoom] = useState(null);
  const fileRef = useRef(null);
  const today = todayStr();
  const late = !task.done_at && task.date < today;

  async function toggle() {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      const t = await api(`/tasks/${task.id}`, { method: 'PATCH', body: { done: !task.done_at } });
      if (t.done_at) { setSfx(true); setTimeout(() => setSfx(false), 900); navigator.vibrate?.(30); }
      onChange?.(t);
    } catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  }
  async function upload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const form = new FormData(); form.append('photo', await compressImage(f));
    setBusy(true);
    try { const t = await api(`/tasks/${task.id}/photo`, { method: 'POST', form }); onChange?.(t); toast('Photo ajoutée'); }
    catch (err) { toast(err.message, 'red'); }
    setBusy(false); e.target.value = '';
  }
  async function postpone() {
    try { const t = await api(`/tasks/${task.id}`, { method: 'PATCH', body: { date: addDays(today, 1) } }); onChange?.(t, 'moved'); toast('Reportée à demain'); }
    catch (err) { toast(err.message, 'red'); }
  }
  async function remove() {
    if (!confirm('Supprimer cette tâche ?')) return;
    try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); onChange?.(task, 'deleted'); } catch (err) { toast(err.message, 'red'); }
  }

  return (
    <div className={`task ${task.done_at ? 'done' : ''} ${late ? 'late' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      <button className={`check ${task.done_at ? 'on' : ''}`} onClick={toggle} disabled={readOnly} aria-pressed={!!task.done_at}
        aria-label={task.done_at ? `Décocher : ${task.title}` : `Cocher : ${task.title}`}>
        {task.done_at && <Check size={30} strokeWidth={3.5} />}
      </button>
      <div className="grow">
        <div className="t-title">{displayTitle(task, today)}</div>
        <div className="t-meta">
          {task.subject_short && <span className="tag">{task.subject_short}</span>}
          <span>{KIND_LABEL[task.kind] || 'Tâche'}</span>
          {showDate && <span>{shortDate(task.original_date)}</span>}
          {task.time && <span className="mono">{task.time}</span>}
          {task.focus_seconds > 0 && <span className="row" style={{ gap: 2 }}><Timer size={12} /> {Math.round(task.focus_seconds / 60)} min{task.focus_exits ? ` · ${task.focus_exits} sortie${task.focus_exits > 1 ? 's' : ''}` : ''}</span>}
          {task.source === 'parent' && <span className="tag"><UsersRound size={12} /> parents</span>}
          {task.carried > 0 && !late && <span className="tag">reportée {task.carried}×</span>}
          {late && <span className="tag solid red"><TriangleAlert size={12} /> en retard</span>}
        </div>
      </div>
      {task.photo && <img className="photo-thumb" src={`/uploads/${task.photo}`} alt="" onClick={() => setZoom(`/uploads/${task.photo}`)} />}
      {!readOnly && allowPhoto && (
        <>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Joindre une photo" disabled={busy}><Camera size={20} /></button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={upload} />
        </>
      )}
      {!readOnly && user.role !== 'parent' && !task.done_at && startFocus && (
        <button className="icon-btn play" onClick={() => startFocus(task)} aria-label={`Commencer : ${task.title}`} title="Commencer (mode concentration)"><Play size={20} fill="currentColor" /></button>
      )}
      {!readOnly && !allowPhoto && !task.done_at && task.date === today && (
        <button className="icon-btn plain" onClick={postpone} aria-label="Reporter à demain" title="Reporter à demain"><CalendarClock size={20} /></button>
      )}
      {canDelete && (
        <button className="icon-btn plain" onClick={remove} aria-label="Supprimer"><Trash2 size={18} /></button>
      )}
      {sfx && <span className="sfx" aria-hidden="true">FAIT !</span>}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

// ---------- Choix de matière / de date ----------
// Toutes les matières, spécialités d'abord, + « Autre matière » pour en ajouter une à la main
export function SubjectChips({ value, onChange, allowNone }) {
  const { subjects, reloadSubjects, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const list = [...subjects].sort((a, b) => b.is_spe - a.is_spe || a.position - b.position);
  async function add() {
    const n = name.trim();
    if (!n) return;
    const existing = subjects.find((s) => s.name.toLowerCase() === n.toLowerCase());
    if (existing) { onChange(existing.id); setAdding(false); setName(''); return; }
    setBusy(true);
    try {
      const { id } = await api('/subjects', { method: 'POST', body: { name: n } });
      await reloadSubjects();
      onChange(id); setAdding(false); setName('');
      toast(`Matière « ${n} » ajoutée`);
    } catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  }
  return (
    <div className="stack">
      <div className="chips">
        {allowNone && <button type="button" className={`chip ${!value ? 'on' : ''}`} onClick={() => onChange(null)}>Aucune</button>}
        {list.map((s) => (
          <button type="button" key={s.id} className={`chip ${value === s.id ? 'on' : ''}`} onClick={() => onChange(s.id)}>{s.name}</button>
        ))}
        {!adding && <button type="button" className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setAdding(true)}><Plus size={14} style={{ verticalAlign: -2 }} /> Autre matière</button>}
      </div>
      {adding && (
        <div className="row">
          <input className="input grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Philosophie, SVT, NSI, LLCER…" maxLength={40}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} aria-label="Nom de la matière" />
          <button type="button" className="btn" onClick={add} disabled={busy || !name.trim()}>Ajouter</button>
          <button type="button" className="icon-btn plain" onClick={() => { setAdding(false); setName(''); }} aria-label="Annuler"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}

export function DateChips({ value, onChange, future }) {
  const t = todayStr();
  const sat = addDays(t, (6 - weekday(t) + 7) % 7);
  const sun = addDays(t, (7 - weekday(t) + 7) % 7);
  const opts = future
    ? [[addDays(t, 1), 'Demain'], [addDays(t, 2), shortDate(addDays(t, 2))], [addDays(t, 7), 'Dans 1 semaine']]
    : [[t, "Aujourd'hui"], [addDays(t, 1), 'Demain'], [sat, sat === t ? 'Samedi (auj.)' : 'Samedi'], [sun, 'Dimanche']];
  const seen = new Set();
  return (
    <div className="stack">
      <div className="chips">
        {opts.filter(([d]) => !seen.has(d) && seen.add(d)).map(([d, l]) => (
          <button type="button" key={d + l} className={`chip ${value === d ? 'on' : ''}`} onClick={() => onChange(d)}>{l}</button>
        ))}
      </div>
      <input className="input" type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Autre date" />
    </div>
  );
}

// ---------- Bouton + : modèles de tâches et événements ----------
const TEMPLATES = [
  { id: 'revision_cours', icon: BookOpen, title: 'Réviser un cours', hint: 'Matière + chapitre' },
  { id: 'bac_francais', icon: FileText, title: 'Bac de français', hint: 'Texte n°…' },
  { id: 'refaire_ds', icon: RotateCcw, title: 'Refaire un DS', hint: "Ancien DS ou DS de l'an dernier" },
  { id: 'exercice', icon: PenLine, title: 'Exercice', hint: 'Page et numéro' },
  { id: 'autre', icon: Plus, title: 'Autre tâche', hint: 'Texte libre' },
  { id: 'event', icon: CalendarPlus, title: 'DS, bac blanc ou devoir', hint: 'À mettre dans l’agenda', wide: true },
];

export function AddSheet({ onClose, onDone, defaultDate }) {
  const { subjects, toast } = useApp();
  const [tpl, setTpl] = useState(null);
  const [subject, setSubject] = useState(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState(defaultDate || todayStr());
  const [evType, setEvType] = useState('ds');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sname = subjects.find((s) => s.id === subject)?.name;

  useEffect(() => {
    if (tpl === 'bac_francais') setSubject(subjects.find((s) => s.short === 'FR')?.id ?? null);
    if (tpl === 'event' && date <= todayStr()) setDate(addDays(todayStr(), 7));
  }, [tpl]); // eslint-disable-line react-hooks/exhaustive-deps

  function build() {
    const t = text.trim();
    switch (tpl) {
      case 'revision_cours': return subject ? { title: `Réviser le cours de ${sname}${t ? ` : ${t}` : ''}` } : { error: 'Choisis une matière.' };
      case 'bac_francais': return t ? { title: `Bac de français : texte n°${t.replace(/^n°\s*/i, '')}` } : { error: 'Indique le numéro du texte.' };
      case 'refaire_ds': return subject ? { title: `Refaire le DS de ${sname}${t ? ` : ${t}` : ''}` } : { error: 'Choisis une matière.' };
      case 'exercice': return subject ? { title: `Exercice de ${sname}${t ? ` : ${t}` : ''}` } : { error: 'Choisis une matière.' };
      default: return t ? { title: t } : { error: 'Écris la tâche.' };
    }
  }

  async function save(e) {
    e.preventDefault(); setErr('');
    setBusy(true);
    try {
      if (tpl === 'event') {
        if (!text.trim() && !subject) { setErr('Choisis une matière ou écris un titre.'); setBusy(false); return; }
        const title = text.trim() || `${EVENT_LABEL[evType]} de ${sname}`;
        await api('/events', { method: 'POST', body: { type: evType, title, subject_id: subject, date } });
        toast(`${EVENT_LABEL[evType]} ajouté à l'agenda`);
      } else {
        const { title, error } = build();
        if (error) { setErr(error); setBusy(false); return; }
        await api('/tasks', { method: 'POST', body: { title, kind: tpl, subject_id: subject, date } });
        toast('Tâche ajoutée');
      }
      onDone?.(); onClose();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (!tpl) {
    return (
      <Sheet title="Ajouter" onClose={onClose}>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className={`tpl ${t.wide ? 'wide' : ''}`} onClick={() => setTpl(t.id)}>
              <t.icon size={24} />
              <b>{t.title}</b>
              <span className="small muted">{t.hint}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  const current = TEMPLATES.find((t) => t.id === tpl);
  const placeholder = { revision_cours: 'Chapitre (facultatif)', bac_francais: 'Ex. 4', refaire_ds: 'Lequel ? (facultatif)', exercice: 'Ex. p. 112 n°34', autre: 'Ex. Ranger mes fiches de SES', event: 'Titre (facultatif), ex. DS dérivation' }[tpl];
  return (
    <Sheet title={current.title} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {tpl === 'event' && (
          <div>
            <label className="f">Type</label>
            <div className="chips">
              {['ds', 'bac_blanc', 'bac', 'devoir', 'oral'].map((k) => (
                <button type="button" key={k} className={`chip ${['ds', 'bac_blanc', 'bac'].includes(k) ? 'red' : ''} ${evType === k ? 'on' : ''}`} onClick={() => setEvType(k)}>{EVENT_LABEL[k]}</button>
              ))}
            </div>
          </div>
        )}
        {!['bac_francais', 'autre'].includes(tpl) && (
          <div><label className="f">Matière</label><SubjectChips value={subject} onChange={setSubject} /></div>
        )}
        <div>
          <label className="f" htmlFor="add-text">{tpl === 'bac_francais' ? 'Numéro du texte' : tpl === 'autre' ? 'Tâche' : 'Précision'}</label>
          <input id="add-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
            inputMode={tpl === 'bac_francais' ? 'numeric' : 'text'} autoComplete="off" />
        </div>
        <div><label className="f">{tpl === 'event' ? 'Date' : 'Quand ?'}</label><DateChips value={date} onChange={setDate} future={tpl === 'event'} /></div>
        {err && <div className="err">{err}</div>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setTpl(null)}>Retour</button>
          <button className="btn grow big" disabled={busy}>Ajouter</button>
        </div>
      </form>
    </Sheet>
  );
}
