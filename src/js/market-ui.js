import { DASH, count, letterOf, money, pct, price } from './format.js';
import { reduced, tweenNumber } from './motion.js';
import { copyText, el, flashCopied } from './ui.js';

const CELLS = [
  ['price', 'Price', price],
  ['change', '24h', pct],
  ['volume', 'Volume', money],
  ['liquidity', 'Liquidity', money]
];
const PILL = { loading: 'syncing', live: 'live', stale: 'stale', error: 'offline', pending: 'pending' };
const NOTE = {
  error: 'The feed is not answering. Retrying with longer and longer pauses.',
  stale: 'The newest refresh failed. Earlier good figures remain displayed.',
  pending: 'No market source is stated yet, so no request goes out.'
};
const COPY_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2.5h7v9h-7z M3.5 4.5v9h7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function mountMarket({ topN = 10 } = {}) {
  const root = document.querySelector('[data-market]');
  const body = document.querySelector('[data-mk-body]');
  const note = document.querySelector('[data-mk-note]');
  const tk = document.querySelector('[data-tk]');
  const track = document.querySelector('[data-tk-track]');
  const total = document.querySelector('[data-total]');
  const pills = [...document.querySelectorAll('[data-pill]')];
  const rows = [];
  let tickerKey = '';
  let hasData = false;

  /* ---------- rows ---------- */
  function buildRow(i) {
    const row = el('div', 'mk-row');
    row.setAttribute('role', 'row');
    row.dataset.spot = '';
    row.dataset.ready = 'false';
    row.style.setProperty('--i', String(i));

    const tokenCell = el('div', 'mk-token');
    tokenCell.setAttribute('role', 'cell');
    const tile = el('span', 'tile');
    tile.append(el('span', 'tile-l'));
    const names = el('span', 'mk-names');
    names.append(el('b', 'sym'), el('span', 'nm'));
    tokenCell.append(tile, names, el('i', 'sk sk-token'));
    row.append(tokenCell);

    for (const [key, label] of CELLS) {
      const c = el('div', 'mk-c');
      c.setAttribute('role', 'cell');
      c.dataset.k = key;
      c.dataset.label = label;
      const v = el('span', 'v num');
      v.dataset.v = key;
      c.append(v, el('i', 'sk'));
      row.append(c);
    }

    const copyCell = el('div', 'mk-copy');
    copyCell.setAttribute('role', 'cell');
    const btn = el('button', 'copy');
    btn.type = 'button';
    btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', async () => {
      const addr = row.dataset.address;
      if (!addr) return;
      const ok = await copyText(addr);
      btn.innerHTML = ok ? CHECK_ICON : COPY_ICON;
      flashCopied(btn, ok);
      setTimeout(() => (btn.innerHTML = COPY_ICON), 1600);
    });
    copyCell.append(btn);
    row.append(copyCell);
    return row;
  }

  for (let i = 0; i < topN; i++) {
    const r = buildRow(i);
    rows.push(r);
    body.append(r);
  }

  function setToken(row, t) {
    row.dataset.address = t.address;
    row.querySelector('.sym').textContent = t.symbol || DASH;
    row.querySelector('.nm').textContent = t.name;
    row.querySelector('.copy').setAttribute('aria-label', `Copy address for ${t.symbol || 'token'}`);
    const tile = row.querySelector('.tile');
    tile.querySelector('img')?.remove();
    tile.querySelector('.tile-l').textContent = letterOf(t);
    tile.dataset.fallback = 'true';
    if (/^https:\/\//.test(t.imageUrl)) {
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        if (row.dataset.address === t.address) tile.dataset.fallback = 'false';
      };
      img.onerror = () => {
        img.remove();
        tile.dataset.fallback = 'true';
      };
      tile.append(img);
      img.src = t.imageUrl;
    }
  }

  function applyValues(row, t) {
    for (const [key, , fmt] of CELLS) {
      const v = row.querySelector(`[data-v="${key}"]`);
      tweenNumber(v, t[key], fmt);
      if (key === 'change') {
        v.parentElement.dataset.dir = !Number.isFinite(t.change) ? 'none' : t.change > 0 ? 'up' : t.change < 0 ? 'down' : 'flat';
      }
    }
  }

  function reveal(row, t, i) {
    const go = () => {
      row.dataset.ready = 'true';
      applyValues(row, t);
    };
    if (reduced()) go();
    else setTimeout(go, 60 + i * 55);
  }

  /* ---------- aggregates ---------- */
  const fig = (id) => document.querySelector(`[data-fig="${id}"]`);
  const figSym = (id) => document.querySelector(`[data-fig-sym="${id}"]`);

  function updateFigs(list, meta) {
    const vols = list.map((t) => t.volume);
    const liqs = list.map((t) => t.liquidity);
    const sum = (a) => a.filter(Number.isFinite).reduce((x, y) => x + y, 0);
    const changes = list.filter((t) => Number.isFinite(t.change));
    const best = changes.reduce((a, t) => (!a || t.change > a.change ? t : a), null);
    const worst = changes.reduce((a, t) => (!a || t.change < a.change ? t : a), null);
    const deep = list.reduce((a, t) => (Number.isFinite(t.liquidity) && (!a || t.liquidity > a.liquidity) ? t : a), null);
    tweenNumber(total, sum(vols), money);
    tweenNumber(fig('listed'), list.length, count);
    tweenNumber(fig('boosted'), meta.boosted, count);
    tweenNumber(fig('volume'), sum(vols), money);
    tweenNumber(fig('liquidity'), sum(liqs), money);
    tweenNumber(fig('median'), median(list.map((t) => t.change)), pct);
    tweenNumber(fig('best'), best ? best.change : NaN, pct);
    tweenNumber(fig('worst'), worst ? worst.change : NaN, pct);
    tweenNumber(fig('deep'), deep ? deep.liquidity : NaN, money);
    figSym('best').textContent = best ? best.symbol : '';
    figSym('worst').textContent = worst ? worst.symbol : '';
    figSym('deep').textContent = deep ? deep.symbol : '';
  }

  /* ---------- chart: volume (area) and liquidity (line), shared scale ---------- */
  function updateChart(list) {
    const W = 664;
    const max = Math.max(1, ...list.flatMap((t) => [t.volume, t.liquidity]).filter(Number.isFinite));
    const n = list.length;
    const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v) => (190.5 - (Number.isFinite(v) ? v / max : 0) * 180).toFixed(1);
    const line = (key) => list.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(t[key])}`).join(' ');
    const set = (sel, d) => document.querySelector(sel)?.setAttribute('d', d);
    set('[data-chart-vol]', line('volume'));
    set('[data-chart-liq]', line('liquidity'));
    set('[data-chart-area]', `${line('volume')} L${x(n - 1).toFixed(1)} 190.5 L${x(0).toFixed(1)} 190.5 Z`);
    const setLabel = (id, v) => {
      const t = document.querySelector(`[data-chart-label="${id}"]`);
      if (t) t.textContent = v;
    };
    setLabel('top', money(max));
    setLabel('mid', money(max / 2));
    setLabel('low', '$0');
    document.querySelector('[data-chart]').dataset.drawn = 'true';
  }

  /* ---------- ticker (same data as the rows) ---------- */
  function updateTicker(list) {
    const key = list.map((t) => t.address).join('|');
    const fill = (container, item, t) => {
      item.querySelector('.tk-sym').textContent = t.symbol;
      item.querySelector('.tk-price').textContent = price(t.price);
      const c = item.querySelector('.tk-chg');
      c.textContent = pct(t.change);
      c.dataset.dir = !Number.isFinite(t.change) ? 'none' : t.change > 0 ? 'up' : t.change < 0 ? 'down' : 'flat';
    };
    if (key !== tickerKey) {
      tickerKey = key;
      track.replaceChildren();
      for (let copy = 0; copy < 2; copy++) {
        const group = el('div', 'tk-group');
        if (copy) group.setAttribute('aria-hidden', 'true');
        for (const t of list) {
          const item = el('span', 'tk-item');
          item.dataset.tk = '';
          item.append(el('b', 'tk-sym'), el('span', 'tk-price'), el('span', 'tk-chg'));
          group.append(item);
        }
        track.append(group);
      }
      tk.style.setProperty('--tk-dur', Math.max(24, list.length * 3.6).toFixed(1) + 's');
    }
    track.querySelectorAll('.tk-group').forEach((group) => {
      [...group.children].forEach((item, i) => fill(group, item, list[i]));
    });
    tk.dataset.state = 'ready';
  }

  /* ---------- public API ---------- */
  function setStatus(kind) {
    root.dataset.status = kind;
    for (const p of pills) {
      p.dataset.status = kind;
      p.querySelector('[data-pill-text]').textContent = PILL[kind];
    }
    if (kind === 'error' && !hasData) {
      rows.forEach((row) => {
        row.dataset.ready = 'error';
        row.removeAttribute('data-address');
        row.querySelector('.sym').textContent = DASH;
        row.querySelector('.nm').textContent = '';
        row.querySelector('.tile-l').textContent = DASH;
        row.querySelector('.tile').dataset.fallback = 'true';
        row.querySelectorAll('.v').forEach((v) => {
          v._to = undefined;
          v._shown = undefined;
          v.textContent = DASH;
        });
      });
      total.textContent = DASH;
      document.querySelectorAll('[data-fig]').forEach((f) => (f.textContent = DASH));
      tk.dataset.state = 'error';
    }
    note.textContent = NOTE[kind] || '';
    note.hidden = !NOTE[kind];
  }

  function update({ rows: list, boosted }) {
    hasData = true;
    list.forEach((t, i) => {
      const row = rows[i];
      const isNew = row.dataset.address !== t.address || row.dataset.ready !== 'true';
      if (isNew) {
        row.dataset.ready = 'false';
        setToken(row, t);
        reveal(row, t, i);
      } else {
        applyValues(row, t);
      }
    });
    rows.forEach((row, i) => {
      row.hidden = i >= list.length;
    });
    updateFigs(list, { boosted });
    updateChart(list);
    updateTicker(list);
  }

  function inert() {
    root.dataset.mode = 'pending';
    rows.forEach((r) => (r.hidden = true));
    tk.dataset.state = 'pending';
    total.textContent = DASH;
    document.querySelectorAll('[data-fig]').forEach((f) => (f.textContent = DASH));
    setStatus('pending');
  }

  return { setStatus, update, inert };
}
