import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Sun, CalendarDays, Send, LineChart, Brain, ClipboardCheck, Gift, Settings, LogOut, UserRound, Clock, CircleCheck, TriangleAlert } from 'lucide-react';
import { api, ROLE_LABEL } from './lib.js';
import { AppCtx, Skeleton, useAutoRefresh } from './ui.jsx';
import { FocusScreen, savedFocus, startFocusSession } from './Focus.jsx';
import Login from './pages/Login.jsx';
import Today from './pages/Today.jsx';
import Agenda from './pages/Agenda.jsx';
import Rendu from './pages/Rendu.jsx';
import Notes from './pages/Notes.jsx';
import Quiz from './pages/Quiz.jsx';
import Bilan from './pages/Bilan.jsx';
import Rewards from './pages/Rewards.jsx';
import Admin from './pages/Admin.jsx';
import Compte from './pages/Compte.jsx';
import Edt from './pages/Edt.jsx';
import Progression from './pages/Progression.jsx';
import { ScrollBackdrop, BrushTrail } from './gesture.jsx';

const NAV = {
  eleve: [['/', 'Aujourd’hui', Sun], ['/agenda', 'Agenda', CalendarDays], ['/rendu', 'Rendu', Send], ['/notes', 'Notes', LineChart], ['/quiz', 'Quiz', Brain]],
  parent: [['/bilan', 'Bilan', ClipboardCheck], ['/agenda', 'Agenda', CalendarDays], ['/edt', 'Emploi du t.', Clock], ['/recompenses', 'Récomp.', Gift], ['/notes', 'Notes', LineChart]],
  admin: [['/', 'Aujourd’hui', Sun], ['/agenda', 'Agenda', CalendarDays], ['/bilan', 'Bilan', ClipboardCheck], ['/recompenses', 'Récomp.', Gift], ['/admin', 'Réglages', Settings]],
};
const PAGES = { '/': Today, '/agenda': Agenda, '/rendu': Rendu, '/notes': Notes, '/quiz': Quiz, '/bilan': Bilan, '/recompenses': Rewards, '/admin': Admin, '/compte': Compte, '/edt': Edt, '/progression': Progression };

const useRoute = () => {
  const get = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [route, setRoute] = useState(get);
  useEffect(() => { const f = () => {
      const go = () => { setRoute(get()); window.scrollTo(0, 0); };
      // Transition « coup de pinceau » quand le navigateur sait faire
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => flushSync(go)); else go();
    }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return route;
};

export default function App() {
  const [me, setMe] = useState(undefined);
  const [subjects, setSubjects] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);
  // Tâche en cours (mode concentration) : reprise automatique après un rechargement
  const [focus, setFocus] = useState(() => savedFocus());
  const route = useRoute();

  const load = useCallback(async () => {
    try {
      const r = await api('/me');
      setMe(r);
      if (r.user) setSubjects(await api('/subjects'));
    } catch { setMe({ user: null }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Nombre d'alertes (pastille rouge sur « Bilan » pour les parents), tenu à jour
  const refreshAlerts = useCallback(() => api('/me').then((r) => setMe((m) => (m?.user ? { ...m, alerts: r.alerts } : m))).catch(() => {}), []);
  useAutoRefresh(refreshAlerts);
  useEffect(() => { const f = () => setMe((m) => ({ ...m, user: null })); window.addEventListener('auth-lost', f); return () => window.removeEventListener('auth-lost', f); }, []);

  const toast = useCallback((msg, tone) => { setToastMsg({ msg, tone, id: Date.now() }); }, []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(null), 2600); return () => clearTimeout(t); }, [toastMsg]);

  if (me === undefined) return <div className="page"><Skeleton n={4} /></div>;
  if (!me.user) return <Login onLogin={load} />;

  const user = me.user;
  const nav = NAV[user.role];
  // Page d'accueil selon le rôle
  let path = route;
  if (user.role === 'parent' && path === '/') path = '/bilan';
  const Page = PAGES[path] || PAGES['/'];

  async function logout() {
    // Ce téléphone arrête de recevoir les notifications du compte qui se déconnecte
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
    } catch { /* pas de notifications sur cet appareil */ }
    await api('/logout', { method: 'POST' }).catch(() => {});
    setMe({ user: null }); window.location.hash = '';
  }

  return (
    <AppCtx.Provider value={{ user, subjects, refreshAlerts, startFocus: user.role === 'parent' ? null : (t) => setFocus(startFocusSession(t)), reloadSubjects: async () => setSubjects(await api('/subjects')), toast, quizEnabled: me.quizEnabled }}>
      <ScrollBackdrop />
      <BrushTrail />
      <div className="app">
        <header className="topbar">
          <span className="brand">Sui<em>vi</em></span>
          <span className="who">{user.display_name} · {ROLE_LABEL[user.role]}</span>
          <a className="icon-btn plain" href="#/compte" aria-label="Mon compte"><UserRound size={20} /></a>
          <button className="icon-btn plain" onClick={logout} aria-label="Se déconnecter"><LogOut size={20} /></button>
        </header>
        <main key={path}><Page /></main>
        <nav className="nav" aria-label="Navigation principale">
          {nav.map(([href, label, Icon]) => (
            <a key={href} href={`#${href}`} className={path === href ? 'on' : ''} aria-current={path === href ? 'page' : undefined}>
              <span className="nav-ico"><Icon size={20} />{href === '/bilan' && me.alerts > 0 && <span className="dot" aria-label={`${me.alerts} alerte(s)`} />}</span>{label}
            </a>
          ))}
        </nav>
        {focus && user.role !== 'parent' && (
          <FocusScreen session={focus} toast={toast} onClose={(t, done) => {
            setFocus(null);
            toast(done ? 'FAIT ! Bien joué.' : 'Tâche mise en pause', done ? undefined : 'red');
            window.dispatchEvent(new Event('suivi-refresh'));
          }} />
        )}
        {toastMsg && <div key={toastMsg.id} className={`toast ${toastMsg.tone || ''}`} role="status">{toastMsg.tone === 'red' ? <TriangleAlert size={18} /> : <CircleCheck size={18} />}{toastMsg.msg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
