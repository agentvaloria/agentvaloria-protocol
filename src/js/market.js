// Live market data layer. Follows the market-source register record only.
const TIMEOUT_MS = 12000;
const CHUNK = 30;

async function getJson(url, outer) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const relay = () => ctl.abort();
  outer?.addEventListener('abort', relay);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}

const num = (v) => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : NaN;
};

export function pickAddresses(boosts, chain) {
  const seen = new Set();
  const out = [];
  for (const b of Array.isArray(boosts) ? boosts : []) {
    if (!b || b.chainId !== chain || typeof b.tokenAddress !== 'string') continue;
    if (seen.has(b.tokenAddress)) continue;
    seen.add(b.tokenAddress);
    out.push(b.tokenAddress);
  }
  return out;
}

// Best pair per token (by 24h volume), then top N by 24h volume.
export function rank(pairs, addresses, chain, topN) {
  const wanted = new Set(addresses);
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const addr = p?.baseToken?.address;
    if (!p || p.chainId !== chain || !wanted.has(addr)) continue;
    const vol = num(p.volume?.h24);
    const cur = best.get(addr);
    if (!cur || (Number.isFinite(vol) ? vol : -1) > (Number.isFinite(cur.volume) ? cur.volume : -1)) {
      best.set(addr, {
        address: addr,
        symbol: String(p.baseToken.symbol || ''),
        name: String(p.baseToken.name || ''),
        imageUrl: typeof p.info?.imageUrl === 'string' && p.info.imageUrl ? p.info.imageUrl : '',
        price: num(p.priceUsd),
        change: num(p.priceChange?.h24),
        volume: vol,
        liquidity: num(p.liquidity?.usd)
      });
    }
  }
  return [...best.values()]
    .filter((t) => Number.isFinite(t.volume))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, topN);
}

export function createFeed(source, hooks) {
  const pollMs = Number(source.pollMs) > 0 ? Number(source.pollMs) : 60000;
  const bo = source.backoff || {};
  const base = Number(bo.baseMs) > 0 ? Number(bo.baseMs) : 2000;
  const cap = Number(bo.maxMs) > 0 ? Number(bo.maxMs) : 60000;
  const factor = Number(bo.factor) > 1 ? Number(bo.factor) : 2;
  const chain = source.chain || 'solana';
  const topN = Number(source.topN) > 0 ? Number(source.topN) : 10;

  let timer = 0;
  let inflight = null;
  let failures = 0;
  let good = null;

  async function load(signal) {
    const boosts = await getJson(source.url, signal);
    const addresses = pickAddresses(boosts, chain);
    if (!addresses.length) throw new Error('no entries');
    const pairs = [];
    for (let i = 0; i < addresses.length; i += CHUNK) {
      const part = addresses.slice(i, i + CHUNK).join(',');
      const res = await getJson(source.pairsUrl.replace('{addresses}', encodeURIComponent(part).replace(/%2C/g, ',')), signal);
      if (Array.isArray(res)) pairs.push(...res);
    }
    const rows = rank(pairs, addresses, chain, topN);
    if (!rows.length) throw new Error('no pairs');
    return { rows, boosted: addresses.length };
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (document.hidden || inflight) return;
    clearTimeout(timer);
    const ctl = new AbortController();
    inflight = ctl;
    try {
      const result = await load(ctl.signal);
      if (inflight !== ctl) return;
      failures = 0;
      good = result;
      hooks.onData(result);
      hooks.onStatus('live');
      inflight = null;
      schedule(pollMs);
    } catch {
      if (inflight !== ctl) return; // aborted by pause
      inflight = null;
      failures += 1;
      hooks.onStatus(good ? 'stale' : 'error');
      schedule(Math.min(cap, base * factor ** (failures - 1)));
    }
  }

  function pause() {
    clearTimeout(timer);
    if (inflight) {
      const ctl = inflight;
      inflight = null;
      ctl.abort();
    }
  }

  function onVisibility() {
    if (document.hidden) pause();
    else tick();
  }

  return {
    start() {
      hooks.onStatus(good ? 'live' : 'loading');
      document.addEventListener('visibilitychange', onVisibility);
      if (!document.hidden) tick();
    },
    stop() {
      pause();
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
