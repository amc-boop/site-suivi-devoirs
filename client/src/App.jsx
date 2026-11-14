import { useCallback, useEffect, useState } from 'react';
import { Sun, CalendarDays, Send, LineChart, Brain, ClipboardCheck, Gift, Settings, LogOut, UserRound } from 'lucide-react';
import { api, ROLE_LABEL } from './lib.js';
import { AppCtx, Skeleton } from './ui.jsx';
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

const NAV = {
  eleve: [['/', 'Aujourd’hui', Sun], ['/agenda', 'Agenda', CalendarDays], ['/rendu', 'Rendu', Send], ['/notes', 'Notes', LineChart], ['/quiz', 'Quiz', Brain]],
  parent: [['/bilan', 'Bilan', ClipboardCheck], ['/recompenses', 'Récompenses', Gift], ['/notes', 'Notes', LineChart], ['/agenda', 'Agenda', CalendarDays]],
  admin: [['/', 'Aujourd’hui', Sun], ['/agenda', 'Agenda', CalendarDays], ['/bilan', 'Bilan', ClipboardCheck], ['/recompenses', 'Récomp.', Gift], ['/admin', 'Réglages', Settings]],
};
const PAGES = { '/': Today, '/agenda': Agenda, '/rendu': Rendu, '/notes': Notes, '/quiz': Quiz, '/bilan': Bilan, '/recompenses': Rewards, '/admin': Admin, '/compte': Compte };

const useRoute = () => {
  const get = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [route, setRoute] = useState(get);
  useEffect(() => { const f = () => { setRoute(get()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return route;
};

export default function App() {
  const [me, setMe] = useState(undefined);
  const [subjects, setSubjects] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);
  const route = useRoute();

  const load = useCallback(async () => {
    try {
      const r = await api('/me');
      setMe(r);
      if (r.user) setSubjects(await api('/subjects'));
    } catch { setMe({ user: null }); }
  }, []);
  useEffect(() => { load(); }, [load]);
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

  async function logout() { await api('/logout', { method: 'POST' }).catch(() => {}); setMe({ user: null }); window.location.hash = ''; }

  return (
    <AppCtx.Provider value={{ user, subjects, reloadSubjects: async () => setSubjects(await api('/subjects')), toast, quizEnabled: me.quizEnabled }}>
      <div className="app">
        <header className="topbar">
          <span className="brand">SUIVI !</span>
          <span className="who">{user.display_name} · {ROLE_LABEL[user.role]}</span>
          <a className="icon-btn plain" href="#/compte" aria-label="Mon compte"><UserRound size={20} /></a>
          <button className="icon-btn plain" onClick={logout} aria-label="Se déconnecter"><LogOut size={20} /></button>
        </header>
        <main key={path} style={{ animation: 'fade .2s ease-out' }}><Page /></main>
        <nav className="nav" aria-label="Navigation principale">
          {nav.map(([href, label, Icon]) => (
            <a key={href} href={`#${href}`} className={path === href ? 'on' : ''} aria-current={path === href ? 'page' : undefined}>
              <span className="nav-ico"><Icon size={20} /></span>{label}
            </a>
          ))}
        </nav>
        {toastMsg && <div key={toastMsg.id} className={`toast ${toastMsg.tone || ''}`} role="status">{toastMsg.msg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
