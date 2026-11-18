// Bundles the client (TypeScript -> one minified ES module) and copies static files to dist/client.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'client');
const dev = process.argv.includes('--dev');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = { app: 'client/src/main.ts' };
if (existsSync(join(root, 'client/src/viewer.ts'))) entries.viewer = 'client/src/viewer.ts';

await build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, join(root, v)])),
  outdir: out,
  bundle: true,
  format: 'esm',
  target: ['es2020', 'chrome90', 'safari15', 'firefox95'],
  minify: !dev,
  sourcemap: dev,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
});

for (const f of ['index.html', 'style.css', 'viewer.html', 'manifest.webmanifest', 'favicon.svg']) {
  const src = join(root, 'client', f);
  if (existsSync(src)) cpSync(src, join(out, f));
}
if (existsSync(join(root, 'client/public'))) cpSync(join(root, 'client/public'), out, { recursive: true });
// cache-bust the bundle in index.html
const idx = join(out, 'index.html');
if (existsSync(idx)) writeFileSync(idx, readFileSync(idx, 'utf8').replace(/__BUILD__/g, String(Date.now())));
console.log('client built ->', out);
