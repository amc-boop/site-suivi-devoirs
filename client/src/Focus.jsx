// Mode concentration : pendant une tâche, l'écran reste figé en rouge sur « NO WORK, NO PORSCHE !! ».
// - plein écran et écran toujours allumé quand le téléphone le permet
// - le bouton retour ne fait pas sortir, et l'écran revient après un rechargement
// - chaque sortie de l'appli est comptée (visible par les parents)
// - on ne sort qu'en finissant la tâche, ou en restant appuyé 3 secondes sur « Abandonner »
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pause } from 'lucide-react';
import { api } from './lib.js';

const KEY = 'focus-en-cours';
export const savedFocus = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function FocusScreen({ session, onClose, toast }) {
  const { task } = session;
  const [now, setNow] = useState(Date.now());
  const [exits, setExits] = useState(session.exits || 0);
  const [back, setBack] = useState(null); // message affiché au retour dans l'appli
  const [hold, setHold] = useState(0);
  const holdRef = useRef(null);
  const exitsRef = useRef(exits);
  exitsRef.current = exits;
  const elapsed = Math.max(0, Math.round((now - session.startedAt) / 1000));
  const goal = (task.duration || 30) * 60;

  useEffect(() => { save({ ...session, exits }); }, [exits]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Écran toujours allumé
    let lock = null;
    const takeLock = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    takeLock();
    // Plein écran (Android ; sur iPhone, l'appli installée est déjà en plein écran)
    document.documentElement.requestFullscreen?.().catch(() => {});
    // Le bouton retour ne fait pas quitter
    history.pushState({ focus: true }, '');
    const onPop = () => { history.pushState({ focus: true }, ''); setBack('Pas de retour en arrière : finis ta tâche !'); };
    // Quitter l'appli = une sortie comptée
    const onVis = () => {
      if (document.hidden) setExits((n) => n + 1);
      else { takeLock(); setBack(`Tu es sorti ${exitsRef.current} fois. Reste concentré !`); }
    };
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onUnload);
    document.body.style.overflow = 'hidden';
    return () => {
      clearInterval(tick);
      lock?.release?.().catch(() => {});
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
      document.body.style.overflow = '';
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!back) return undefined; const t = setTimeout(() => setBack(null), 3500); return () => clearTimeout(t); }, [back]);

  async function finish(done) {
    const body = { focus: { seconds: elapsed, exits } };
    if (done) body.done = true;
    try {
      const t = await api(`/tasks/${task.id}`, { method: 'PATCH', body });
      save(null);
      navigator.vibrate?.([40, 60, 40]);
      onClose(t, done);
    } catch (e) { toast?.(e.message, 'red'); }
  }

  // Abandon : appui long de 3 secondes
  const startHold = () => {
    const t0 = Date.now();
    holdRef.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 3000);
      setHold(p);
      if (p >= 1) { clearInterval(holdRef.current); setHold(0); finish(false); }
    }, 50);
  };
  const stopHold = () => { clearInterval(holdRef.current); setHold(0); };

  return createPortal(
    <div className="focus" role="dialog" aria-modal="true" aria-label="Tâche en cours">
      <div className="focus-lines" aria-hidden="true" />
      <div className="focus-inner">
        <div className="focus-sfx">NO WORK,<br />NO PORSCHE !!</div>
        <div className="focus-task">{task.title}</div>
        <div className="focus-time mono" aria-live="off">{fmt(elapsed)}</div>
        <div className="focus-goal">
          <div className="focus-bar"><span style={{ transform: `scaleX(${Math.min(1, elapsed / goal)})` }} /></div>
          <div className="small">{elapsed >= goal ? 'Objectif atteint : termine et coche !' : `Objectif : ${task.duration || 30} min`}{exits > 0 ? ` · ${exits} sortie${exits > 1 ? 's' : ''}` : ''}</div>
        </div>
        {back && <div className="focus-back" role="alert">{back}</div>}
        <button className="btn green big block focus-done" onClick={() => finish(true)}><Check size={24} strokeWidth={3} /> C'est fait !</button>
        <button className="focus-quit" onPointerDown={startHold} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}
          onContextMenu={(e) => e.preventDefault()} aria-label="Abandonner : rester appuyé 3 secondes">
          <span className="focus-quit-fill" style={{ transform: `scaleX(${hold})` }} />
          <Pause size={16} /> {hold > 0 ? 'Tiens bon… ou lâche pour continuer' : 'Abandonner (rester appuyé 3 s)'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export const startFocusSession = (task) => {
  const s = { task: { id: task.id, title: task.title, duration: task.duration }, startedAt: Date.now(), exits: 0 };
  save(s);
  return s;
};
