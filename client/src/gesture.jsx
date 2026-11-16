import { useEffect, useRef } from 'react';

// Ruban d'outremer en fond de page (décoratif, coupé par le bord, derrière le contenu)
export function PageRibbon({ where = 'app' }) {
  const d = 'M 640 40 C 520 60, 470 150, 380 170 S 210 120, 150 210 S 230 330, 330 300 S 470 260, 520 360';
  return (
    <svg className={`page-ribbon ribbon-${where}`} viewBox="0 0 620 420" aria-hidden="true">
      <defs>
        <linearGradient id="ribbon-grad" x1="0" y1="0" x2="1" y2=".3">
          <stop offset="0" stopColor="#061440" /><stop offset=".18" stopColor="#0A2478" /><stop offset=".42" stopColor="#1450B8" />
          <stop offset=".58" stopColor="#3C86DD" /><stop offset=".74" stopColor="#1450B8" /><stop offset="1" stopColor="#0A2478" />
        </linearGradient>
        <filter id="dry-brush" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.9" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter="url(#dry-brush)">
        <path className="r-main" d={d} pathLength="1" />
        {[-18, -6, 8, 20].map((o) => <path key={o} className="r-hair" d={d} pathLength="1" transform={`translate(0 ${o})`} />)}
      </g>
    </svg>
  );
}

// Traînée de pinceau derrière le pointeur : souris uniquement, coupée si mouvement réduit
export function BrushTrail() {
  const ref = useRef(null);
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = ref.current, g = c.getContext('2d');
    const resize = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; };
    resize(); addEventListener('resize', resize);
    const pts = [], BRISTLES = 10, LIFE = 900;
    const move = (e) => { if (e.pointerType === 'mouse') pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }); };
    addEventListener('pointermove', move);
    let raf;
    const frame = (now) => {
      g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      g.clearRect(0, 0, innerWidth, innerHeight);
      while (pts.length && now - pts[0].t > LIFE) pts.shift();
      if (pts.length > 1) for (let b = 0; b < BRISTLES; b++) {
        const off = (b - BRISTLES / 2) * 1.4;
        g.beginPath();
        pts.forEach((p, i) => {
          const n = pts[i + 1] || p, a = Math.atan2(n.y - p.y, n.x - p.x) + Math.PI / 2;
          const x = p.x + Math.cos(a) * off, y = p.y + Math.sin(a) * off;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.strokeStyle = `hsla(222, 80%, ${28 + (b % 5) * 7}%, .4)`;
        g.lineWidth = 1.2; g.lineCap = 'round'; g.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('pointermove', move); };
  }, []);
  return <canvas id="trail" ref={ref} aria-hidden="true" />;
}

// Fond : le tableau du ruban qui défile lentement de droite à gauche (copies espacées, bord gauche estompé), et qui remonte un peu moins vite que la page quand on fait défiler (parallaxe).
export function ScrollBackdrop() {
  const ref = useRef(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (ref.current) ref.current.style.transform = `translate3d(0, ${-scrollY * 0.25}px, 0)`; });
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => { removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-y" ref={ref}>
        <div className="backdrop-strip">
          {[0, 1, 2, 3].map((i) => <img key={i} src="/fond-ruban.jpg" alt="" draggable="false" />)}
        </div>
      </div>
    </div>
  );
}
