// Browser harness shared by the gates and the measurement run.
// Mutation anchors are state-independent: every mutation reads the record
// that is currently shipped and rewrites it, instead of matching a literal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serveDir } from './server.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = path.join(ROOT, 'dist');

export const BREAKPOINTS = [
  { name: '360', width: 360, height: 740 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '1366', width: 1366, height: 768 },
  { name: '1440', width: 1440, height: 900 }
];

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fakeAddress(seed, len = 44) {
  let s = '';
  let x = seed * 2654435761 + 12345;
  while (s.length < len) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    s += B58[(x >>> 8) % B58.length];
  }
  return s;
}
export const FAKE_CA = fakeAddress(901);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export function findBrowser() {
  const list = [
    process.env.BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  const hit = list.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('no Chromium-based browser found; set BROWSER_PATH');
  return hit;
}

/* ---------- register mutation helpers ---------- */
export const readShippedRegister = () => JSON.parse(fs.readFileSync(path.join(DIST, 'register.json'), 'utf8'));

export const MARKET_DEFAULTS = {
  url: 'https://api.dexscreener.com/token-boosts/top/v1',
  pairsUrl: 'https://api.dexscreener.com/tokens/v1/solana/{addresses}',
  chain: 'solana',
  topN: 10,
  pollMs: 60000,
  backoff: { baseMs: 2000, maxMs: 60000, factor: 2 }
};

// Force a record into a state, whatever state it is in now.
export function forceState(reg, id, state, payload = {}) {
  const cur = reg.records[id] || {};
  const keep = { label: cur.label || id, source: cur.source, scope: cur.scope, recorded: cur.recorded };
  if (state === 'stated') {
    const prior = cur.state === 'stated' ? cur : {};
    reg.records[id] = { ...keep, ...prior, ...payload, state };
  } else {
    reg.records[id] = { ...keep, state };
  }
  return reg;
}

export function tuneMarket(reg, patch) {
  const cur = reg.records['market-source'];
  const base = cur && cur.state === 'stated' ? cur : { ...MARKET_DEFAULTS, label: 'Market', source: cur?.source, scope: cur?.scope, recorded: cur?.recorded };
  reg.records['market-source'] = { ...base, ...patch, state: 'stated' };
  return reg;
}

/* ---------- mock market data ---------- */
export const SYMBOLS = ['ALFA', 'BRAVO', 'CIRRUS', 'DELTA', 'EMBER', 'FLUX', 'GLINT', 'HALO', 'ION', 'JADE', 'KITE', 'LUMEN'];

export function makeMarket({ solana = 12 } = {}) {
  const boosts = [];
  const pairs = [];
  for (let i = 0; i < solana; i++) {
    const address = fakeAddress(100 + i);
    boosts.push({ chainId: 'solana', tokenAddress: address, url: 'https://x.test/' + i });
    const imageUrl = i === 2 ? undefined : i === 4 ? 'https://img.test/bad-' + i + '.png' : 'https://img.test/ok-' + i + '.png';
    pairs.push({
      chainId: 'solana',
      pairAddress: fakeAddress(300 + i),
      baseToken: { address, name: SYMBOLS[i] + ' Token', symbol: SYMBOLS[i] },
      priceUsd: String(i % 3 === 0 ? 0.00001234 * (i + 1) : 1.5 * (i + 1)),
      priceChange: { h24: i % 2 ? -(i * 1.7) : i * 2.3 },
      volume: { h24: 9_000_000 - i * 600_000 },
      liquidity: { usd: 2_000_000 + i * 90_000 },
      info: imageUrl ? { imageUrl } : {}
    });
    if (i === 1) {
      // second, thinner pair for the same token: must lose to the first
      pairs.push({ ...pairs[pairs.length - 1], pairAddress: fakeAddress(500 + i), volume: { h24: 10 } });
    }
  }
  const other = fakeAddress(777);
  boosts.push({ chainId: 'ethereum', tokenAddress: '0x' + 'ab'.repeat(20), url: 'https://x.test/eth' });
  boosts.push({ chainId: 'solana', tokenAddress: boosts[0].tokenAddress, url: 'https://x.test/dup' });
  pairs.push({
    chainId: 'ethereum',
    pairAddress: '0x' + 'cd'.repeat(20),
    baseToken: { address: '0x' + 'ab'.repeat(20), name: 'Other', symbol: 'OTHR' },
    priceUsd: '1',
    priceChange: { h24: 1 },
    volume: { h24: 999_000_000 },
    liquidity: { usd: 1 },
    info: {}
  });
  void other;
  return { boosts, pairs };
}

/* ---------- scenarios ---------- */
const PROFILE_ARGS = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'];

// Each scenario gets its own browser: slower, but one crash cannot cascade.
export async function launch() {
  const site = await serveDir(DIST);
  const open = new Set();
  return {
    site,
    origin: `http://127.0.0.1:${site.port}`,
    async spawn() {
      const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, dumpio: !!process.env.DUMPIO, args: PROFILE_ARGS });
      open.add(browser);
      return browser;
    },
    async release(browser) {
      open.delete(browser);
      await browser.close().catch(() => {});
    },
    async close() {
      for (const b of [...open]) await b.close().catch(() => {});
      await site.close();
    }
  };
}

