// Browser end-to-end test: starts the BUILT server (dist/server.js) and drives 5 real Chromium pages (4 desktop + 1 emulated phone)
// through title -> quick match -> killer select -> match. Needs: npm run build, and Playwright with Chromium installed.
// NOTE: this is emulation only (headless Chromium + SwiftShader). It is NOT a substitute for testing on real iOS/Android devices.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

// ---------------- start server
const data = mkdtempSync(join(tmpdir(), 'pn2-browser-'));
const srv = spawn('node', ['dist/server.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, MAX_NEW_PROFILES_PER_HOUR: '1000', MAX_CONN_PER_IP: '50' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const port = await until(() => /listening on http:\/\/[^:]+:(\d+)/.exec(log)?.[1], 8000, 'server start');
const base = `http://127.0.0.1:${port}`;
console.log('server on', base);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const pages = [];
const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo5'];
for (let i = 0; i < 5; i++) {
  const mobile = i === 4;
  const ctx = await browser.newContext(mobile
    ? { ...devices['Pixel 7'], deviceScaleFactor: 1, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } } // DSF 1: software GL cannot render 2.6x pixel ratios for five pages
    : { viewport: { width: 960, height: 540 } });
  // five software-rendered WebGL pages share the CPU of the test machine, so use the "low" preset unless QUALITY=auto is set
  if (process.env.QUALITY !== 'auto') await ctx.addInitScript(() => { try { localStorage.setItem('pn2_prefs', JSON.stringify({ quality: 'low' })); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${names[i]}] PAGEERR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${names[i]}] ${m.text()}`); });
  pages.push({ p, name: names[i], mobile });
}
const snap = async (pg, label) => { if (SHOTS) await pg.p.screenshot({ path: join(SHOTS, `${label}-${pg.name}.png`) }); };
const scr = (pg) => pg.p.evaluate(() => document.querySelector('#screens .screen')?.dataset.scr ?? '');
const lumaStats = async (pg) => {
  const buf = await pg.p.screenshot();
  return pages[0].p.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 96; c.height = 54; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 96, 54);
    const d = x.getImageData(0, 0, 96, 54).data; let sum = 0, nb = 0, mn = 255, mx = 0;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; sum += l; if (l > 12) nb++; mn = Math.min(mn, l); mx = Math.max(mx, l); }
    return { mean: sum / (d.length / 4), nonBlack: nb / (d.length / 4), range: mx - mn };
  }, buf.toString('base64'));
};

try {
  console.log('A. title / menu / lobby');
  await Promise.all(pages.map((pg) => pg.p.goto(base + '/')));
  check((await scr(pages[0])) === 'title', 'title screen shown');
  await snap(pages[0], '01-title');
  check(await pages[0].p.evaluate(() => !!document.querySelector('a[href="/legal/privacy"]') && !!document.querySelector('a[href="/legal/terms"]')), 'terms/privacy links on title');
  for (const pg of pages) {
    await pg.p.fill('#name', pg.name);
    await pg.p.click('[data-a="enter"]');
    await until(async () => (await scr(pg)) === 'menu', 10000, pg.name + ' menu');
  }
  check(true, 'all 5 clients connected and reached the menu');
  await snap(pages[0], '02-menu');
  // menus
  await pages[0].p.click('[data-a="settings"]'); check((await scr(pages[0])) === 'settings', 'settings opens'); await snap(pages[0], '03-settings');
  await pages[0].p.click('[data-a="menu"]');
  await pages[0].p.click('[data-a="collection"]'); await pages[0].p.waitForTimeout(500); check((await scr(pages[0])) === 'collection', 'collection opens'); await snap(pages[0], '04-collection');
  await pages[0].p.click('[data-a="ctab"][data-t="survivors"]'); await pages[0].p.waitForTimeout(400); await snap(pages[0], '05-collection-survivors');
  await pages[0].p.click('[data-a="menu"]');
  await pages[0].p.click('[data-a="profile"]'); check((await scr(pages[0])) === 'profile', 'profile opens'); await pages[0].p.click('[data-a="menu"]');
  await pages[0].p.click('[data-a="credits"]'); check((await scr(pages[0])) === 'credits', 'credits opens'); await pages[0].p.click('[data-a="menu"]');

  // 4 players join: the match must NOT start and no bot may be added
  for (let i = 0; i < 4; i++) { await pages[i].p.click('[data-a="play"]'); await pages[i].p.click('[data-a="quick"]'); await until(async () => (await scr(pages[i])) === 'lobby', 6000, 'lobby ' + i); }
  await sleep(7500); // longer than the countdown: with 4 humans nothing may start
  const four = await pages[0].p.evaluate(() => document.querySelector('.screen')?.innerText ?? '');
  check(/4 \/ 5/.test(four), 'lobby shows 4 / 5 humans');
  check(!(await Promise.all(pages.slice(0, 4).map(async (pg) => ['pick', 'waitkiller', 'load', 'intro'].includes(await scr(pg))))).some(Boolean), 'with 4 humans nothing starts after 7.5 s (no AI filling slots)');
  await snap(pages[0], '06-lobby-4');
  const filled = await pages[0].p.evaluate(() => document.querySelectorAll('.slot:not(.empty)').length);
  check(filled === 4, 'exactly 4 occupied slots (empty slot stays empty)');

  console.log('B. 5th human joins -> countdown -> killer select');
  await pages[4].p.click('[data-a="play"]'); await pages[4].p.click('[data-a="quick"]');
  await until(async () => (await Promise.all(pages.map(scr))).some((s) => s === 'pick'), 20000, 'a pick screen');
  const scrs = await Promise.all(pages.map(scr));
  check(scrs.filter((s) => s === 'pick').length === 1 && scrs.filter((s) => s === 'waitkiller').length === 4, 'exactly one killer-select screen, four waiting');
  const kp = pages[scrs.indexOf('pick')];
  await pages[0].p.waitForTimeout(800); await snap(kp, '07-killer-select');
  await kp.p.click('[data-a="ksel"][data-i="2"]'); await kp.p.waitForTimeout(500); await snap(kp, '08-killer-select-mimic');
  await kp.p.click('[data-a="ksel"][data-i="3"]'); await kp.p.waitForTimeout(300);
  await kp.p.click('[data-a="kpick"]');

  console.log('C. match');
  await until(async () => (await Promise.all(pages.map((pg) => pg.p.evaluate(() => !!window.__pn?.app?.game?.snap)))).every(Boolean), 30000, 'all in game');
  check(true, 'all 5 clients are in the match and receive snapshots');
  const roles = await Promise.all(pages.map((pg) => pg.p.evaluate(() => window.__pn.app.game.role)));
  check(roles.filter((r) => r === 'K').length === 1 && roles.filter((r) => r === 'S').length === 4, 'roles: 1 killer + 4 survivors');
  const kid = await kp.p.evaluate(() => window.__pn.app.game.killerId);
  check(kid === 'chronos', 'killer type chosen in the showroom was applied (chronos)');
  await until(async () => (await Promise.all(pages.map((pg) => pg.p.evaluate(() => window.__pn.app.game.playing)))).every(Boolean), 15000, 'intro over');
  await pages[0].p.waitForTimeout(1200);
  for (const pg of pages) await snap(pg, '09-ingame');
  for (const pg of pages) {
    const s = await lumaStats(pg);
    check(s.nonBlack > 0.25 && s.range > 40, `${pg.name}: 3D view is rendered (non-black ${(s.nonBlack * 100) | 0}%, range ${s.range | 0})`);
  }
  check(await pages[0].p.evaluate(() => /^\d+:\d\d$/.test(document.getElementById('h-time').textContent)), 'HUD timer shown');
  check(await Promise.all(pages.map((pg) => pg.p.evaluate(() => window.__pn.app.game.snap.p.length <= 4))).then((a) => a.every(Boolean)), 'snapshots never contain more than 4 other players');

  // keyboard movement on a desktop survivor, compared with the server-authoritative position
  const sv = pages.find((pg) => !pg.mobile && roles[pages.indexOf(pg)] === 'S');
  const pos = () => sv.p.evaluate(() => { const g = window.__pn.app.game; return { x: g.px, z: g.pz, sx: g.snap.me.x, sz: g.snap.me.z, yaw: g.input.yaw }; });
  const p0 = await pos();
  await sv.p.keyboard.down('KeyW'); await sv.p.waitForTimeout(1500); await sv.p.keyboard.up('KeyW'); await sv.p.waitForTimeout(700);
  const p1 = await pos();
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const fpsSv = await sv.p.evaluate(() => Math.round(window.__pn.app.game.fpsEma));
  check(moved > 0.5 && moved < 9, `keyboard W moves the survivor (${moved.toFixed(2)} m in 1.5 s; headless render ${fpsSv} fps)`);
  check(Math.hypot(p1.x - p1.sx, p1.z - p1.sz) < 0.8, 'client prediction agrees with the server position');
  // transform attempt (F): never throws; server decides
  await sv.p.keyboard.press('KeyF'); await sv.p.waitForTimeout(400);
  // preset chat reaches the others
  await sv.p.keyboard.press('KeyG'); await sv.p.waitForTimeout(200);
  await sv.p.click('#chatpanel button >> nth=0');
  await sleep(1200);
  // chat is survivor-to-survivor only (the server sends it to role 'S'), so pick another SURVIVOR page
  const other = pages.find((pg, i) => pg !== sv && roles[i] === 'S');
  check(await other.p.evaluate(() => /ここにいる/.test(document.getElementById('hud-feed').innerText)), 'preset chat is delivered to other players');
  // pause menu
  await sv.p.keyboard.press('Escape'); await sv.p.waitForTimeout(300);
  check(await sv.p.evaluate(() => !document.getElementById('pause').classList.contains('hidden')), 'pause menu opens (game keeps running on the server)');
  await snap(sv, '10-pause');
  await sv.p.click('#p-resume');

  const heap = () => Promise.all(pages.map((pg) => pg.p.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6)).catch(() => -1)));
  console.log('  heap MB (after movement):', (await heap()).join(' '));
  // killer abilities on the killer's page (desktop or mobile)
  const kpg = kp;
  await kpg.p.keyboard.down('KeyW'); await kpg.p.waitForTimeout(800); await kpg.p.keyboard.up('KeyW');
  if (!kpg.mobile) {
    await kpg.p.evaluate(() => { const n = window.__pn.app.net; const o = n.send.bind(n); window.__sent = []; n.send = (m) => { if (m.t === 'act') window.__sent.push(m.a); o(m); }; });
    let cd = null;
    for (let tryN = 0; tryN < 3 && !(Array.isArray(cd) && cd[0] > 0); tryN++) {
      await kpg.p.keyboard.press('KeyQ');
      await until(() => kpg.p.evaluate(() => { const c = window.__pn.app.game.snap.me.cd; return Array.isArray(c) && c[0] > 0; }), 4000, 'cooldown').catch(() => {});
      cd = await kpg.p.evaluate(() => window.__pn.app.game.snap.me.cd);
    }
    const dbg = await kpg.p.evaluate(() => ({ sent: window.__sent, enabled: window.__pn.app.input.enabled, role: window.__pn.app.game.role, paused: window.__pn.app.game.paused, playing: window.__pn.app.game.playing }));
    console.log('  killer ability debug:', JSON.stringify(dbg), 'cd=', JSON.stringify(cd));
    check(Array.isArray(cd) && cd[0] > 0, 'killer ability 1 went on server-side cooldown after use');
    await snap(kpg, '11-killer-ability');
  }

  // phone: touch stick + buttons
  const ph = pages[4];
  const phRole = roles[4];
  check(await ph.p.evaluate(() => getComputedStyle(document.getElementById('touch')).display !== 'none'), 'phone: touch controls visible');
  check(await ph.p.evaluate(() => document.getElementById('orient').classList.contains('hidden')), 'phone landscape: no rotate hint');
  const cdp = await ph.p.context().newCDPSession(ph.p);
  const t0 = await ph.p.evaluate(() => ({ x: window.__pn.app.game.px, z: window.__pn.app.game.pz }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 260, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 260 - i * 10, id: 1 }] }); await sleep(60); }
  await ph.p.waitForTimeout(1200);
  const mid = await ph.p.evaluate(() => ({ mz: window.__pn.app.input.mz, x: window.__pn.app.game.px, z: window.__pn.app.game.pz }));
  // second finger (look zone) while the stick is held: multi-touch
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 200, id: 1 }, { x: 600, y: 200, id: 2 }] });
  const yaw0 = await ph.p.evaluate(() => window.__pn.app.input.yaw);
  for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 200, id: 1 }, { x: 600 + i * 20, y: 200, id: 2 }] }); await sleep(40); }
  const yaw1 = await ph.p.evaluate(() => window.__pn.app.input.yaw);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await ph.p.waitForTimeout(500);
  check(mid.mz > 0.3, `phone: virtual stick drives movement input (mz=${mid.mz.toFixed(2)})`);
  check(Math.hypot(mid.x - t0.x, mid.z - t0.z) > 0.8, 'phone: avatar moved with the stick');
  check(Math.abs(yaw1 - yaw0) > 0.05, 'phone: second finger rotates the camera while the stick is held (multi-touch)');
  await snap(ph, '12-phone');
  if (phRole === 'S') { await ph.p.tap('#b-menu'); const paused = await until(() => ph.p.evaluate(() => !document.getElementById('pause').classList.contains('hidden')), 5000, 'pause menu').catch(() => false); check(!!paused, 'phone: menu button opens pause (usable by touch)'); await ph.p.tap('#p-resume'); }

  console.log('  heap MB (before reconnect test):', (await heap()).join(' '));
  // forced socket drop: the client reconnects and resumes the same match (avatar not AI-driven meanwhile)
  const rc = pages.find((pg) => pg !== kp && pg !== ph && pg !== sv);
  await rc.p.evaluate(() => {
    const n = window.__pn.app.net, prev = n.onStatus, t0 = performance.now(); window.__stl = [];
    n.onStatus = (s, i) => { window.__stl.push(`${s}@${Math.round(performance.now() - t0)}`); prev.call(n, s, i); };
    // main-thread stall detector (a long gap between timer ticks means the page itself was starved, not the network)
    let last = performance.now(); window.__maxGap = 0; window.__gapT = setInterval(() => { const now = performance.now(); window.__maxGap = Math.max(window.__maxGap, now - last - 50); last = now; }, 50);
    n.ws.close();
  });
  const readState = () => rc.p.evaluate(() => ({ role: window.__pn.app.game?.role, age: window.__pn.app.game?.snap ? 1 : 0, st: window.__pn.app.net.status, running: window.__pn.app.game?.running }));
  let resumed = await readState();
  const tRc = Date.now();
  // first the drop must be noticed (status leaves 'open'; the retry back-off is >= 400 ms so polling at 50 ms sees it), then it must come back
  while (resumed.st === 'open' && Date.now() - tRc < 3000) { await sleep(50); resumed = await readState().catch(() => resumed); }
  console.log('  drop noticed:', resumed.st, `after ${Date.now() - tRc} ms`);
  while (!(resumed.st === 'open' && resumed.role === 'S' && resumed.age === 1) && Date.now() - tRc < 15000) { await sleep(300); resumed = await readState().catch(() => resumed); }
  console.log('  reconnect state:', JSON.stringify(resumed), `after ${Date.now() - tRc} ms`);
  console.log('  reconnect timeline (page clock):', JSON.stringify(await rc.p.evaluate(() => ({ status: window.__stl, maxMainThreadStallMs: Math.round(window.__maxGap) }))));
  check(resumed.st === 'open' && resumed.role === 'S' && resumed.age === 1, 'forced disconnect: client reconnected and resumed the match');
  await snap(rc, '13-reconnected');

  // leave flow
  await sv.p.keyboard.press('Escape'); await sv.p.waitForTimeout(200);
  await sv.p.click('#p-leave'); await sv.p.click('#m-ok');
  await until(async () => (await scr(sv)) === 'menu', 5000, 'menu after leaving');
  check(true, 'leaving a match returns to the menu');
  const hz = await (await fetch(base + '/healthz')).json();
  check(hz.ok === true && hz.matches >= 1, `server healthz ok (${JSON.stringify(hz)})`);
} catch (e) {
  bad++; console.log('  FAIL exception: ' + (e?.stack ?? e));
  if (SHOTS) for (const pg of pages) await pg.p.screenshot({ path: join(SHOTS, `zz-fail-${pg.name}.png`) }).catch(() => {});
}

check(errors.length === 0, 'no uncaught page errors / console errors' + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : ''));
await browser.close();
srv.kill('SIGTERM');
await sleep(300);
console.log(`\nbrowser test: ${ok} ok, ${bad} failed`);
if (bad && process.env.VERBOSE) console.log(log.split('\n').slice(-20).join('\n'));
writeFileSync(join(data, 'done'), '1');
process.exit(bad ? 1 : 0);
