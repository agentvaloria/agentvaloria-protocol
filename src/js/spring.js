// Damped harmonic oscillator, sub-stepped semi-implicit Euler.
export function makeSpring({ k = 170, c = 20, m = 1, from = 0, to = 1 } = {}) {
  const s = { x: from, v: 0, target: to, k, c, m, eps: 0.0006 };
  s.step = (dt) => {
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 240);
      const a = (-s.k * (s.x - s.target) - s.c * s.v) / s.m;
      s.v += a * h;
      s.x += s.v * h;
      left -= h;
    }
  };
  s.settled = () => Math.abs(s.x - s.target) < s.eps && Math.abs(s.v) < s.eps;
  return s;
}
