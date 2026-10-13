import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BREAKPOINTS, DIST, FAKE_CA, ROOT, forceState, launch, makeMarket, openScenario, readShippedRegister,
  scrollThrough, sleep, tuneMarket, waitFor, fakeAddress
} from './lib/harness.mjs';
import { srgbGreyToOklchL, traceBrand } from './lib/trace.mjs';

process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e && e.stack || e); });
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e && e.stack || e); process.exit(1); });
const results = [];
const FLAKY = /Target closed|Connection closed|detached|Session closed|callFunctionOn timed out|Navigation timeout|ConnectionClosed/;
async function gate(name, fn) {
  try {
    try {
      await fn();
    } catch (e) {
      if (!FLAKY.test(e.message)) throw e;
      await fn(); // browser hiccup: one clean retry on a fresh scenario
    }
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
const ok = (c, m) => {
  if (!c) throw new Error(m);
};
const read = (p) => fs.readFileSync(p, 'utf8');
function walk(dir, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, skip));
    else out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replaceAll('\\', '/');
const distFiles = walk(DIST);
const srcFiles = walk(path.join(ROOT, 'src'));
const textExt = /\.(html|css|js|json|svg)$/;

/* ---------- shared detectors ---------- */
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i,
  /\b\d{1,2}:\d{2}/, /\b(19|20)\d{2}\b/, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\b\d+\s*(s|m|h|d)\s+ago\b/i, /\bago\b/i,
  /\b(today|yesterday|tomorrow)\b/i, /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
];
const dateHit = (t) => DATE_PATTERNS.map((p) => t.match(p)).find(Boolean);

export function scanAddresses(text, stated) {
  const hits = [
    ...(text.match(/(?<![A-Za-z0-9])0x[a-fA-F0-9]{40}(?![A-Za-z0-9])/g) || []),
    ...(text.match(/(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g) || [])
  ];
  return hits.filter((h) => !stated.has(h));
}
const statedValues = (reg) => new Set(Object.values(reg.records).filter((r) => r.state === 'stated').flatMap((r) => [r.value, r.url]).filter(Boolean));

const COLOR_LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|color)\(/g;
const NAMED = /:\s*[^;{}]*\b(white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|cyan|magenta|navy|teal|gold|brown)\b/i;

/* ================= static gates ================= */
const shipped = readShippedRegister();

await gate('dist: index, favicon, register, tokens present; repo docs absent', () => {
  for (const f of ['index.html', 'favicon.svg', 'register.json', 'tokens.css', 'styles.css', 'js/main.js']) ok(fs.existsSync(path.join(DIST, f)), `dist/${f} missing`);
  for (const f of ['README.md', 'LICENSE', 'docs']) ok(!fs.existsSync(path.join(DIST, f)), `dist/${f} must not ship`);
});

await gate('favicon: svg 32x32, built from the traced pixel grid, achromatic, linked', () => {
  const s = read(path.join(DIST, 'favicon.svg'));
  ok(/width="32"/.test(s) && /height="32"/.test(s) && /viewBox="0 0 32 32"/.test(s), 'not 32x32');
  const grid = JSON.parse(read(path.join(ROOT, 'src/favicon-grid.json'))).grid;
  ok(grid.length === 32 && grid.every((r) => r.length === 32), 'grid not 32x32');
  let cells = 0;
  const painted = new Set();
  for (const m of s.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill-opacity="([\d.]+)"/g)) {
    for (let i = 0; i < Number(m[3]); i++) {
      painted.add(`${Number(m[1]) + i},${m[2]}`);
      ok(Math.abs(Number(m[4]) - grid[m[2]][Number(m[1]) + i] / 255) < 0.006, `coverage mismatch at ${m[1]},${m[2]}`);
    }
  }
  grid.forEach((r, y) => r.forEach((v, x) => { if (v) cells++; ok(!v || painted.has(`${x},${y}`), `grid cell ${x},${y} not painted`); }));
  ok(cells > 150 && painted.size === cells, `painted ${painted.size} of ${cells} lit cells`);
  const colors = s.match(/oklch\([^)]*\)/g) || [];
  ok(colors.length >= 2 && colors.every((c) => /^oklch\(\s*[\d.]+\s+0\s+0\s*(\/\s*[\d.]+\s*)?\)$/.test(c)), 'favicon colours not chroma 0');
  ok(!/#[0-9a-f]{3,8}\b/i.test(s), 'hex in favicon');
  ok(/rel="icon"[^>]*favicon\.svg/.test(read(path.join(DIST, 'index.html'))), 'favicon not linked');
});

await gate('palette: colour literals live only in tokens.css', () => {
  for (const f of srcFiles.filter((f) => textExt.test(f) && !f.endsWith('tokens.css') && !f.endsWith('register.json'))) {
    const t = read(f);
    const m = t.match(COLOR_LITERAL);
    ok(!m, `${rel(f)} holds colour literal ${m}`);
    if (f.endsWith('.css')) ok(!NAMED.test(t), `${rel(f)} holds a named colour`);
  }
});

await gate('palette: every tokens.css colour is oklch with chroma exactly 0', () => {
  const t = read(path.join(ROOT, 'src/tokens.css'));
  ok(!COLOR_LITERAL.test(t.replace(/oklch\(/g, '')), 'non-oklch colour in tokens');
  const all = t.match(/oklch\([^)]*\)/g) || [];
  ok(all.length >= 10, 'too few tokens');
  for (const c of all) ok(/^oklch\(\s*[\d.]+\s+0\s+0\s*(\/\s*[\d.]+\s*)?\)$/.test(c), `chroma not 0: ${c}`);
});

