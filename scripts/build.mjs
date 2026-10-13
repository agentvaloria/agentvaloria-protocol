// Copies src/ into dist/ and derives the favicon from the tokens file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true });

const tokens = fs.readFileSync(path.join(src, 'tokens.css'), 'utf8');
const token = (name) => {
  const m = tokens.match(new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`));
  if (!m) throw new Error(`token --${name} missing`);
  return m[1];
};

// Favicon: one rect per horizontal run of equal coverage, read off the traced 32x32 grid.
const { grid } = JSON.parse(fs.readFileSync(path.join(src, 'favicon-grid.json'), 'utf8'));
const rects = [];
grid.forEach((row, y) => {
  let x = 0;
  while (x < row.length) {
    const a = row[x];
    if (!a) {
      x++;
      continue;
    }
    let w = 1;
    while (x + w < row.length && row[x + w] === a) w++;
    rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill-opacity="${(a / 255).toFixed(2)}"/>`);
    x += w;
  }
});
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">
<rect x="0.5" y="0.5" width="31" height="31" rx="6" fill="${token('ground')}" stroke="${token('line-2')}"/>
<g fill="${token('ink')}">
${rects.join('\n')}
</g>
</svg>
`;
fs.writeFileSync(path.join(dist, 'favicon.svg'), favicon);

const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://api.dexscreener.com; base-uri 'none'; frame-ancestors 'none'

/register.json
  Cache-Control: no-cache
`;
fs.writeFileSync(path.join(dist, '_headers'), headers);

const count = fs.readdirSync(dist, { recursive: true }).filter((f) => fs.statSync(path.join(dist, f)).isFile()).length;
console.log(`build ok: ${count} files in dist/`);
