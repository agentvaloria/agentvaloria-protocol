import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from './lib/server.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { port } = await serveDir(dist, Number(process.env.PORT) || 4173);
console.log(`serving dist/ on http://127.0.0.1:${port}`);
