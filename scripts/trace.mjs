// One-off: derive the favicon grid and mascot image from brand/. Re-run when brand/ changes.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ROOT, findBrowser } from './lib/harness.mjs';
import { srgbGreyToOklchL, traceBrand } from './lib/trace.mjs';

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const t = await traceBrand(browser);
await browser.close();

fs.mkdirSync(path.join(ROOT, 'src/assets'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/favicon-grid.json'), JSON.stringify({ size: 32, source: 'brand logo, 32x32 coverage, alpha 0-255', grid: t.grid }));
fs.writeFileSync(path.join(ROOT, 'src/assets/mascot.png'), Buffer.from(t.mascot, 'base64'));
console.log('ground rgb', t.ground, 'ink grey', t.ink, 'bbox', t.bbox);
console.log('oklch L: ground', srgbGreyToOklchL(t.ground[0]).toFixed(4), 'ink', srgbGreyToOklchL(t.ink).toFixed(4));
console.log('mascot', t.mascotSize.join('x'), 'favicon lit cells', t.grid.flat().filter((v) => v > 0).length);
console.log(t.grid.map((r) => r.map((v) => ' .:-=+*#%@'[Math.min(9, v >> 5 + 0)]).join('')).join('\n'));
