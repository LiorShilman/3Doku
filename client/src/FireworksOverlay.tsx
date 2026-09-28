import { useMemo } from 'react';

const COLORS = ['#ffd479', '#8b7cff', '#4fc3f7', '#34d399', '#ff6b81', '#ffffff'];

interface Particle {
  id: number;
  tx: number;
  ty: number;
  delay: number;
  color: string;
  size: number;
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, id) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 110;
    return {
      id,
      // Computed in JS (not CSS trig functions) for wider mobile/Safari
      // support - this only needs to run once per burst anyway.
      tx: Math.cos(angle) * distance,
      ty: Math.sin(angle) * distance,
      delay: Math.random() * 0.25,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 4 + Math.random() * 5,
    };
  });
}

// Purely decorative, shown for the brief window between solving a level and
// the win menu actually appearing (see App.tsx's WIN_MENU_DELAY_MS) - gives
// that pause a payoff instead of feeling like a stall. Regenerates its
// random burst positions once per mount, which happens once per solve since
// the parent only renders this while solved && !showWinMenu.
export function FireworksOverlay() {
  const bursts = useMemo(
    () =>
      Array.from({ length: 3 }, () => ({
        left: 20 + Math.random() * 60,
        top: 18 + Math.random() * 38,
        delay: Math.random() * 0.35,
        particles: makeParticles(22),
      })),
    []
  );

  return (
    <div className="fireworks-overlay">
      {bursts.map((burst, i) => (
        <div
          key={i}
          className="firework-burst"
          style={{ left: `${burst.left}%`, top: `${burst.top}%` }}
        >
          {burst.particles.map((p) => (
            <span
              key={p.id}
              className="firework-particle"
              style={
                {
                  '--tx': `${p.tx}px`,
                  '--ty': `${p.ty}px`,
                  animationDelay: `${burst.delay + p.delay}s`,
                  background: p.color,
                  boxShadow: `0 0 6px ${p.color}`,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
