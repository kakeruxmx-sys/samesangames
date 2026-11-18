// Browser test for the END of a match: starts the built server with a shortened match (PN_TEST_MATCH_SECONDS, test-only),
// plays 5 real Chromium pages through quick match -> match -> time-out -> results screen, then checks XP/profile and the report flow.
// NOTE: emulation only (headless Chromium + SwiftShader).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/npm-tools/node_modules/playwright/index.mjs'); }
const { chromium } = pw.chromium ? pw : pw.default;
const SHOTS = process.env.SHOT_DIR ? resolve(process.env.SHOT_DIR) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let ok = 0, bad = 0;
const check = (c, msg) => { if (c) { ok++; console.log('  ok   ' + msg); } else { bad++; console.log('  FAIL ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, label) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(200); } }

const data = mkdtempSync(join(tmpdir(), 'pn2-results-'));
const srv = spawn('node', ['dist/server.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, PN_TEST_MATCH_SECONDS: '25', MAX_NEW_PROFILES_PER_HOUR: '1000', MAX_CONN_PER_IP: '50' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const port = await until(() => /listening on http:\/\/[^:]+:(\d+)/.exec(log)?.[1], 8000, 'server start');
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const names = ['Ann', 'Ben', 'Cy', 'Dee', 'Eli'];
const pages = [];
for (const name of names) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pn2_prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] PAGEERR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${name}] ${m.text()}`); });
  pages.push({ p, name });
}
const scr = (pg) => pg.p.evaluate(() => document.querySelector('#screens .screen')?.dataset.scr ?? '');

try {
  await Promise.all(pages.map((pg) => pg.p.goto(base + '/')));
  for (const pg of pages) {
    await pg.p.fill('#name', pg.name); await pg.p.click('[data-a="enter"]');
    await until(async () => (await scr(pg)) === 'menu', 10000, 'menu');
    await pg.p.click('[data-a="play"]'); await pg.p.click('[data-a="quick"]');
  }
  const kp = await until(async () => { for (const pg of pages) if ((await scr(pg)) === 'pick') return pg; return null; }, 30000, 'pick screen');
  await kp.p.click('[data-a="kpick"]');
  await until(async () => (await Promise.all(pages.map((pg) => pg.p.evaluate(() => !!window.__pn?.app?.game?.snap)))).every(Boolean), 30000, 'all in game');
  check(true, 'match started with 5 human clients');
  const timeLeft = await pages[0].p.evaluate(() => window.__pn.app.game.snap.left);
  check(timeLeft <= 25.1, `short test match active (${timeLeft.toFixed(1)} s left)`);

  console.log('results flow');
  await until(async () => (await Promise.all(pages.map(scr))).every((s) => s === 'results'), 90000, 'results screens');
  check(true, 'all 5 clients reached the results screen when the timer ran out');
  await sleep(1200); // let the fade-in finish before taking screenshots
  if (SHOTS) for (const pg of pages) await pg.p.screenshot({ path: join(SHOTS, `results-${pg.name}.png`) });
  const texts = await Promise.all(pages.map((pg) => pg.p.evaluate(() => document.querySelector('.screen').innerText)));
  const roles = await Promise.all(pages.map((pg) => pg.p.evaluate(() => window.__pn.app.lastInit.role)));
  check(texts.every((t, i) => (roles[i] === 'K' ? /VICTORY/.test(t) : /DEFEAT/.test(t))), 'nobody escaped in time: killer sees VICTORY, survivors see DEFEAT');
  check(texts.every((t) => /XP/.test(t) && /勝利|参加/.test(t)), 'XP reward lines are shown');
  check(texts.every((t) => names.every((n) => t.includes(n))), 'results table lists all 5 human players');
  const prof = await Promise.all(pages.map((pg) => pg.p.evaluate(() => ({ xp: window.__pn.app.profile.xp, m: window.__pn.app.profile.matches }))));
  check(prof.every((x) => x.xp > 0 && x.m === 1), 'server updated every profile (xp > 0, matches = 1)');
  // report flow
  const reporter = pages[0];
  await reporter.p.click('.res [data-a="player"] >> nth=0');
  await reporter.p.waitForSelector('.modal');
  await reporter.p.click('.modal [data-w="迷惑行為・妨害"]');
  await reporter.p.waitForFunction(() => /通報を受け付けました/.test(document.getElementById('toast').innerText), null, { timeout: 5000 }).catch(() => {});
  check(await reporter.p.evaluate(() => /通報を受け付けました/.test(document.getElementById('toast').innerText)), 'report accepted by the server');
  const rf = join(data, 'reports.jsonl');
  await until(() => existsSync(rf), 3000, 'reports.jsonl');
  check(/迷惑行為/.test(readFileSync(rf, 'utf8')), 'report written to data/reports.jsonl');
  // mute/block toggles
  await reporter.p.click('.res [data-a="player"] >> nth=0'); await reporter.p.click('.modal #mm');
  check(await reporter.p.evaluate(() => window.__pn.app.muted.size === 1), 'mute/block stored on the client');
  // back to menu
  await reporter.p.click('[data-a="afterresults"]');
  await until(async () => ['menu', 'lobby'].includes(await scr(reporter)), 5000, 'after results');
  check(true, 'results -> back button works');
} catch (e) {
  bad++; console.log('  FAIL exception: ' + (e?.stack ?? e));
  if (SHOTS) for (const pg of pages) await pg.p.screenshot({ path: join(SHOTS, `zz-fail-${pg.name}.png`) }).catch(() => {});
}
check(errors.length === 0, 'no uncaught page errors / console errors' + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : ''));
await browser.close(); srv.kill('SIGTERM'); await sleep(300);
console.log(`\nbrowser results test: ${ok} ok, ${bad} failed`);
process.exit(bad ? 1 : 0);
