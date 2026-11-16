import { useEffect, useRef } from 'react';

// Fond : le tableau du ruban bleu qui défile lentement de droite à gauche,
// et qui remonte moins vite que la page quand on fait défiler (parallaxe).
export default function Backdrop() {
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
