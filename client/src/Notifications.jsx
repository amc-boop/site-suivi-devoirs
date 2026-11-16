// Activer les notifications sur ce téléphone (rappel de 18 h pour l'élève, alertes pour les parents)
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Share, X } from 'lucide-react';
import { api } from './lib.js';
import { useApp } from './ui.jsx';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = (b64) => { const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

export function useNotifications() {
  const [state, setState] = useState('loading'); // loading | ios-install | unsupported | off | denied | on | disabled
  const [serverKey, setServerKey] = useState(null);
  const refresh = useCallback(async () => {
    if (!supported()) { setState(isIOS() && !isStandalone() ? 'ios-install' : 'unsupported'); return; }
    try {
      const st = await api('/push/status');
      if (!st.enabled) { setState('disabled'); return; }
      setServerKey(st.publicKey);
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    } catch { setState('unsupported'); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(serverKey) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    setState('on');
    return true;
  }
  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
    setState('off');
  }
  return { state, enable, disable, refresh };
}

// Carte complète (page Mon compte)
export function NotificationsCard() {
  const { toast, user } = useApp();
  const n = useNotifications();
  const [busy, setBusy] = useState(false);
  const what = user.role === 'eleve' ? 'Un rappel chaque jour à 18 h (tâches du soir, rendu du week-end le dimanche).' : 'Une alerte quand un rendu est incomplet ou oublié.';
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, 'red'); } setBusy(false); };
  return (
    <div className="panel section stack">
      <div className="row"><Bell size={20} /><b className="grow">Notifications sur ce téléphone</b></div>
      <div className="small muted">{what}</div>
      {n.state === 'on' && (
        <>
          <div className="small"><span className="flag ok"><Bell size={14} /> Activées</span></div>
          <div className="row">
            <button className="btn sm" disabled={busy} onClick={() => run(() => api('/push/test', { method: 'POST' }), 'Notification de test envoyée')}>Envoyer un test</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => run(n.disable, 'Notifications désactivées')}><BellOff size={16} /> Désactiver</button>
          </div>
        </>
      )}
      {n.state === 'off' && <button className="btn big block" disabled={busy} onClick={() => run(async () => { if (await n.enable()) await api('/push/test', { method: 'POST' }); }, 'Notifications activées')}><Bell size={20} /> Activer les notifications</button>}
      {n.state === 'ios-install' && <IosHelp />}
      {n.state === 'denied' && <div className="small warn-text">Les notifications sont bloquées pour ce site. Autorise-les dans les réglages du téléphone (Réglages → Notifications, ou les réglages du navigateur), puis reviens ici.</div>}
      {n.state === 'unsupported' && <div className="small muted">Ce navigateur ne gère pas les notifications. Sur Android, utilise Chrome ; sur iPhone, ajoute d’abord le site à l’écran d’accueil.</div>}
      {n.state === 'disabled' && <div className="small muted">Les notifications ne sont pas encore configurées sur le serveur.</div>}
    </div>
  );
}

function IosHelp() {
  return (
    <div className="small">
      Sur iPhone, les notifications marchent quand le site est installé :
      <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
        <li>dans Safari, touche <Share size={14} style={{ verticalAlign: -2 }} /> <b>Partager</b> ;</li>
        <li>choisis <b>« Sur l’écran d’accueil »</b> ;</li>
        <li>ouvre le site depuis la nouvelle icône, puis reviens ici.</li>
      </ol>
    </div>
  );
}

// Bandeau discret sur l'accueil / le bilan tant que les notifications ne sont pas activées
export function NotificationsBanner() {
  const { toast } = useApp();
  const n = useNotifications();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('notif-banner') === 'non'; } catch { return false; } });
  if (hidden || !['off', 'ios-install'].includes(n.state)) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem('notif-banner', 'non'); } catch { /* ignoré */ } };
  return (
    <div className="panel tone section" style={{ position: 'relative' }}>
      <button className="icon-btn plain" style={{ position: 'absolute', right: 6, top: 6 }} onClick={hide} aria-label="Masquer"><X size={18} /></button>
      <div className="row" style={{ paddingRight: 36 }}><Bell size={20} /><b>Recevoir les rappels sur ce téléphone</b></div>
      {n.state === 'off'
        ? <button className="btn block" style={{ marginTop: 10 }} onClick={async () => { try { if (await n.enable()) { await api('/push/test', { method: 'POST' }); toast('Notifications activées'); } } catch (e) { toast(e.message, 'red'); } }}><Bell size={18} /> Activer les notifications</button>
        : <div style={{ marginTop: 8 }}><IosHelp /></div>}
    </div>
  );
}
