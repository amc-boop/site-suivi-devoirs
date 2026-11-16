import { useState } from 'react';
import { api, ROLE_LABEL } from '../lib.js';
import { useApp } from '../ui.jsx';
import { NotificationsCard } from '../Notifications.jsx';

export default function Compte() {
  const { user, toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await api('/me/password', { method: 'POST', body: { current, next } }); toast('Mot de passe changé'); setCurrent(''); setNext(''); }
    catch (e2) { setErr(e2.message); }
  }
  return (
    <div className="page">
      <h1 className="h1">Mon compte</h1>
      <div className="panel section"><b>{user.display_name}</b><div className="small muted mono">{user.username} · {ROLE_LABEL[user.role]}</div></div>
      <NotificationsCard />
      <form className="panel section stack" onSubmit={save}>
        <b>Changer mon mot de passe</b>
        <div><label className="f" htmlFor="cur">Mot de passe actuel</label><input id="cur" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></div>
        <div><label className="f" htmlFor="nw">Nouveau mot de passe</label><input id="nw" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={6} required /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn">Enregistrer</button>
      </form>
      <div className="panel tone section small">
        <b>Installer l'appli sur le téléphone</b>
        <div style={{ marginTop: 4 }}>iPhone : ouvrir le site dans Safari, bouton Partager, puis « Sur l'écran d'accueil ». Android : menu de Chrome, puis « Installer l'application ».</div>
      </div>
    </div>
  );
}
