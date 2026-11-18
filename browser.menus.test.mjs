// Browser test of the menu side: collection (all items), settings, profile rename, custom-room create/join/leave, touch layout editor,
// portrait hint. Fast (no match). Needs: npm run build, Playwright + Chromium.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/npm-tools/node_modules/playwright/index.mjs'); }
const { chromium, devices } = pw.chromium ? pw : pw.default;
const SHOTS = process.env.SHOT_DIR ? resolve(process.env.SHOT_DIR) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let ok = 0, bad = 0;
const check = (c, msg) => { if (c) { ok++; console.log('  ok   ' + msg); } else { bad++; console.log('  FAIL ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, label) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(150); } }

const data = mkdtempSync(join(tmpdir(), 'pn2-menus-'));
const srv = spawn('node', ['dist/server.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, MAX_NEW_PROFILES_PER_HOUR: '1000', MAX_CONN_PER_IP: '50' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const port = await until(() => /listening on http:\/\/[^:]+:(\d+)/.exec(log)?.[1], 8000, 'server start');
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function newPage(name, opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('pn2_prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] PAGEERR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${name}] ${m.text()}`); });
  return p;
}
const scr = (p) => p.evaluate(() => document.querySelector('#screens .screen')?.dataset.scr ?? '');
const snap = async (p, n) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, n + '.png') }); };
async function enter(p, name) { await p.goto(base + '/'); await p.fill('#name', name); await p.click('[data-a="enter"]'); await until(async () => (await scr(p)) === 'menu', 10000, 'menu ' + name); }

try {
  const A = await newPage('A', { viewport: { width: 960, height: 540 } });
  await enter(A, 'Menu1');

  console.log('collection');
  await A.click('[data-a="collection"]');
  for (const [tab, n] of [['killers', 5], ['survivors', 8], ['props', 35]]) {
    await A.click(`[data-a="ctab"][data-t="${tab}"]`);
    let seen = new Set();
    for (let i = 0; i < n; i++) { seen.add(await A.evaluate(() => document.querySelector('.kinfo h2')?.textContent ?? '')); await A.click('[data-a="cnext"]'); }
    check(seen.size === n && !seen.has(''), `collection/${tab}: ${n} distinct entries with info`);
    if (tab === 'props') await snap(A, 'menus-props');
    if (tab === 'killers') await snap(A, 'menus-killers');
  }
  await A.click('[data-a="menu"]');

  console.log('settings');
  await A.click('[data-a="settings"]');
  await A.evaluate(() => {
    const set = (k, v) => { const el = document.querySelector(`[data-s="${k}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('volume', 30); set('sens', 150); set('fov', 90); set('quality', 'medium');
    const c = document.querySelector('[data-s="invertY"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const prefs = await A.evaluate(() => JSON.parse(localStorage.getItem('pn2_prefs')));
  check(prefs.volume === 0.3 && prefs.sens === 1.5 && prefs.fov === 90 && prefs.quality === 'medium' && prefs.invertY === true, 'settings are applied and persisted');
  await A.click('[data-a="menu"]');

  console.log('profile rename');
  await A.click('[data-a="profile"]');
  await A.fill('#newname', 'Renamed9'); await A.click('[data-a="rename"]');
  await until(async () => (await scr(A)) === 'profile', 8000, 'profile after rename');
  check(await A.evaluate(() => window.__pn.app.profile.name === 'Renamed9'), 'rename is saved on the server profile');
  await A.click('[data-a="menu"]');

  console.log('custom room');
  await A.click('[data-a="play"]'); await A.click('[data-a="custom"]'); await A.click('[data-a="create"]');
  await until(async () => (await scr(A)) === 'lobby', 5000, 'lobby');
  const code = await A.evaluate(() => document.querySelector('.code').textContent.trim());
  check(/^[A-Z0-9]{4}$/.test(code), `room code shown (${code})`);
  await A.click('.chip[data-a="map"][data-m="hotel"]'); await A.waitForTimeout(800);
  check(await A.evaluate(() => document.querySelector('.chip.sel[data-a="map"]')?.dataset.m === 'hotel'), 'host can choose the map');
  check(await A.evaluate(() => document.querySelector('[data-a="start"]').disabled), 'start is disabled with 1 player (needs 5 humans)');
  const B = await newPage('B', { viewport: { width: 960, height: 540 } });
  await enter(B, 'Guest2');
  await B.click('[data-a="play"]'); await B.click('[data-a="custom"]'); await B.fill('#code', code.toLowerCase()); await B.click('[data-a="join"]');
  await until(async () => (await scr(B)) === 'lobby', 5000, 'B lobby');
  await until(() => A.evaluate(() => document.querySelectorAll('.slot:not(.empty)').length === 2), 5000, 'A sees 2');
  check(true, 'second human joins by room code; host sees 2 / 5');
  check(await B.evaluate(() => !document.querySelector('[data-a="start"]') && !document.querySelector('.chip[data-a="map"]')), 'non-host has neither start button nor map controls');
  await snap(A, 'menus-custom-lobby');
  await B.click('.chip[data-a="char"][data-c="5"]'); await B.waitForTimeout(800);
  check(await A.evaluate(() => /SORA/.test(document.querySelector('.slots').innerText)), 'character choice is shown to the host');
  await B.click('[data-a="leave"]'); await until(async () => (await scr(B)) === 'play', 4000, 'B left');
  await A.click('[data-a="leave"]'); await until(async () => (await scr(A)) === 'play', 4000, 'A left');
  check(true, 'leaving rooms works');

  console.log('phone (landscape): layout editor');
  const P = await newPage('P', { ...devices['Pixel 7'], deviceScaleFactor: 1, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } });
  await enter(P, 'Phone1');
  await P.tap('[data-a="settings"]');
  check(await P.evaluate(() => !!document.querySelector('[data-a="layout"]')), 'phone settings offer the button layout editor');
  await P.tap('[data-a="layout"]');
  await P.waitForSelector('#editbar');
  const before = await P.evaluate(() => { const r = document.getElementById('b-use').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const cdp = await P.context().newCDPSession(P);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x + 20, y: before.y + 20, id: 1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.x + 20 - i * 12, y: before.y + 20 - i * 8, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await P.waitForTimeout(300);
  const after = await P.evaluate(() => { const r = document.getElementById('b-use').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  check(Math.hypot(after.x - before.x, after.y - before.y) > 30, `button can be dragged to a new position (${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);
  await snap(P, 'menus-layout-edit');
  check(await P.evaluate(() => !!JSON.parse(localStorage.getItem('pn2_prefs')).pos?.use), 'new button position is saved');
  await P.tap('#editbar [data-e="reset"]'); await P.waitForTimeout(200);
  const reset = await P.evaluate(() => { const r = document.getElementById('b-use').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  check(Math.hypot(reset.x - before.x, reset.y - before.y) < 3, 'layout reset restores the default position');
  await P.tap('#editbar [data-e="done"]'); await until(async () => (await scr(P)) === 'settings', 3000, 'back to settings');
  check(true, 'layout editor returns to settings');

  console.log('phone (portrait): rotate hint');
  const Q = await newPage('Q', { ...devices['Pixel 7'], deviceScaleFactor: 1, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } });
  await enter(Q, 'Phone2');
  check(await Q.evaluate(() => !document.getElementById('orient').classList.contains('hidden')), 'portrait on a phone shows the "rotate to landscape" guidance');
  await snap(Q, 'menus-portrait-menu');
  await Q.tap('#orient-x'); await Q.waitForTimeout(200);
  check(await Q.evaluate(() => document.getElementById('orient').classList.contains('hidden')), 'the guidance can be dismissed');
  await Q.tap('[data-a="collection"]'); await Q.waitForTimeout(600); await snap(Q, 'menus-portrait-collection');
  check(await Q.evaluate(() => { const k = document.querySelector('.kinfo').getBoundingClientRect(); return k.left >= 0 && k.right <= innerWidth + 1 && k.bottom <= innerHeight + 1; }), 'portrait: info panel fits the screen');
} catch (e) {
  bad++; console.log('  FAIL exception: ' + (e?.stack ?? e));
}
check(errors.length === 0, 'no uncaught page errors / console errors' + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : ''));
await browser.close(); srv.kill('SIGTERM'); await sleep(300);
console.log(`\nbrowser menus test: ${ok} ok, ${bad} failed`);
process.exit(bad ? 1 : 0);
