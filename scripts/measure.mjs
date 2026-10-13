// Layout measurements at 360 / 390 / 430 / 1366 / 1440. Read-only; prints a table.
import { BREAKPOINTS, launch, openScenario, scrollThrough } from './lib/harness.mjs';

const env = await launch();
const rows = [];
for (const bp of BREAKPOINTS) {
  const s = await openScenario(env, { width: bp.width, height: bp.height, rows: true });
  await scrollThrough(s.page, 1500);
  const m = await s.page.evaluate(() => {
    const box = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const taps = [...document.querySelectorAll('a[href], button, [data-social]')].filter((n) => n.getBoundingClientRect().width > 0);
    const small = taps.filter((n) => { const b = n.getBoundingClientRect(); return b.width < 43.5 || b.height < 43.5; });
    const fs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      docHeight: document.documentElement.scrollHeight,
      header: box('.bar'),
      ca: box('[data-ca] .ca-in'),
      caFont: fs('[data-ca-value]'),
      icons: ['x', 'github'].map((id) => box(`[data-social="${id}"]`)),
      h1: { ...box('.fp-h1'), font: fs('.fp-h1') },
      tableW: box('.mk').w,
      row: box('.mk-row:not(.mk-th)'),
      tapTargets: taps.length,
      smallTargets: small.length,
      canvas: box('[data-field]'),
      figs: box('.fp-figs')
    };
  });
  await s.close();
  rows.push({ bp: bp.name, ...m });
}
await env.close();

let bad = 0;
for (const r of rows) {
  const iconsOk = r.icons.every((i) => i && i.w >= 44 && i.h >= 44 && i.x + i.w <= Number(r.bp) && i.x > Number(r.bp) / 2);
  const ok = r.scrollWidth <= Number(r.bp) && r.smallTargets === 0 && iconsOk;
  if (!ok) bad++;
  console.log(
    `${r.bp.padStart(5)}px  overflow:${r.scrollWidth <= Number(r.bp) ? 'none' : r.scrollWidth}  header:${r.header.h}  CA:${r.ca.w}x${r.ca.h}@y${r.ca.y} font ${r.caFont}px  ` +
      `icons:${r.icons.map((i) => `${i.w}x${i.h}@x${i.x}`).join(',')}  h1:${r.h1.w}x${r.h1.h} ${r.h1.font}px  table:${r.tableW}  row:${r.row.h}h  ` +
      `taps:${r.tapTargets} small:${r.smallTargets}  field:${r.canvas.w}x${r.canvas.h}  ${ok ? 'OK' : 'CHECK'}`
  );
}
process.exit(bad ? 1 : 0);