await gate('units: no ch units anywhere in src or dist', () => {
  for (const f of [...srcFiles, ...distFiles].filter((f) => /\.(css|html|js)$/.test(f))) {
    const m = read(f).match(/(?<![\w.-])\d*\.?\d+ch\b/);
    ok(!m, `${rel(f)} uses ch unit ${m}`);
  }
});

await gate('dates: no date/time strings in shipped static files (register.json exempt)', () => {
  for (const f of distFiles.filter((f) => textExt.test(f) && !f.endsWith('register.json'))) {
    const t = read(f).replace(/<style[\s\S]*?<\/style>/g, '').replace(/https?:\/\/www\.w3\.org\/[\w/]+/g, '');
    const m = dateHit(f.endsWith('.js') ? (t.match(/(['"`])(?:(?!\1)[^\\\n])*\1/g) || []).join('\n') : t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, (tag) => tag.replace(/viewBox="[^"]*"|d="[^"]*"/g, '')));
    ok(!m, `${rel(f)}: "${m && m[0]}"`);
  }
});

await gate('register: schema, enum states, inert records carry no value or url', () => {
  const recs = shipped.records;
  for (const id of ['chain', 'rpc', 'ca', 'x', 'github', 'market-source']) ok(recs[id], `record ${id} missing`);
  for (const [id, r] of Object.entries(recs)) {
    ok(['stated', 'absent', 'unconfirmed'].includes(r.state), `${id}: bad state`);
    ok(r.label && r.source && r.scope, `${id}: label/source/scope missing`);
    if (r.state !== 'stated') for (const k of Object.keys(r)) ok(['label', 'state', 'source', 'scope', 'recorded'].includes(k), `${id}: inert record carries "${k}"`);
    else ok(r.value || r.url, `${id}: stated record has no payload`);
  }
  ok(recs.chain.value === 'Solana' && recs.rpc.url === 'https://solana-rpc.publicnode.com', 'chain/rpc differ from statement');
  ok(recs.ca.state === 'absent' && recs.x.url === 'https://x.com/agentvaloria' && recs.github.url === 'https://github.com/agentvaloria/agentvaloria-protocol', 'ca absent; x/github stated');
});

await gate('hygiene: no assistant config files or attribution strings in the project', () => {
  for (const bad of [['CLA','UDE.md'].join(''), ['.cla','ude'].join('')]) ok(!fs.existsSync(path.join(ROOT, bad)), `${bad} exists`);
  const words = new RegExp([['cla', 'ude'].join(''), ['anthr', 'opic'].join(''), ['open', 'ai'].join(''), ['gener', 'ated by'].join(''), ['co-', 'authored'].join(''), ['ch', 'atgpt'].join('')].join('|'), 'i');
  for (const f of walk(ROOT, ['node_modules', 'brand', 'reference', 'package-lock.json', 'ref-lexicon.json', '.git'])) {
    if (!/\.(md|html|css|js|mjs|json|svg|txt)$|LICENSE$/.test(f)) continue;
    const body = read(f);
    const m = body.match(words) || body.match(/\b[A]I\b/);
    ok(!m, `${rel(f)} contains "${m && m[0]}"`);
  }
});

await gate('repo files: README, whitepaper, MIT licence outside dist', () => {
  const readme = read(path.join(ROOT, 'README.md'));
  for (const h of ['Overview', 'Features', 'Links']) ok(new RegExp('^#+\\s*' + h, 'm').test(readme), `README lacks ${h}`);
  ok(/agentvaloria\.fun/i.test(readme) && /Solana/.test(readme) && /CA/.test(readme), 'README lacks badge/chain/CA');
  const wp = read(path.join(ROOT, 'docs/whitepaper.md'));
  for (const h of ['Vision', 'Tokenomics', 'Roadmap', 'Team']) ok(new RegExp(h, 'i').test(wp), `whitepaper lacks ${h}`);
  const phases = (wp.match(/^#+\s*Phase \d/gm) || []).length;
  ok(phases >= 3 && phases <= 4, `roadmap phases: ${phases}`);
  const lic = read(path.join(ROOT, 'LICENSE'));
  ok(/MIT License/.test(lic) && /Copyright \(c\) 2026 Agentvaloria/.test(lic), 'licence text');
});

await gate('copy: no shared content 2-grams and none of distinctive reference vocabulary', () => {
  const lex = JSON.parse(read(path.join(ROOT, 'gates/ref-lexicon.json')));
  const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
  const refW = new Set(lex.words);
  const refB = new Set(lex.bigrams);
  const html = read(path.join(DIST, 'index.html')).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ');
  const attrs = (html.match(/(?:content|aria-label)="[^"]*"/g) || []).map((a) => a.replace(/^[^=]*="|"$/g, ''));
  let text = html.replace(/<[^>]+>/g, ' ') + ' ' + attrs.join(' . ');
  for (const f of distFiles.filter((f) => f.endsWith('.js'))) {
    for (const s of read(f).match(/'[^'\n]{12,}'/g) || []) if (/ /.test(s) && !/[<>{}=]/.test(s)) text += ' . ' + s;
  }
  text += ' . syncing . live . stale . offline . pending';
  text = text.replace(/&amp;/g, '&');
  const STOP = new Set(('about above after again all also and any are because been before being below between both but can could did does doing down during each few for from further had has have having her here hers him his how into its just more most not off once only other our out over own same she should some such than that the their theirs them then there these they this those through under until very was were what when where which while who whom why will with would you your yours it is be as at by do if in no of on or so to up we an ' +
    'agentvaloria solana dexscreener').split(' '));
  const DISTINCT = new Set('sanctuary resident residents caretaker caretakers coin coins burn burned burying buried inscribe inscribed depart departed admit admitted pond bench hats drawn land door wall experiment valuation deposit deposits allowance grounds program turn turns kindness lovable'.split(' '));
  const sentences = text.split(/[.!?\n]+/);
  const badW = new Set();
  const badB = new Set();
  for (const s of sentences) {
    const w = s.toLowerCase().match(/[a-z0-9']+/g) || [];
    for (const x of w) if (DISTINCT.has(x) && refW.has(h(x))) badW.add(x);
    const fn = (x) => STOP.has(x) || x.length <= 3;
    for (let i = 0; i < w.length - 1; i++) if (!(fn(w[i]) && fn(w[i + 1])) && refB.has(h(w[i] + ' ' + w[i + 1]))) badB.add(w[i] + ' ' + w[i + 1]);
  }
  ok(!badB.size, `shared 2-grams: ${[...badB].join(' / ')}`);
  ok(!badW.size, `shared words: ${[...badW].join(', ')}`);
});

await gate('gate-warning: scanner never blanket-rejects 0x hex; matches against stated registry', () => {
  const evm = '0x' + 'ab12'.repeat(10);
  const sol = fakeAddress(5);
  const none = new Set();
  ok(scanAddresses(`x ${evm} y`, none).length === 1, '0x address not flagged when unregistered');
  ok(scanAddresses(`x ${evm} y`, new Set([evm])).length === 0, '0x address rejected although stated in registry');
  ok(scanAddresses(`x ${sol} y`, none).length === 1, 'base58 not flagged when unregistered');
  ok(scanAddresses(`x ${sol} y`, new Set([sol])).length === 0, 'base58 rejected although stated');
  ok(scanAddresses('colour 0xff00ff and 0x1234', none).length === 0, 'short 0x hex wrongly rejected');
});

await gate('gate-warning: shipped static files carry no unregistered address-shaped string', () => {
  const stated = statedValues(shipped);
  for (const f of distFiles.filter((f) => textExt.test(f) && !f.endsWith('register.json'))) {
    const bad = scanAddresses(read(f), stated);
    ok(!bad.length, `${rel(f)}: ${bad[0]}`);
  }
});

await gate('mutation harness: anchors are state-independent (idempotent from any starting state)', () => {
  for (const start of ['stated', 'absent', 'unconfirmed']) {
    const reg = readShippedRegister();
    reg.records.ca = { label: 'CA', state: start, ...(start === 'stated' ? { value: 'old' } : {}), source: 's', scope: 'c', recorded: 'r' };
    forceState(reg, 'ca', 'stated', { value: FAKE_CA });
    ok(reg.records.ca.value === FAKE_CA && reg.records.ca.state === 'stated', `stated from ${start}`);
    forceState(reg, 'ca', 'absent');
    ok(!('value' in reg.records.ca) && reg.records.ca.state === 'absent', `absent from ${start}`);
  }
  const reg = readShippedRegister();
  reg.records['market-source'] = { label: 'Market', state: 'absent' };
  tuneMarket(reg, { pollMs: 1500 });
  ok(reg.records['market-source'].url && reg.records['market-source'].pollMs === 1500, 'tuneMarket from absent');
});

/* ================= runtime gates ================= */
const env = await launch();

await gate('brand: tokens derive from the logo pixels; favicon grid and mascot re-trace identically', async () => {
  const b = await env.spawn();
  const t = await traceBrand(b);
  await env.release(b);
  ok(t.ground.every((v) => v === 0), `ground ${t.ground}`);
  const L = srgbGreyToOklchL(t.ink);
  const tokens = read(path.join(ROOT, 'src/tokens.css'));
  const inkL = Number(tokens.match(/--ink:\s*oklch\(([\d.]+) 0 0\)/)[1]);
  ok(Math.abs(inkL - L) < 0.002, `ink token ${inkL} vs logo ${L.toFixed(4)}`);
  const lightness = new Set([...tokens.matchAll(/oklch\(([\d.]+) 0 0/g)].map((m) => Number(m[1])));
  ok([...lightness].every((v) => v === 0 || v === inkL), `tokens introduce lightness beyond ground/ink: ${[...lightness]}`);
  const saved = JSON.parse(read(path.join(ROOT, 'src/favicon-grid.json'))).grid;
  ok(JSON.stringify(saved) === JSON.stringify(t.grid), 'favicon-grid.json does not match a fresh trace of the logo');
  const m = fs.readFileSync(path.join(DIST, 'assets/mascot.png'));
  ok(m.readUInt32BE(16) === t.mascotSize[0] && m.readUInt32BE(20) === t.mascotSize[1] && m[25] === 6, 'mascot asset dimensions or colourtype');
});
const base = { data: makeMarket() };
const caAbsent = (r) => forceState(r, 'ca', 'absent');
const caLive = (r) => forceState(r, 'ca', 'stated', { value: FAKE_CA });
const marketSig = async (page) => {
  const read = () => page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th)')].map((r) => r.dataset.address + '|' + r.querySelector('.sym').textContent + '|' + [...r.querySelectorAll('.v')].map((v) => v.textContent).join('/')).join(';') + '#' + document.querySelector('[data-tk-track]').innerText);
  let prev = await read();
  for (let i = 0; i < 60; i++) {
    await sleep(400); // count-ups are springs: wait until two reads agree
    const cur = await read();
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
};
// Count-ups are springs: wait until every animated number has landed on its target.
const settle = async (page, timeout = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const done = await page.evaluate(() => [...document.querySelectorAll('.v, [data-fig], [data-total]')].every((n) => n._job == null || n._shown === n._to));
    if (done) return;
    await sleep(250);
  }
};
const addrSig =(page) => page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th)')].map((r) => r.dataset.address + '|' + r.dataset.ready + '|' + r.querySelector('.sym').textContent).join(';'));
const domText = (page) => page.evaluate(() => {
  const attrs = [];
  document.querySelectorAll('*').forEach((n) => {
    for (const a of ['title', 'aria-label', 'alt', 'placeholder', 'content', 'aria-description']) if (n.hasAttribute(a)) attrs.push(n.getAttribute(a));
  });
  return document.body.innerText + '\n' + attrs.join('\n');
});

try {
  let SA = null;
  let SL = null;
  const alive = async (x) => { try { await x.page.evaluate(() => 1); return true; } catch { return false; } };
  const ensureA = async () => { if (!SA || !(await alive(SA))) { if (SA) await SA.close().catch(() => {}); SA = await openScenario(env, { ...base, mutate: caAbsent, rows: true }); } return SA; };
  const ensureL = async () => { if (!SL || !(await alive(SL))) { if (SL) await SL.close().catch(() => {}); SL = await openScenario(env, { ...base, mutate: caLive, rows: true }); } return SL; };


  await gate('ca/stated branch: full address, click copies it, feedback shows then clears', async () => {
    const L = await ensureL();
    const t = await L.page.$eval('[data-ca-value]', (n) => n.textContent);
    ok(t === FAKE_CA, 'address not shown in full');
    await L.page.click('[data-ca] button');
    await sleep(100);
    const r = await L.page.evaluate(() => ({ copied: window.__copied, fb: document.querySelector('[data-ca] button').dataset.copied, live: document.querySelector('[data-live]').textContent, act: getComputedStyle(document.querySelector('[data-ca-act]'), '::before').content }));
    ok(r.copied[0] === FAKE_CA, 'clipboard value wrong');
    ok(r.fb === 'true' && /copied/.test(r.act) && /Copied/.test(r.live), `feedback ${JSON.stringify(r)}`);
    await sleep(1900);
    ok((await L.page.$eval('[data-ca] button', (n) => n.dataset.copied)) === undefined, 'feedback stuck');
  });

  await gate('ca/stated: registry list shows the address and the CA scanner exemption holds', async () => {
    const L = await ensureL();
    const outside = await L.page.evaluate(() => {
      const c = document.documentElement.cloneNode(true);
      c.querySelectorAll('[data-ca],[data-market-section],[data-market],[data-tk-track],[data-facts]').forEach((n) => n.remove());
      return c.outerHTML;
    });
    ok(!scanAddresses(outside, new Set()).length, 'address-shaped string outside exempt zones');
  });


  await gate('ca/absent branch: top, visible, label + pending, no value, no control, no href', async () => {
    const A = await ensureA();
    await A.page.bringToFront();
    const r = await A.page.evaluate(() => {
      const root = document.querySelector('[data-ca]');
      const b = root.getBoundingClientRect();
      return {
        state: root.dataset.state, text: root.innerText.replace(/\s+/g, ' ').trim(), top: b.top, h: b.height,
        controls: root.querySelectorAll('button,a,[href],input').length, size: parseFloat(getComputedStyle(root.querySelector('[data-ca-value]')).fontSize)
      };
    });
    ok(r.state === 'absent' && r.text === 'CA pending', `text "${r.text}"`);
    ok(r.top <= 60 && r.h > 40, `slot not at top: ${r.top}`);
    ok(r.controls === 0, 'inert CA has a control');
    ok(r.size >= 15, 'CA font not large');
    await A.page.click('[data-ca] .ca-in');
    ok((await A.page.evaluate(() => window.__copied.length)) === 0, 'inert CA copied');
  });

  await gate('market is untouched by CA state (same rows, ticker, fetch count)', async () => {
    const L = await ensureL();
    const A = await ensureA();
    const ident = (page) => page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th)')].map((r) => r.dataset.address + '|' + r.querySelector('.sym').textContent).join(';') + '#' + [...document.querySelectorAll('[data-tk-track] .tk-group:first-child .tk-sym')].map((n) => n.textContent).join());
    ok((await ident(L.page)) === (await ident(A.page)), 'market differs between CA states');
    const targets = (page) => page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th) .v')].map((v) => v._to).join(',') + '#' + document.querySelector('[data-total]')._to);
    ok((await targets(L.page)) === (await targets(A.page)), 'market figures differ between CA states');
    ok(A.log.boostHits.length >= 1 && L.log.boostHits.length >= 1, 'market not fetched in a CA state');
  });


  await gate('market: top ten, Solana only, sorted by 24h volume, columns filled', async () => {
    const A = await ensureA();
    await A.page.bringToFront();
    const rows = await A.page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th)')].map((r) => ({
      sym: r.querySelector('.sym').textContent, addr: r.dataset.address, ready: r.dataset.ready,
      vals: [...r.querySelectorAll('.v')].map((v) => v.textContent), vol: r.querySelector('[data-v=volume]').textContent
    })));
    ok(rows.length === 10 && rows.every((r) => r.ready === 'true'), 'not 10 ready rows');
    ok(rows.map((r) => r.sym).join() === 'ALFA,BRAVO,CIRRUS,DELTA,EMBER,FLUX,GLINT,HALO,ION,JADE', `order ${rows.map((r) => r.sym)}`);
    ok(!rows.some((r) => r.sym === 'OTHR'), 'non-Solana entry leaked');
    ok(rows.every((r) => r.vals.every((v) => v && v !== '—')), 'empty cell');
    ok(rows.every((r) => /^[1-9A-HJ-NP-Za-km-z]{44}$/.test(r.addr)), 'address attr');
    const dir = await A.page.$$eval('.mk-c[data-k=change]', (n) => n.map((c) => c.dataset.dir).filter(Boolean));
    ok(dir.includes('up') && dir.includes('down'), 'change direction markers missing');
  });

  await gate('market: logos load, missing/failed logos become letter tiles', async () => {
    const A = await ensureA();
    await A.page.bringToFront();
    const t = await A.page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th) .tile')].map((n) => ({ fb: n.dataset.fallback, img: !!n.querySelector('img'), letter: n.querySelector('.tile-l').textContent, shown: getComputedStyle(n.querySelector('.tile-l')).visibility })));
    ok(t[0].fb === 'false' && t[0].img && t[0].shown === 'hidden', 'good logo');
    ok(t[2].fb === 'true' && t[2].letter === 'C' && t[2].shown === 'visible', 'missing imageUrl not a tile');
    ok(t[4].fb === 'true' && t[4].letter === 'E' && !t[4].img, 'failed image not a tile');
  });

  await gate('market: copy-per-address button copies the full address with feedback', async () => {
    const A = await ensureA();
    await A.page.bringToFront();
    const first = await A.page.$eval('.mk-row:not(.mk-th)', (r) => r.dataset.address);
    const btns = await A.page.$$('.mk-row:not(.mk-th) .copy');
    ok(btns.length === 10, 'copy buttons');
    await btns[0].click();
    await sleep(120);
    const r = await A.page.evaluate(() => ({ c: window.__copied.at(-1), fb: document.querySelector('.mk-row .copy').dataset.copied }));
    ok(r.c === first && r.fb === 'true', `copy or feedback failed ${JSON.stringify({ ...r, first })}`);
  });

  await gate('market: ticker uses the same live data as the table', async () => {
    const A = await ensureA();
    await A.page.bringToFront();
    await settle(A.page);
    const r = await A.page.evaluate(() => ({
      rows: [...document.querySelectorAll('.mk-row:not(.mk-th) .sym')].map((n) => n.textContent),
      tk: [...document.querySelectorAll('[data-tk-track] .tk-group:first-child .tk-sym')].map((n) => n.textContent),
      groups: document.querySelectorAll('[data-tk-track] .tk-group').length,
      anim: getComputedStyle(document.querySelector('[data-tk-track]')).animationName,
      pr: [...document.querySelectorAll('[data-tk-track] .tk-group:first-child .tk-price')].map((n) => n.textContent),
      tp: [...document.querySelectorAll('.mk-row:not(.mk-th) [data-v=price]')].map((n) => n.textContent)
    }));
    ok(r.rows.join() === r.tk.join() && r.groups === 2, 'ticker symbols differ');
    ok(r.pr.join() === r.tp.join(), 'ticker prices differ');
    ok(r.anim === 'tk-run', 'ticker not running');
  });

  await gate('status pill: live text with pulsing dot; aggregates, chart and figures filled', async () => {
    const A = await ensureA();
    await A.page.bringToFront();
    await settle(A.page);
    const r = await A.page.evaluate(() => ({
      pills: [...document.querySelectorAll('[data-pill]')].map((p) => p.textContent.trim() + ':' + p.dataset.status),
      pulse: getComputedStyle(document.querySelector('.pill[data-status=live] .dot'), '::after').animationName,
      figs: [...document.querySelectorAll('[data-fig]')].map((n) => n.textContent),
      total: document.querySelector('[data-total]').textContent,
      drawn: document.querySelector('[data-chart]').dataset.drawn,
      d: document.querySelector('[data-chart-vol]').getAttribute('d').length
    }));
    ok(r.pills.every((p) => p === 'live:live'), String(r.pills));
    ok(r.pulse === 'ping', 'dot not pulsing');
    ok(r.figs.every((f) => f && f !== '—') && r.total !== '—' && r.drawn === 'true' && r.d > 40, JSON.stringify(r));
    ok(r.figs[0] === '10' && r.figs[1] === '12', `counts ${r.figs.slice(0, 2)}`);
  });

  if (SL) await SL.close().catch(() => {});
  if (SA) await SA.close().catch(() => {});

  await gate('social: both icons present and inert (no href) in default and forced-absent state', async () => {
    for (const mut of [(r) => { forceState(r, 'x', 'absent'); forceState(r, 'github', 'absent'); }]) {
      const s = await openScenario(env, { ...base, mutate: mut });
      const r = await s.page.evaluate(() => ['x', 'github'].map((id) => {
        const n = document.querySelector(`[data-social="${id}"]`);
        const b = n.getBoundingClientRect();
        return { tag: n.tagName, href: n.getAttribute('href'), dis: n.getAttribute('aria-disabled'), label: n.getAttribute('aria-label'), w: b.width, h: b.height, right: b.right, svg: !!n.querySelector('svg path') };
      }));
      await s.close();
      ok(r.every((x) => x.tag === 'SPAN' && x.href === null && x.dis === 'true' && x.svg && /pending/.test(x.label) && x.w >= 44 && x.h >= 44), JSON.stringify(r));
    }
  });

  await gate('social: stated records link out, handle derived from the stored URL', async () => {
    const s = await openScenario(env, { ...base, mutate: (r) => { forceState(r, 'x', 'stated', { url: 'https://x.com/agentvaloria' }); forceState(r, 'github', 'stated', { url: 'https://github.com/agentvaloria/app' }); } });
    const r = await s.page.evaluate(() => ['x', 'github'].map((id) => {
      const a = document.querySelector(`[data-social="${id}"]`);
      return { tag: a.tagName, href: a.href, rel: a.rel, target: a.target, label: a.getAttribute('aria-label'), w: a.getBoundingClientRect().width };
    }));
    const facts = await s.page.$eval('[data-facts]', (n) => n.innerText);
    await s.close();
    ok(r[0].tag === 'A' && r[0].href === 'https://x.com/agentvaloria' && r[0].label === 'X @agentvaloria', JSON.stringify(r[0]));
    ok(r[1].href === 'https://github.com/agentvaloria/app' && r[1].label === 'GitHub @agentvaloria' && /noopener/.test(r[1].rel) && r[1].target === '_blank', JSON.stringify(r[1]));
    ok(/@agentvaloria/.test(facts), 'register list lacks handle');
  });

  await gate('register: a stated record with a bad payload is demoted to inert at runtime', async () => {
    const s = await openScenario(env, { ...base, mutate: (r) => { forceState(r, 'ca', 'stated', { value: 'not-an-address' }); forceState(r, 'x', 'stated', { url: 'javascript:alert(1)' }); } });
    const r = await s.page.evaluate(() => ({ ca: document.querySelector('[data-ca]').innerText.replace(/\s+/g, ' ').trim(), x: document.querySelector('[data-social=x]').tagName }));
    await s.close();
    ok(r.ca === 'CA pending' && r.x === 'SPAN', JSON.stringify(r));
  });

  await gate('no dates anywhere in rendered text, attributes, tooltips or aria-labels (all CA/market states)', async () => {
    for (const mut of [caAbsent, caLive]) {
      const s = await openScenario(env, { ...base, mutate: mut, rows: true });
      await s.page.hover('.mk-row:not(.mk-th)');
      const t = await domText(s.page);
      const m = dateHit(t.replace(/\b24h\b/g, ''));
      await s.close();
      ok(!m, `date-like string "${m && m[0]}"`);
    }
    const off = await openScenario(env, { ...base, mutate: (r) => { r.records['market-source'] = { label: 'Market', state: 'absent' }; }, boost: () => ({ status: 500 }) });
    const m = dateHit(await domText(off.page));
    await off.close();
    ok(!m, `date-like string in inert market "${m && m[0]}"`);
  });

  await gate('address scanner on rendered DOM: nothing address-shaped outside CA and market zones (CA absent)', async () => {
    const a = await openScenario(env, { ...base, mutate: caAbsent, rows: true });
    const outside = await a.page.evaluate(() => {
      const c = document.documentElement.cloneNode(true);
      c.querySelectorAll('[data-ca],[data-market-section],[data-market],[data-tk-track]').forEach((n) => n.remove());
      return c.outerHTML;
    });
    ok(!scanAddresses(outside, statedValues(readShippedRegister())).length, 'stray address');
    await a.close();
  });

  await gate('scroll progress bar fixed at top and grows with scroll; reveals complete', async () => {
    const a = await openScenario(env, { ...base, mutate: caAbsent, rows: true });
    const top = await a.page.evaluate(() => { const b = document.querySelector('[data-progress]'); const r = b.getBoundingClientRect(); return { pos: getComputedStyle(b).position, y: r.top, s: b.style.transform }; });
    ok(top.pos === 'fixed' && top.y === 0, 'bar not fixed top');
    await scrollThrough(a.page, 400);
    await a.page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await sleep(300);
    const end = await a.page.$eval('[data-progress]', (b) => b.style.transform);
    ok(/scaleX\(0?\.9|scaleX\(1/.test(end), `progress at end ${end}`);
    await scrollThrough(a.page, 1800);
    const left = await a.page.$$eval('[data-reveal]', (n) => n.filter((e) => e.dataset.revealed !== 'true').length);
    ok(left === 0, `${left} elements never revealed`);
    await a.close();
  });

  await gate('parallax layers move with the pointer (spring smoothed)', async () => {
    const s = await openScenario(env, base);
    await s.page.bringToFront();
    await s.page.mouse.move(100, 100);
    await sleep(900);
    const a = await s.page.$$eval('[data-depth]', (n) => n.map((e) => e.style.transform));
    await s.page.mouse.move(1300, 700);
    await sleep(900);
    const b = await s.page.$$eval('[data-depth]', (n) => n.map((e) => e.style.transform));
    await s.close();
    ok(a.every((t, i) => t && t !== b[i]), 'layers did not move');
  });

  await gate('spotlight hover tracks the pointer on rows', async () => {
    const a = await openScenario(env, { ...base, mutate: caAbsent, rows: true });
    const box = await a.page.$eval('.mk-row:not(.mk-th)', (r) => { r.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y }; });
    await sleep(500);
    const b2 = await a.page.$eval('.mk-row:not(.mk-th)', (r) => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y }; });
    await a.page.mouse.move(b2.x + 120, b2.y + 20);
    await sleep(100);
    const v = await a.page.$eval('.mk-row:not(.mk-th)', (r) => r.style.getPropertyValue('--mx'));
    void box;
    ok(/^\d/.test(v), `--mx ${v}`);
    await a.close();
  });

  await gate('market: skeletons first, then fade-in stagger to data', async () => {
    const s = await openScenario(env, { ...base, wait: 'none', boost: () => ({ delay: 900 }) });
    await sleep(350);
    const early = await s.page.evaluate(() => ({ ready: [...document.querySelectorAll('.mk-row:not(.mk-th)')].map((r) => r.dataset.ready), sk: getComputedStyle(document.querySelector('.mk-row .sk')).opacity, anim: getComputedStyle(document.querySelector('.mk-row .sk')).animationName, tk: document.querySelector('[data-tk]').dataset.state, pill: document.querySelector('[data-pill-text]').textContent }));
    ok(early.ready.every((r) => r === 'false') && early.sk === '1' && early.anim === 'shimmer' && early.tk === 'loading' && early.pill === 'syncing', JSON.stringify(early));
    await waitFor(s.page, () => document.querySelectorAll('.mk-row[data-ready=true]').length > 0 && document.querySelectorAll('.mk-row[data-ready=true]').length < 10, 4000).catch(() => {});
    const order = await s.page.evaluate(() => [...document.querySelectorAll('.mk-row:not(.mk-th)')].map((r) => getComputedStyle(r.querySelector('.v')).transitionDelay));
    await waitFor(s.page, () => document.querySelectorAll('.mk-row[data-ready=true]').length === 10, 6000);
    await s.close();
    const d = order.map((x) => parseFloat(x));
    ok(d[9] > d[0] && d.every((x, i) => i === 0 || x >= d[i - 1]), `stagger delays ${order}`);
  });

  await gate('market: numbers count up through intermediate values before settling', async () => {
    const s = await openScenario(env, { ...base, wait: 'none' });
    const seen = await s.page.evaluate(async () => {
      const out = new Set();
      for (let i = 0; i < 400; i++) { out.add(document.querySelector('[data-total]').textContent); await new Promise((r) => setTimeout(r, 30)); }
      return [...out];
    });
    await s.close();
    ok(seen.length >= 4 && seen.at(-1) === '$63M', `values seen: ${seen}`);
  });

  await gate('market: changed values flash on refresh', async () => {
    const data = makeMarket();
    const s = await openScenario(env, { data, mutate: (r) => tuneMarket(r, { pollMs: 1200 }), wait: 'none' });
    await waitFor(s.page, () => document.querySelectorAll('.mk-row[data-ready=true]').length === 10, 6000);
    await sleep(800);
    data.pairs.forEach((p) => { if (p.volume.h24 > 100) p.volume.h24 += 123456; });
    await waitFor(s.page, () => !!document.querySelector('.v.flash'), 6000);
    await s.close();
  });

  await gate('market: polls on schedule, pauses while hidden, fetches immediately on visible', async () => {
    const s = await openScenario(env, { ...base, mutate: (r) => tuneMarket(r, { pollMs: 1200 }), wait: 'none' });
    await sleep(4800);
    const live = s.log.boostHits.length;
    ok(live >= 3, `only ${live} polls in 4.8s`);
    await s.page.evaluate(() => window.__setHidden(true));
    await sleep(300);
    const at = s.log.boostHits.length;
    await sleep(3600);
    ok(s.log.boostHits.length === at, 'polled while hidden');
    const t0 = Date.now();
    await s.page.evaluate(() => window.__setHidden(false));
    await waitFor(s.page, () => true);
    await sleep(500);
    ok(s.log.boostHits.length === at + 1 && s.log.boostHits.at(-1) - t0 < 700, 'no immediate fetch on visible');
    await s.close();
  });

  await gate('market: default poll interval is 60s from the register record', () => {
    ok(readShippedRegister().records['market-source'].pollMs === 60000, 'pollMs');
  });

  await gate('market failure: dash + error shown, retries back off exponentially', async () => {
    const s = await openScenario(env, { ...base, mutate: (r) => tuneMarket(r, { backoff: { baseMs: 300, maxMs: 5000, factor: 2 } }), boost: () => ({ status: 500 }), wait: 'none' });
    for (let i = 0; i < 160 && s.log.boostHits.length < 5; i++) await sleep(250);
    const r = await s.page.evaluate(() => ({ pill: document.querySelector('[data-pill-text]').textContent, note: document.querySelector('[data-mk-note]').textContent, hidden: document.querySelector('[data-mk-note]').hidden, cells: [...document.querySelectorAll('.mk-row:not(.mk-th) .v')].map((v) => v.textContent), total: document.querySelector('[data-total]').textContent, ready: document.querySelector('.mk-row:not(.mk-th)').dataset.ready }));
    const h = s.log.boostHits;
    await s.close();
    ok(r.pill === 'offline' && !r.hidden && /not answering/.test(r.note) && r.ready === 'error', JSON.stringify({ ...r, cells: r.cells.length }));
    ok(r.cells.every((c) => c === '—') && r.total === '—', 'dashes missing');
    ok(h.length >= 4, `only ${h.length} attempts`);
    const gaps = h.slice(1).map((t, i) => t - h[i]);
    ok(gaps[1] > gaps[0] * 1.5 && gaps[2] > gaps[1] * 1.5, `gaps not growing: ${gaps}`);
  });

  await gate('market failure after success: last good data kept, status stale, recovers', async () => {
    const s = await openScenario(env, { ...base, mutate: (r) => tuneMarket(r, { pollMs: 700, backoff: { baseMs: 400, maxMs: 2000, factor: 2 } }), boost: (n) => (n >= 2 && n <= 3 ? { status: 503 } : {}), wait: 'none' });
    await waitFor(s.page, () => document.querySelectorAll('.mk-row[data-ready=true]').length === 10, 6000);
    const before = await addrSig(s.page);
    await waitFor(s.page, () => document.querySelector('[data-pill-text]').textContent === 'stale', 6000);
    const mid = await s.page.evaluate(() => ({ rows: document.querySelectorAll('.mk-row[data-ready=true]').length, note: document.querySelector('[data-mk-note]').textContent }));
    ok(mid.rows === 10 && /Earlier good/.test(mid.note), JSON.stringify(mid));
    ok((await addrSig(s.page)) === before, 'data changed on failure');
    await waitFor(s.page, () => document.querySelector('[data-pill-text]').textContent === 'live', 8000);
    await s.close();
  });

  await gate('market source inert: no request is made and the panel reads pending', async () => {
    const s = await openScenario(env, { ...base, mutate: (r) => forceState(r, 'market-source', 'absent') });
    await sleep(800);
    const r = await s.page.evaluate(() => ({ pill: document.querySelector('[data-pill-text]').textContent, rows: [...document.querySelectorAll('.mk-row:not(.mk-th)')].filter((x) => !x.hidden).length, note: document.querySelector('[data-mk-note]').textContent }));
    const hits = s.log.boostHits.length + s.log.pairHits.length;
    await s.close();
    ok(hits === 0 && r.pill === 'pending' && r.rows === 0 && /No market source/.test(r.note), JSON.stringify({ hits, ...r }));
  });

  await gate('reduced motion: nothing animates, content is visible at once, numbers land instantly', async () => {
    const s = await openScenario(env, { ...base, reducedMotion: true, wait: 'none' });
    await waitFor(s.page, () => document.querySelectorAll('.mk-row[data-ready=true]').length === 10, 6000);
    const r = await s.page.evaluate(() => ({
      anims: document.getAnimations().length, motionClass: document.documentElement.classList.contains('motion'),
      hiddenReveal: [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1').length,
      tk: getComputedStyle(document.querySelector('[data-tk-track]')).animationName,
      layers: [...document.querySelectorAll('[data-depth]')].map((l) => l.style.transform).filter(Boolean).length,
      total: document.querySelector('[data-total]').textContent, ca: getComputedStyle(document.querySelector('.mk-row .v')).transitionDuration
    }));
    await s.page.mouse.move(700, 300);
    await sleep(300);
    const moved = await s.page.$$eval('[data-depth]', (n) => n.filter((l) => l.style.transform).length);
    await s.close();
    ok(r.anims === 0, `${r.anims} running animations`);
    ok(!r.motionClass && r.hiddenReveal === 0 && r.tk === 'none' && r.layers === 0 && moved === 0 && r.total === '$63M' && /^0s/.test(r.ca), JSON.stringify({ ...r, moved }));
  });

  await gate('network: only mocked/expected hosts are contacted, no console or page errors', async () => {
    const s = await openScenario(env, { ...base, rows: true });
    const hosts = [...s.log.hosts].filter((h) => !/^127\.0\.0\.1/.test(h));
    const bad = hosts.filter((h) => !['fonts.googleapis.com', 'api.dexscreener.com', 'img.test'].includes(h));
    const errs = [...s.log.consoleErrors, ...s.log.pageErrors];
    await s.close();
    ok(!bad.length && !s.log.unexpected.length, `unexpected hosts ${bad} ${s.log.unexpected}`);
    ok(!errs.length, errs.join(' | '));
  });

  for (const bp of BREAKPOINTS) {
    await gate(`breakpoint ${bp.name}: no overflow, 44x44 taps, icons top-right, CA visible, no ch`, async () => {
      for (const mut of [caAbsent, caLive]) {
        const s = await openScenario(env, { ...base, width: bp.width, height: bp.height, mutate: mut, rows: true });
        await scrollThrough(s.page, 1500);
        const r = await s.page.evaluate((vw) => {
          const small = [...document.querySelectorAll('a[href], button, [role=link], [data-social]')].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && getComputedStyle(n).visibility !== 'hidden' && (b.width < 43.5 || b.height < 43.5); }).map((n) => n.outerHTML.slice(0, 60) + ' ' + Math.round(n.getBoundingClientRect().width) + 'x' + Math.round(n.getBoundingClientRect().height));
          const icons = ['x', 'github'].map((id) => { const b = document.querySelector(`[data-social="${id}"]`).getBoundingClientRect(); return { right: b.right, left: b.left, top: b.top, w: b.width }; });
          const ca = document.querySelector('[data-ca]').getBoundingClientRect();
          const caIn = document.querySelector('.ca-in').getBoundingClientRect();
          return { sw: document.documentElement.scrollWidth, small, icons, caTop: ca.top, caIn: [caIn.left, caIn.right], vw };
        }, bp.width);
        await s.close();
        ok(r.sw <= bp.width, `horizontal overflow ${r.sw} > ${bp.width}`);
        ok(!r.small.length, `small targets: ${r.small.join('; ')}`);
        ok(r.icons.every((i) => i.w >= 44 && i.top >= 0 && i.top < 44 && i.left > bp.width / 2 && i.right <= bp.width), `icons ${JSON.stringify(r.icons)}`);
        ok(r.caTop >= 0 && r.caTop < 60 && r.caIn[0] >= 0 && r.caIn[1] <= bp.width, `CA slot ${JSON.stringify(r)}`);
      }
    });
  }
} finally {
  await env.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nGATES: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
