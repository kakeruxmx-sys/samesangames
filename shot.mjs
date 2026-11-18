// Dev helper: node scripts/shot.mjs "<query>" out.png [w h]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [query, out, w = '1280', h = '720'] = process.argv.slice(2);
const dir = path.resolve('dist/client');
const srv = http.createServer((q, s) => { const u = new URL(q.url, 'http://x'); let f = path.join(dir, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'text/plain' }); fs.createReadStream(f).pipe(s); }).listen(0);
const port = srv.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = []; p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await p.goto(`http://127.0.0.1:${port}/${query}`);
await p.waitForFunction(() => window.__frames > 3, null, { timeout: 30000 }).catch(() => errs.push('no frames'));
await p.waitForTimeout(400);
await p.screenshot({ path: out });
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'ok');
await b.close(); srv.close();
