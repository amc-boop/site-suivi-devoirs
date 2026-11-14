import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Brain, Play, Trash2, X, Lock } from 'lucide-react';
import { api } from '../lib.js';
import { useApp, Skeleton, Empty, SubjectChips, Bar } from '../ui.jsx';

function Player({ id, onExit }) {
  const { toast } = useApp();
  const [quiz, setQuiz] = useState(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState(0);
  const [end, setEnd] = useState(false);
  useEffect(() => { api(`/quizzes/${id}`).then(setQuiz).catch((e) => { toast(e.message, 'red'); onExit(); }); }, [id]); // eslint-disable-line

  if (!quiz) return <Skeleton n={4} />;
  const q = quiz.questions[i];
  const total = quiz.questions.length;

  function pick(k) { if (picked != null) return; setPicked(k); if (k === q.bonne) setScore((s) => s + 1); }
  function next() {
    if (i + 1 < total) { setI(i + 1); setPicked(null); return; }
    setEnd(true);
    api(`/quizzes/${id}/score`, { method: 'POST', body: { score } }).catch(() => {});
  }

  if (end) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="panel center section">
        <div className="h1" style={{ color: pct >= 70 ? 'var(--green)' : pct < 50 ? 'var(--red)' : undefined, transform: 'rotate(-3deg)', fontSize: '3rem' }}>
          {pct >= 70 ? 'BIEN JOUÉ !' : pct >= 50 ? 'PAS MAL !' : 'ON REMET ÇA ?'}
        </div>
        <div className="stat" style={{ marginTop: 8 }}>{score} / {total}</div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'center' }}>
          <button className="btn ghost" onClick={() => { setI(0); setPicked(null); setScore(0); setEnd(false); }}>Recommencer</button>
          <button className="btn" onClick={onExit}>Terminer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="row">
        <span className="small muted grow">{quiz.subject_name} · {quiz.chapter}</span>
        <span className="mono small">{i + 1}/{total}</span>
        <button className="icon-btn plain" onClick={onExit} aria-label="Quitter le quiz"><X size={20} /></button>
      </div>
      <div style={{ margin: '6px 0 14px' }}><Bar value={(i / total) * 100} /></div>
      <div className="speech" style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 24 }}>{q.question}</div>
      {q.choix.map((c, k) => (
        <button key={k} className={`quiz-choice ${picked != null && k === q.bonne ? 'good' : ''} ${picked === k && k !== q.bonne ? 'bad' : ''}`} onClick={() => pick(k)} disabled={picked != null && false}>
          {c}
        </button>
      ))}
      {picked != null && (
        <div className={`panel section ${picked === q.bonne ? 'green' : 'red'}`}>
          <b>{picked === q.bonne ? 'Bonne réponse !' : 'Raté.'}</b>
          <div className="small" style={{ marginTop: 4 }}>{q.explication}</div>
          <button className="btn block" style={{ marginTop: 12 }} onClick={next}>{i + 1 < total ? 'Question suivante' : 'Voir mon score'}</button>
        </div>
      )}
    </div>
  );
}

export default function Quiz() {
  const { quizEnabled, toast, user } = useApp();
  const [list, setList] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [subject, setSubject] = useState(null);
  const [chapter, setChapter] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const load = useCallback(() => api('/quizzes').then(setList).catch((e) => toast(e.message, 'red')), [toast]);
  useEffect(() => { load(); }, [load]);

  async function generate(e) {
    e.preventDefault(); setErr('');
    if (!subject) return setErr('Choisis une matière.');
    if (!files.length) return setErr('Prends au moins une photo du cours.');
    const form = new FormData();
    form.append('subject_id', subject); form.append('chapter', chapter);
    files.forEach((f) => form.append('photos', f));
    setBusy(true);
    try { const r = await api('/quizzes', { method: 'POST', form }); setFiles([]); setChapter(''); await load(); setPlaying(r.id); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  async function del(q) { if (!confirm('Supprimer ce quiz ?')) return; await api(`/quizzes/${q.id}`, { method: 'DELETE' }).catch(() => {}); load(); }

  if (playing) return <div className="page"><Player id={playing} onExit={() => { setPlaying(null); load(); }} /></div>;

  return (
    <div className="page">
      <h1 className="h1">Quiz</h1>
      <div className="small muted">Prends ton cours en photo, l'appli en fait un quiz.</div>

      {!quizEnabled ? (
        <div className="panel tone section">
          <div className="row"><Lock size={20} /><b>Quiz pas encore activé</b></div>
          <div className="small" style={{ marginTop: 6 }}>
            {user.role === 'admin'
              ? <>Ajoute une clé gratuite Gemini (aistudio.google.com) dans le fichier <span className="mono">.env</span> : <span className="mono">GEMINI_API_KEY=…</span>, puis relance le serveur.</>
              : 'Demande à Alexandre de l’activer.'}
          </div>
        </div>
      ) : (
        <form className="panel section stack" onSubmit={generate}>
          <div><label className="f">Matière</label><SubjectChips value={subject} onChange={setSubject} onlySpe /></div>
          <div><label className="f" htmlFor="qc">Chapitre</label><input id="qc" className="input" value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="Ex. Dérivation" /></div>
          <div>
            <button type="button" className="btn ghost block big" onClick={() => fileRef.current?.click()}><Camera size={22} /> {files.length ? `${files.length} photo${files.length > 1 ? 's' : ''} (ajouter)` : 'Prendre le cours en photo'}</button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setFiles((l) => [...l, f].slice(0, 4)); e.target.value = ''; }} />
            {files.length > 0 && (
              <div className="row wrap" style={{ marginTop: 8 }}>
                {files.map((f, k) => <img key={k} className="photo-thumb" src={URL.createObjectURL(f)} alt={`Photo ${k + 1}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== k))} title="Toucher pour retirer" />)}
              </div>
            )}
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn big block" disabled={busy}><Brain size={22} /> {busy ? 'Préparation du quiz…' : 'Créer le quiz'}</button>
        </form>
      )}

      <div className="section">
        <div className="section-head"><h2 className="h2">Mes quiz</h2></div>
        {!list ? <Skeleton n={2} /> : list.length === 0 ? <Empty>Aucun quiz pour l'instant.</Empty> : list.map((q) => (
          <div key={q.id} className="event">
            <div className="grow"><b>{q.chapter}</b><div className="small muted">{q.subject_name} · {q.count} questions{q.best_score != null ? ` · meilleur score ${q.best_score}/${q.count}` : ''}</div></div>
            <button className="icon-btn" onClick={() => setPlaying(q.id)} aria-label="Jouer"><Play size={18} /></button>
            {user.role !== 'parent' && <button className="icon-btn plain" onClick={() => del(q)} aria-label="Supprimer"><Trash2 size={16} /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
