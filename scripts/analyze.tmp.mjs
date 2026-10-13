import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser, ROOT } from './lib/harness.mjs';

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('about:blank');
for (const f of ['brand/LOGO VALORIA PNG.png', 'brand/LOGO VALORIA PNG...png']) {
  const b64 = fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const r = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const exact = new Map();
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, spread = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] > 0) {
        const k = `${d[i]},${d[i + 1]},${d[i + 2]},a${d[i + 3]}`;
        exact.set(k, (exact.get(k) || 0) + 1);
        spread = Math.max(spread, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
      }
      const lum = d[i + 3] === 255 ? d[i] : d[i + 3] ? 255 : 0;
      if (lum > 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    return { top: [...exact.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), spread, bbox: [minX, minY, maxX, maxY] };
  }, b64);
  console.log(f, JSON.stringify(r));
}
await browser.close();
