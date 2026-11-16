// Série, niveau, points et badges : la partie « jeu ».
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flame, Award, Lock, ChevronRight, Trophy } from 'lucide-react';
import { api } from '../lib.js';
import { useApp, Skeleton, useAutoRefresh } from '../ui.jsx';

export function useProgress() {
  const [p, setP] = useState(null);
  const load = useCallback(() => api('/progress').then(setP).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);
  return p;
}

// Petite fête quand un niveau est passé (une seule fois par niveau, sur ce téléphone)
function LevelUp({ p }) {
  const { user } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!p || user.role === 'parent') return;
    let last = 0;
    try { last = Number(localStorage.getItem('niveau-vu') || 0); } catch { /* ignoré */ }
    if (last && p.level > last) { setShow(true); navigator.vibrate?.([60, 40, 60]); setTimeout(() => setShow(false), 2800); }
    try { localStorage.setItem('niveau-vu', String(p.level)); } catch { /* ignoré */ }
  }, [p?.level]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show) return null;
  return createPortal(
    <div className="levelup" role="status" onClick={() => setShow(false)}>
      <div className="levelup-burst"><div className="levelup-sfx">NIVEAU {p.level} !</div><div className="levelup-title">{p.title}</div></div>
    </div>, document.body);
}

// Carte compacte : accueil (élève) et bilan (parents)
export function ProgressCard({ p }) {
  const { user } = useApp();
  if (!p) return null;
  const who = user.role === 'parent' ? 'Martin' : 'Toi';
  return (
    <>
      <LevelUp p={p} />
      <a href="#/progression" className="prog-card section" aria-label="Voir la progression">
        <div className={`prog-streak ${p.streak > 0 ? 'on' : ''}`}>
          <Flame size={26} strokeWidth={2.5} />
          <div><div className="prog-streak-n">{p.streak}</div><div className="prog-streak-l">{p.streak > 1 ? 'jours' : 'jour'}</div></div>
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}><span className="prog-lvl">Niv. {p.level}</span><b className="prog-title">{p.title}</b></div>
          <div className="bar" style={{ marginTop: 6 }}><span style={{ transform: `scaleX(${p.into / p.need})` }} /></div>
          <div className="small muted" style={{ marginTop: 2 }}>{p.into}/{p.need} pts · {who === 'Toi' ? 'record' : 'record de Martin'} : {p.best} j</div>
        </div>
        <ChevronRight size={20} />
      </a>
    </>
  );
}

export default function Progression() {
  const p = useProgress();
  const { user } = useApp();
  if (!p) return <div className="page"><Skeleton n={4} /></div>;
  const earned = p.badges.filter((b) => b.earned).length;
  const parent = user.role === 'parent';
  return (
    <div className="page">
      <h1 className="h1">Progression</h1>
      <LevelUp p={p} />

      <div className="hero section" style={{ textAlign: 'center' }}>
        <div className="label">{parent ? 'Série de Martin' : 'Ta série'}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 10 }}><Flame size={54} strokeWidth={2.5} /><span className="big">{p.streak} {p.streak > 1 ? 'JOURS' : 'JOUR'}</span></div>
        <div className="small" style={{ opacity: 0.85 }}>de suite avec tous les rendus complets · record : {p.best} jour{p.best > 1 ? 's' : ''}</div>
      </div>

      <div className="panel section">
        <div className="row"><Trophy size={22} /><b className="grow">Niveau {p.level} · {p.title}</b><span className="mono small">{p.xp} pts</span></div>
        <div className="bar" style={{ marginTop: 10 }}><span style={{ transform: `scaleX(${p.into / p.need})` }} /></div>
        <div className="small muted" style={{ marginTop: 4 }}>Encore {p.next - p.xp} points pour le niveau {p.level + 1}</div>
      </div>

      <div className="section">
        <div className="section-head"><h2 className="h2">Badges</h2><span className="aside">{earned}/{p.badges.length}</span></div>
        <div className="badges">
          {p.badges.map((b) => (
            <div key={b.id} className={`badge ${b.earned ? 'on' : ''}`} title={b.desc}>
              {b.earned ? <Award size={28} /> : <Lock size={24} />}
              <b>{b.label}{b.count > 1 ? ` ×${b.count}` : ''}</b>
              <span className="small">{b.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section panel flat small">
        <b>Comment gagner des points</b>
        <table className="table" style={{ marginTop: 6 }}>
          <tbody>
            <tr><td>Une tâche faite</td><td className="mono" style={{ textAlign: 'right' }}>+{p.points.task}</td></tr>
            <tr><td>Un rendu du jour complet</td><td className="mono" style={{ textAlign: 'right' }}>+{p.points.dayReport}</td></tr>
            <tr><td>Un rendu du week-end complet</td><td className="mono" style={{ textAlign: 'right' }}>+{p.points.weekendReport}</td></tr>
            <tr><td>Le quiz de la semaine réussi</td><td className="mono" style={{ textAlign: 'right' }}>+{p.points.quizPassed}</td></tr>
            <tr><td>25 min en mode concentration</td><td className="mono" style={{ textAlign: 'right' }}>+{p.points.focus25}</td></tr>
            <tr><td>Semaine validée par les parents</td><td className="mono" style={{ textAlign: 'right' }}>+{p.points.weekValidated}</td></tr>
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 6 }}>La série compte les jours d’affilée avec un rendu complet (toutes les tâches prévues cochées). Le week-end compte pour 2 jours. Un jour sans aucune tâche prévue ne casse pas la série.</div>
      </div>
    </div>
  );
}
