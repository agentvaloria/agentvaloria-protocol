const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});

export const DASH = '—';

export function money(n) {
  if (!Number.isFinite(n)) return DASH;
  if (Math.abs(n) < 1000) return '$' + n.toFixed(n < 10 ? 2 : 0);
  return '$' + compact.format(n);
}

export function price(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return '$0';
  if (n >= 1) return '$' + n.toFixed(n >= 100 ? 2 : 3);
  const digits = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(n))));
  return '$' + n.toFixed(digits);
}

export function pct(n) {
  if (!Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const body = abs >= 1000 ? compact.format(abs) : abs.toFixed(abs >= 100 ? 0 : 1);
  return (n < 0 ? '−' : '+') + body + '%';
}

export function count(n) {
  return Number.isFinite(n) ? String(Math.round(n)) : DASH;
}

export function letterOf(token) {
  const src = (token.symbol || token.name || '').trim();
  const ch = Array.from(src.replace(/^[^\p{L}\p{N}]+/u, ''))[0];
  return ch ? ch.toUpperCase() : '?';
}

export function shortAddress(a) {
  return a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '';
}
