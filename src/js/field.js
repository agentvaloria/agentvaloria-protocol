import { reduced } from './motion.js';

// Own drawing for the wide slot: a drifting node mesh over contour lines.
function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initField(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(document.documentElement);
  const tone = (name) => css.getPropertyValue(name).trim();
  const dot = tone('--ink-1');
  const link = tone('--ink-3');
  const contour = tone('--line-2');
  let w = 0;
  let h = 0;
  let nodes = [];
  let running = false;
  let raf = 0;

  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry(7);
    const n = w < 600 ? 34 : 64;
    nodes = Array.from({ length: n }, () => ({
      x: rnd() * w,
      y: rnd() * h,
      ax: 6 + rnd() * 18,
      ay: 6 + rnd() * 18,
      fx: 0.18 + rnd() * 0.3,
      fy: 0.14 + rnd() * 0.3,
      ph: rnd() * 6.28
    }));
  };

  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = contour;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = h * (0.46 + i * 0.07) + Math.sin(x * 0.012 + i * 0.9 + t * 0.35) * (10 + i * 3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const pts = nodes.map((p) => ({
      x: p.x + Math.sin(t * p.fx + p.ph) * p.ax,
      y: p.y + Math.cos(t * p.fy + p.ph) * p.ay
    }));
    ctx.strokeStyle = link;
    const reach = w < 600 ? 90 : 130;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < reach) {
          ctx.globalAlpha = (1 - d / reach) * 0.55;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = dot;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const loop = (now) => {
    draw(now / 1000);
    raf = running ? requestAnimationFrame(loop) : 0;
  };
  const start = () => {
    if (running || reduced()) return;
    running = true;
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  size();
  draw(0);
  let onScreen = false;
  const sync = () => (onScreen && !document.hidden && !reduced() ? start() : stop());
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      onScreen = es[0].isIntersecting;
      sync();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', () => {
    size();
    draw(performance.now() / 1000);
  });
}
