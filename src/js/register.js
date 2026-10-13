// Register pattern: every external fact is one record with one state.
// stated | absent | unconfirmed. Only "stated" records may carry data;
// everything else is stripped to label + state so it can never leak through.
export const STATES = ['stated', 'absent', 'unconfirmed'];
const KEEP_INERT = ['label', 'state', 'source', 'scope', 'recorded'];
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(v) {
  return typeof v === 'string' && SOLANA_ADDRESS.test(v);
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function hasPayload(id, rec) {
  if (id === 'ca') return isSolanaAddress(rec.value);
  if (id === 'chain') return typeof rec.value === 'string' && rec.value.length > 0;
  return isHttpUrl(rec.url);
}

export function normalize(raw) {
  const out = {};
  const records = (raw && raw.records) || {};
  for (const [id, rec] of Object.entries(records)) {
    const r = rec && typeof rec === 'object' ? rec : {};
    let state = STATES.includes(r.state) ? r.state : 'absent';
    if (state === 'stated' && !hasPayload(id, r)) state = 'unconfirmed';
    if (state === 'stated') {
      out[id] = { ...r, id, state };
    } else {
      const inert = { id, state };
      for (const k of KEEP_INERT) if (k in r && k !== 'state') inert[k] = r[k];
      out[id] = inert;
    }
  }
  return out;
}

export async function loadRegister() {
  try {
    const res = await fetch('register.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('register ' + res.status);
    return normalize(await res.json());
  } catch {
    return {};
  }
}

export const isStated = (rec) => !!rec && rec.state === 'stated';

// Link rule: the URL is stored, the handle is derived from it.
export function handleOf(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : '';
  } catch {
    return '';
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
