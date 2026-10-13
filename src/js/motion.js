import { makeSpring } from './spring.js';

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

// One shared frame loop; it sleeps whenever no spring is in flight.
const live = new Set();
let raf = 0;
let last = 0;

function frame(now) {
  // sub-stepping keeps the solver stable, so a slow frame still advances real time
  const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
  last = now;
  for (const job of [...live]) {
    job.spring.step(dt);
    if (job.spring.settled()) {
      job.spring.x = job.spring.target;
      live.delete(job);
      job.update(job.spring.x, true);
    } else {
      job.update(job.spring.x, false);
    }
  }
  raf = live.size ? requestAnimationFrame(frame) : 0;
}

export function run(job) {
  live.add(job);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  return job;
}

export function cancel(job) {
  if (job) live.delete(job);
}

// Animate 0→1 on a spring. Reduced motion jumps straight to the end.
export function animate(update, opts = {}) {
  const { delay = 0, ...cfg } = opts;
  if (reduced()) {
    update(1, true);
    return { stop() {} };
  }
  const job = { spring: makeSpring(cfg), update };
  let timer = 0;
  if (delay > 0) timer = setTimeout(() => run(job), delay);
  else run(job);
  return {
    stop() {
      clearTimeout(timer);
      cancel(job);
    }
  };
}

/* ---------- scroll reveal with stagger ---------- */
export function initReveal() {
  const items = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('motion');
  const show = (el, delay) => {
    animate(
      (p, done) => {
        el.style.opacity = String(Math.min(1, Math.max(0, p * 1.5)));
        el.style.transform = `translate3d(0, ${((1 - p) * 28).toFixed(2)}px, 0)`;
        if (done) {
          el.style.opacity = '';
          el.style.transform = '';
          el.dataset.revealed = 'true';
        }
      },
      { delay, k: 150, c: 19 }
    );
  };
  const io = new IntersectionObserver(
    (entries) => {
      const fresh = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
      fresh.forEach((e, i) => {
        io.unobserve(e.target);
        show(e.target, Math.min(i, 8) * 70);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );
  items.forEach((el) => io.observe(el));
}

/* ---------- scroll progress ---------- */
export function initProgress() {
  const bar = document.querySelector('[data-progress]');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const r = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${r.toFixed(4)})`;
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(paint);
    }
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  paint();
}

/* ---------- hero parallax: pointer + scroll, spring smoothed ---------- */
export function initParallax() {
  const layers = [...document.querySelectorAll('[data-depth]')];
  if (!layers.length || reduced()) return;
  const px = { x: 0, y: 0 };
  const state = layers.map((el) => ({
    el,
    depth: Number(el.dataset.depth) || 0,
    sx: makeSpring({ k: 55, c: 13, from: 0, to: 0 }),
    sy: makeSpring({ k: 55, c: 13, from: 0, to: 0 })
  }));
  const apply = (s) => {
    s.el.style.transform = `translate3d(${s.sx.x.toFixed(2)}px, ${s.sy.x.toFixed(2)}px, 0)`;
  };
  const retarget = () => {
    const sy = Math.min(window.scrollY, 1400);
    for (const s of state) {
      s.sx.target = px.x * s.depth * 26;
      s.sy.target = px.y * s.depth * 18 - sy * s.depth * 0.22;
      run({ spring: s.sx, update: () => apply(s) });
      run({ spring: s.sy, update: () => apply(s) });
    }
  };
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      px.x = (e.clientX / window.innerWidth - 0.5) * 2;
      px.y = (e.clientY / window.innerHeight - 0.5) * 2;
      retarget();
    },
    { passive: true }
  );
  document.addEventListener('pointerleave', () => {
    px.x = 0;
    px.y = 0;
    retarget();
  });
  window.addEventListener('scroll', retarget, { passive: true });
  retarget();
}

/* ---------- spotlight on hover ---------- */
export function initSpotlight() {
  if (reduced()) return;
  document.addEventListener(
    'pointermove',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-spot]') : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
    },
    { passive: true }
  );
}

/* ---------- number tween with flash on change ---------- */
export function tweenNumber(el, to, fmt, { flash = true } = {}) {
  const prev = el._to;
  el._to = to;
  if (el._job) {
    el._job.stop();
    el._job = null;
  }
  if (!Number.isFinite(to)) {
    el.textContent = fmt(NaN);
    el._shown = undefined;
    return;
  }
  const from = Number.isFinite(el._shown) ? el._shown : 0;
  const changed = Number.isFinite(prev) && prev !== to;
  if (changed && flash) {
    el.dataset.flash = to > prev ? 'up' : 'down';
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  if (reduced() || from === to) {
    el.textContent = fmt(to);
    el._shown = to;
    return;
  }
  el._job = animate(
    (p, done) => {
      const v = done ? to : from + (to - from) * p;
      el._shown = v;
      el.textContent = fmt(v);
    },
    { k: 90, c: 17 }
  );
}
