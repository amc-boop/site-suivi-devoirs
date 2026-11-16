import { useState } from 'react';
import { api } from '../lib.js';
import { PageRibbon, BrushTrail } from '../gesture.jsx';

export default function Login({ onLogin }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api('/login', { method: 'POST', body: { username, password } }); window.location.hash = ''; onLogin(); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  return (
    <div className="login">
      <PageRibbon where="login" />
      <BrushTrail />
      <form className="panel stack" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div className="label muted">Première générale · Maths · SES · Physique</div>
        <div className="h1">Sui<em>vi</em></div>
        <div className="speech small">Tracer. Réviser. Rendre. Les devoirs, les DS et le bac au même endroit.</div>
        <div style={{ height: 6 }} />
        <div><label className="f" htmlFor="u">Identifiant</label><input id="u" className="input" value={username} onChange={(e) => setU(e.target.value)} autoCapitalize="none" autoComplete="username" required /></div>
        <div><label className="f" htmlFor="p">Mot de passe</label><input id="p" className="input" type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn block big" disabled={busy}>Entrer</button>
      </form>
    </div>
  );
}