const CORS = { 'access-control-allow-origin': '*' };

export async function openScenario(env, opts = {}) {
  const {
    mutate,
    boost,
    pairs,
    width = 1440,
    height = 900,
    reducedMotion = false,
    wait = 'load',
    rows = false,
    data = makeMarket()
  } = opts;
  const browser = await env.spawn();
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 760, hasTouch: width < 760 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }]);
  await page.evaluateOnNewDocument(() => {
    window.__hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
    Object.defineProperty(document, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible') });
    window.__setHidden = (v) => {
      window.__hidden = v;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (t) => {
          window.__copied.push(t);
          return Promise.resolve();
        }
      },
      configurable: true
    });
  });
  const log = { boostHits: [], pairHits: [], hosts: new Set(), unexpected: [], consoleErrors: [], pageErrors: [], registerServed: null };
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => log.pageErrors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    log.hosts.add(u.host);
    try {
      if (u.hostname === '127.0.0.1') {
        if (u.pathname === '/register.json' && mutate) {
          const reg = readShippedRegister();
          mutate(reg);
          log.registerServed = reg;
          return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(reg) });
        }
        return req.continue();
      }
      if (u.hostname === 'api.dexscreener.com') {
        const isBoost = u.pathname.startsWith('/token-boosts/');
        const hits = isBoost ? log.boostHits : log.pairHits;
        hits.push(Date.now());
        const fn = isBoost ? boost : pairs;
        const r = (fn && (await fn(hits.length, u))) || { status: 200 };
        if (r.delay) await new Promise((res) => setTimeout(res, r.delay));
        if (r.status && r.status !== 200) return req.respond({ status: r.status, headers: CORS, body: '{}' });
        let body;
        if (isBoost) body = r.body ?? data.boosts;
        else {
          const wanted = new Set(decodeURIComponent(u.pathname.split('/').pop()).split(','));
          body = r.body ?? data.pairs.filter((p) => wanted.has(p.baseToken.address));
        }
        return req.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
      }
      if (u.hostname === 'img.test') {
        if (u.pathname.includes('ok-')) return req.respond({ status: 200, contentType: 'image/png', headers: CORS, body: PNG });
        return req.respond({ status: 404, headers: CORS, body: '' });
      }
      if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com')) return req.abort();
      log.unexpected.push(req.url());
      return req.abort();
    } catch {
      /* page closed mid-flight */
    }
  });
  await page.goto(env.origin + '/', { waitUntil: wait === 'none' ? 'domcontentloaded' : 'load' });
  if (wait !== 'none') await page.waitForFunction(() => document.documentElement.dataset.registerLoaded === 'true', { timeout: 10000, polling: 50 });
  if (rows) await page.waitForFunction(() => document.querySelectorAll('.mk-row[data-ready=true]').length >= 10, { timeout: 10000, polling: 50 });
  return {
    page,
    log,
    async close() {
      await env.release(browser);
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(page, fn, timeout = 8000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 50 }, ...args);
}

// Scroll the whole page so every reveal fires, then settle.
export async function scrollThrough(page, settle = 1800) {
  await page.evaluate(async () => {
    const step = Math.max(200, innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 90));
    }
    scrollTo({ top: 0, behavior: 'instant' });
  });
  await sleep(settle);
}
