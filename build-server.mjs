// Bundles the server (TypeScript + shared rules) into dist/server.js. "ws" stays an external runtime dependency.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });
await build({
  entryPoints: [join(root, 'server/src/index.ts')],
  outfile: join(root, 'dist', 'server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // dist/server.js resolves static/docs relative to the project root (one level up from dist/)
  define: {},
  logLevel: 'info',
});
console.log('server built -> dist/server.js');
