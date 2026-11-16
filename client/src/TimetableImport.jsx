// Import de l'emploi du temps depuis une photo (ou une capture Pronote) : lecture par Gemini,
// puis aperçu modifiable avant d'enregistrer. Rien n'est enregistré tant qu'on n'a pas validé.
import { useRef, useState } from 'react';
import { Camera, ImagePlus, X, Check, RotateCcw, TriangleAlert } from 'lucide-react';
import { api, compressImage, DAYS } from './lib.js';
import { useApp, Sheet } from './ui.jsx';

export default function TimetableImport({ onClose, onSaved, hasExisting }) {
  const { toast, quizEnabled, reloadSubjects } = useApp();
  const camRef = useRef(null), fileRef = useRef(null);
  const [step, setStep] = useState('photo'); // photo | reading | review
  const [slots, setSlots] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function read(e) {
    const files = [...(e.target.files || [])].slice(0, 3);
    e.target.value = '';
    if (!files.length) return;
    setErr(''); setStep('reading');
    try {
      const form = new FormData();
      // Garder une bonne résolution : le texte d'un emploi du temps est petit
      for (const f of files) form.append('photos', await compressImage(f, 2400, 0.88));
      const r = await api('/timetable/import', { method: 'POST', form });
      setSlots(r.slots.map((s, i) => ({ ...s, key: i })));
      setSubjects(r.subjects);
      setStep('review');
    } catch (e2) { setErr(e2.message); setStep('photo'); }
  }

  const update = (key, patch) => setSlots((l) => l.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const remove = (key) => setSlots((l) => l.filter((s) => s.key !== key));
  const unknown = slots.filter((s) => !s.subject_id).length;
  const weekB = slots.some((s) => s.week === 'B');

  async function save() {
    if (hasExisting && !confirm('Remplacer l’emploi du temps actuel par celui-ci ?')) return;
    setBusy(true);
    try {
      const r = await api('/timetable/replace', { method: 'POST', body: { slots: slots.map(({ key, label, week, ...s }) => s) } });
      await reloadSubjects();
      toast(`Emploi du temps enregistré : ${r.count} cours${r.newSubjects.length ? ` (+ ${r.newSubjects.length} matière${r.newSubjects.length > 1 ? 's' : ''})` : ''}`);
      onSaved?.(); onClose();
    } catch (e) { toast(e.message, 'red'); }
    setBusy(false);
  }

  if (!quizEnabled) {
    return (
      <Sheet title="Emploi du temps en photo" onClose={onClose}>
        <div className="panel tone small">La lecture des photos utilise Gemini, qui n'est pas activé (clé GEMINI_API_KEY manquante). Tu peux saisir l'emploi du temps à la main dans les réglages.</div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Emploi du temps en photo" onClose={onClose}>
      {step !== 'review' ? (
        <div className="stack">
          <div className="small">Prends en photo ton emploi du temps (papier ou écran de Pronote), ou choisis une capture d'écran. Tu pourras tout vérifier avant d'enregistrer.</div>
          <div className="small muted">Conseil : photo bien droite, tous les jours et les heures visibles. Jusqu'à 3 photos si l'emploi du temps est en plusieurs morceaux.</div>
          <button className="btn big block" onClick={() => camRef.current?.click()} disabled={step === 'reading'}><Camera size={22} /> Prendre en photo</button>
          <button className="btn ghost big block" onClick={() => fileRef.current?.click()} disabled={step === 'reading'}><ImagePlus size={22} /> Choisir une capture / une photo</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={read} />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={read} />
          {step === 'reading' && <div aria-busy="true"><div className="skeleton" /><div className="small muted center" style={{ marginTop: 8 }}>Lecture de l'emploi du temps… (quelques secondes)</div></div>}
          {err && <div className="err"><TriangleAlert size={16} /> {err}</div>}
        </div>
      ) : (
        <div className="stack">
          <div className="small"><b>{slots.length} cours trouvés.</b> Vérifie les horaires et les matières, corrige si besoin, puis enregistre.</div>
          {unknown > 0 && <div className="small warn-text"><TriangleAlert size={16} /> {unknown} matière{unknown > 1 ? 's' : ''} non reconnue{unknown > 1 ? 's' : ''} : choisis-la dans la liste ou garde le nom proposé (elle sera créée).</div>}
          {weekB && <div className="small muted">Certains cours n'ont lieu qu'une semaine sur deux (A ou B) : ils seront affichés toutes les semaines. Retire ceux que tu ne veux pas.</div>}
          {[1, 2, 3, 4, 5, 6].map((wd) => {
            const list = slots.filter((s) => s.weekday === wd);
            if (!list.length) return null;
            return (
              <div key={wd} className="panel flat">
                <b>{DAYS[wd]}</b>
                {list.map((s) => (
                  <div key={s.key} className="tt-row">
                    <input className="input mono" type="time" value={s.start} onChange={(e) => update(s.key, { start: e.target.value })} aria-label="Début" />
                    <input className="input mono" type="time" value={s.end} onChange={(e) => update(s.key, { end: e.target.value })} aria-label="Fin" />
                    <select className={`input tt-subj ${s.subject_id ? '' : 'unknown'}`} value={s.subject_id || ''} aria-label="Matière"
                      onChange={(e) => update(s.key, { subject_id: e.target.value ? Number(e.target.value) : null })}>
                      {!s.subject_id && <option value="">Nouvelle : {s.new_subject}</option>}
                      {subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <span className="small muted tt-label" title="Texte lu sur la photo">{s.label}{s.room ? ` · ${s.room}` : ''}{s.week ? ` · sem. ${s.week}` : ''}</span>
                    <button className="icon-btn plain" onClick={() => remove(s.key)} aria-label="Retirer ce cours"><X size={18} /></button>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="row">
            <button className="btn ghost" onClick={() => setStep('photo')}><RotateCcw size={18} /> Autre photo</button>
            <button className="btn green grow big" onClick={save} disabled={busy || !slots.length}><Check size={20} /> Enregistrer ({slots.length} cours)</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
