// Reads the brand PNGs through a real decoder (the browser canvas) and derives
// everything that must come from them: palette tones, the 32x32 favicon grid and
// a small mascot image. Used by scripts/trace.mjs and by the gates (re-derivation).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

export const LOGO_OPAQUE = 'brand/LOGO VALORIA PNG.png'; // RGBA, opaque black background
export const LOGO_ALPHA = 'brand/LOGO VALORIA PNG...png'; // RGBA, transparent background

export function srgbGreyToOklchL(v) {
  const c = v / 255;
  const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return Math.cbrt(lin);
}

export async function traceBrand(browser) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const b64 = (f) => fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const result = await page.evaluate(async (opaque, alpha) => {
    const load = async (b) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b;
      await img.decode();
      return img;
    };
    const px = (img) => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    };

    // 1. modal opaque colours of the opaque logo: background and stroke
    const o = px(await load(opaque));
    const counts = new Map();
    for (let i = 0; i < o.data.length; i += 4) {
      const k = o.data[i] + ',' + o.data[i + 1] + ',' + o.data[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const ground = sorted[0][0].split(',').map(Number);
    // stroke tone: the most common colour among the bright pixels (the solid stroke core)
    const hist = new Array(256).fill(0);
    for (let i = 0; i < o.data.length; i += 4) if (o.data[i] > 240) hist[o.data[i]]++;
    const ink = hist.indexOf(Math.max(...hist));

    // 2. bounding box of the stroke on the transparent logo
    const aImg = await load(alpha);
    const a = px(aImg);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (a.data[(y * a.width + x) * 4 + 3] > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;

    // 3. favicon: fit the mark into 32x32 with a 3px margin, area-average, alpha = coverage
    const SIZE = 32;
    const fit = SIZE - 6;
    const scale = fit / bh;
    const dw = bw * scale;
    const f = document.createElement('canvas');
    f.width = SIZE;
    f.height = SIZE;
    const fctx = f.getContext('2d', { willReadFrequently: true });
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    // two-step reduction keeps thin strokes from aliasing away
    const mid = document.createElement('canvas');
    mid.width = Math.ceil(bw / 4);
    mid.height = Math.ceil(bh / 4);
    const mctx = mid.getContext('2d');
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(aImg, minX, minY, bw, bh, 0, 0, mid.width, mid.height);
    fctx.drawImage(mid, (SIZE - dw) / 2, 3, dw, fit);
    const fd = fctx.getImageData(0, 0, SIZE, SIZE).data;
    const grid = [];
    for (let y = 0; y < SIZE; y++) {
      const row = [];
      for (let x = 0; x < SIZE; x++) {
        // coverage boost: a 32px favicon needs thin strokes lifted to read
        row.push(Math.min(255, Math.round(fd[(y * SIZE + x) * 4 + 3] * 3.2)));
      }
      grid.push(row);
    }

    // 4. mascot image for the page: cropped, 28px margin, 360px tall, white strokes on transparent
    const MH = 360;
    const pad = 12;
    const ms = (MH - pad * 2) / bh;
    const mc = document.createElement('canvas');
    mc.width = Math.ceil(bw * ms + pad * 2);
    mc.height = MH;
    const mx = mc.getContext('2d');
    mx.imageSmoothingQuality = 'high';
    mx.drawImage(aImg, minX, minY, bw, bh, pad, pad, bw * ms, bh * ms);
    return { ground, ink, bbox: [minX, minY, maxX, maxY], grid, mascot: mc.toDataURL('image/png').split(',')[1], mascotSize: [mc.width, mc.height] };
  }, b64(LOGO_OPAQUE), b64(LOGO_ALPHA));
  await page.close();
  return result;
}
