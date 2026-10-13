import { handleOf, hostOf, isStated } from './register.js';

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-copy';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// Short-lived feedback on a control; the label returns on its own.
export function flashCopied(btn, ok, holdMs = 1600) {
  clearTimeout(btn._fb);
  btn.dataset.copied = ok ? 'true' : 'failed';
  const live = document.querySelector('[data-live]');
  if (live) live.textContent = ok ? 'Copied to clipboard' : 'Copy failed';
  btn._fb = setTimeout(() => {
    delete btn.dataset.copied;
    if (live) live.textContent = '';
  }, holdMs);
}

/* ---------- contract address slot ---------- */
export function renderCA(rec) {
  const root = document.querySelector('[data-ca]');
  if (!root) return;
  root.replaceChildren();
  if (!isStated(rec)) {
    root.dataset.state = rec ? rec.state : 'absent';
    const box = el('div', 'ca-in');
    box.dataset.spot = '';
    box.setAttribute('aria-disabled', 'true');
    box.append(el('span', 'ca-label', 'CA'), el('span', 'ca-value ca-pending', 'pending'));
    box.querySelector('.ca-value').dataset.caValue = '';
    root.append(box);
    return;
  }
  root.dataset.state = 'stated';
  const btn = el('button', 'ca-in ca-btn');
  btn.type = 'button';
  btn.dataset.spot = '';
  btn.setAttribute('aria-label', 'Copy contract address');
  const value = el('span', 'ca-value', rec.value);
  value.dataset.caValue = '';
  const act = el('span', 'ca-act');
  act.setAttribute('aria-hidden', 'true');
  act.dataset.caAct = '';
  btn.append(el('span', 'ca-label', 'CA'), value, act);
  btn.addEventListener('click', async () => {
    const ok = await copyText(rec.value);
    if (!ok) {
      const r = document.createRange();
      r.selectNodeContents(value);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    flashCopied(btn, ok);
  });
  root.append(btn);
}

/* ---------- social icons: inert unless stated ---------- */
export function renderSocial(records) {
  for (const id of ['x', 'github']) {
    const node = document.querySelector(`[data-social="${id}"]`);
    if (!node) continue;
    const rec = records[id];
    const label = (rec && rec.label) || id;
    const svg = node.querySelector('svg');
    if (isStated(rec)) {
      const a = el('a', 'icon-btn');
      a.dataset.social = id;
      a.href = rec.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const handle = handleOf(rec.url);
      a.setAttribute('aria-label', handle ? `${label} ${handle}` : label);
      a.append(svg.cloneNode(true));
      node.replaceWith(a);
    } else {
      node.removeAttribute('href');
      node.setAttribute('aria-disabled', 'true');
      node.setAttribute('aria-label', `${label}, pending`);
    }
  }
}

/* ---------- register list ---------- */
const FACT_ORDER = ['chain', 'rpc', 'ca', 'x', 'github', 'market-source'];
const FALLBACK_LABEL = { chain: 'Chain', rpc: 'RPC', ca: 'CA', x: 'X', github: 'GitHub', 'market-source': 'Market' };

export function renderFacts(records) {
  const root = document.querySelector('[data-facts]');
  if (!root) return;
  root.replaceChildren();
  for (const id of FACT_ORDER) {
    const rec = records[id];
    const row = el('div', 'fact');
    row.dataset.record = id;
    row.dataset.state = rec ? rec.state : 'absent';
    row.append(el('span', 'fl', (rec && rec.label) || FALLBACK_LABEL[id]));
    const v = el('span', 'fv');
    if (!isStated(rec)) {
      v.classList.add('fv-pending');
      v.textContent = 'pending';
    } else if (id === 'chain') {
      v.textContent = rec.value;
    } else if (id === 'ca') {
      v.textContent = rec.value;
      v.classList.add('fv-addr');
      row.dataset.wrap = '';
    } else if (id === 'x' || id === 'github') {
      const a = el('a', 'fv-link', handleOf(rec.url) || hostOf(rec.url));
      a.href = rec.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      v.append(a);
    } else {
      v.textContent = hostOf(rec.url);
    }
    row.append(v);
    root.append(row);
  }
}
