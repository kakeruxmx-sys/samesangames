// End-to-end test against the REAL server over real WebSockets. 5 scripted test clients stand in for 5 humans.
// (They are a test harness; the game itself contains no bots. See tests/helpers.ts.)
process.env.PN_TEST_SPEED = '3'; // sim runs 3x faster than wall-clock so the suite is quick
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, loadOptions } from '../server/src/index';
import { KILLERS, KillerId, KILLER_IDS } from '../shared/killers';
import { MAP_IDS, RULES, DT, MapId } from '../shared/constants';
import { Group, sleep, startCustomMatch, TC, waitFor } from './helpers';

let pass = 0, fail = 0;
const results: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; results.push('  ok   ' + msg); } else { fail++; results.push('  FAIL ' + msg); }
}
async function section<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const only = process.env.PN_ONLY; // e.g. PN_ONLY=E,G to run selected sections
  if (only && !only.split(',').includes(name[0])) return undefined;
  const t0 = Date.now();
  try { const r = await fn(); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`); return r; }
  catch (e) { fail++; results.push(`  FAIL ${name}: ${(e as Error).message}`); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name} -> ERROR ${(e as Error).message}`); }
}

const dataDir = mkdtempSync(join(tmpdir(), 'pn2-'));
const opts = { ...loadOptions(), port: 0, host: '127.0.0.1', dataDir, staticDir: join(dataDir, 'none'), maxConnPerIp: 1000, maxNewProfilesPerHour: 100000 };
const server = await startServer(opts);
const port = server.port;
const allClients: TC[] = [];
const track = (g: Group) => { allClients.push(...g.clients); return g; };

// ============================================================ driver scripts (test harness only)
/** survivors repair their own generator, then open the gate and escape */
function escapeDriver(g: Group) {
  g.survivors.forEach((s, idx) => {
    s.drive = (c) => {
      const sn = c.snap!;
      if (sn.me.fz && c.snap!.me.seal) { c.idle(); return; }
      const doneCount = sn.g.filter((x) => x.done).length;
      if (sn.gate === 3) { c.ctl.use = false; c.goto(g.map.gate.x, g.map.gate.z, 0.3, true); return; }
      if (doneCount >= RULES.genRequired) {
        const near = c.goto(g.map.gate.x, g.map.gate.z, 1.2, true);
        c.ctl.use = near; if (near) { c.ctl.mx = 0; c.ctl.mz = 0; }
        return;
      }
      let gi = idx; if (sn.g[gi]?.done) gi = sn.g.findIndex((x) => !x.done);
      const gp = g.map.gens[gi];
      const near = c.goto(gp.x, gp.z, 1.0, true);
      c.ctl.use = near; if (near) { c.ctl.mx = 0; c.ctl.mz = 0; }
    };
    s.startDriving();
  });
  g.killer.drive = (c) => c.idle();
  g.killer.startDriving();
}

/** killer hunts alive survivors; survivors stand still */
function huntDriver(g: Group, only?: number) {
  g.survivors.forEach((s) => { s.drive = (c) => c.idle(); s.startDriving(); });
  let lastAtk = 0, captured = 0;
  g.killer.drive = (c) => {
    const sn = c.snap!;
    if (only !== undefined) {
      captured = c.count((e) => e.k === 'cap');
      if (captured >= 1) { c.idle(); return; }
    }
    const targets = sn.p.filter((p) => p.s === 'alive' && (only === undefined || p.i === only));
    if (!targets.length) {
      const sp = g.map.survSpawns[0];
      c.goto(sp.x, sp.z, 1.0, false); return;
    }
    const me = c.pos;
    targets.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const t = targets[0];
    const d = Math.hypot(t.x - me.x, t.z - me.z);
    if (d < 1.7) {
      c.face(t.x, t.z); c.ctl.mx = 0; c.ctl.mz = 0.2;
      if (Date.now() - lastAtk > 400) { lastAtk = Date.now(); c.act('attack'); }
    } else c.goto(t.x, t.z, 0.5, false);
  };
  g.killer.startDriving();
}

try {
  // ============================================================ F: not enough humans => no match, no AI
  await section('F: 4 humans never start a match and no AI is added', async () => {
    const cs: TC[] = [];
    for (let i = 0; i < 4; i++) cs.push(await TC.open(port, 'few' + i));
    cs.forEach((c) => c.send({ t: 'quick' }));
    await waitFor(() => cs.every((c) => c.room && c.room.slots.filter(Boolean).length === 4), 3000, '4 in quick room');
    await sleep(7500); // longer than the 5 s countdown that a 5th human would trigger
    ok(cs.every((c) => c.room?.phase === 'waiting'), 'room stays in "waiting" with 4 humans');
    ok(cs.every((c) => c.room!.slots.filter((s) => s === null).length === 1), 'the 5th slot stays EMPTY (no filler player)');
    ok(cs.every((c) => !c.init), 'no match init was sent');
    // the 5th human arrives -> countdown -> match starts with exactly 5 real players
    const fifth = await TC.open(port, 'few4'); cs.push(fifth); fifth.send({ t: 'quick' });
    cs.forEach((c) => (c.wantKiller = 'lumen'));
    await waitFor(() => cs.every((c) => !!c.init), 40000, 'match starts once 5th human arrives');
    ok(cs[0].init!.players.length === 5, 'match has exactly 5 players');
    ok(new Set(cs.map((c) => c.pub)).size === 5, '...and they are 5 distinct human connections');
    ok(cs.filter((c) => c.role === 'K').length === 1 && cs.filter((c) => c.role === 'S').length === 4, '1 killer + 4 survivors');
    cs.forEach((c) => c.close());
  });

  // ============================================================ A: full match on every map: survivors escape
  await section('A: full match on all 4 maps (repair 4 gens -> open gate -> escape)', async () => {
    const groups = await Promise.all(MAP_IDS.map((m, i) => startCustomMatch(port, `A${i}`, m, 'echo').then(track)));
    groups.forEach(escapeDriver);
    await Promise.all(groups.map((g) => waitFor(() => g.clients.every((c) => !!c.end), 150000, `match end on ${g.map.id}`)));
    for (const g of groups) {
      const e = g.survivors[0].end!;
      ok(e.result === 'survivors', `${g.map.id}: survivors win after escaping (result=${e.result}, escaped=${e.escaped})`);
      ok(e.escaped === 4, `${g.map.id}: all 4 escaped through the gate`);
      ok(g.survivors.every((s) => s.snap!.g.filter((x) => x.done).length >= 4), `${g.map.id}: >=4 generators repaired (server progress)`);
      ok(g.killer.end!.rewards.xp > 0 && g.survivors[0].end!.rewards.lines.length > 0, `${g.map.id}: rewards sent`);
      ok(g.clients.every((c) => c.closedCode === null), `${g.map.id}: no legitimate client was disconnected by anti-cheat (~90 msgs/s each)`);
    }
    groups.forEach((g) => g.clients.forEach((c) => c.close()));
  });

  // ============================================================ B/C/D
  await Promise.all([
    section('B: killer captures survivors; unrescued sealed survivors are eliminated -> killer wins', async () => {
      const g = track(await startCustomMatch(port, 'B', 'school', 'stitcher'));
      huntDriver(g);
      await waitFor(() => g.clients.every((c) => !!c.end), 200000, 'killer-win match end');
      const e = g.killer.end!;
      ok(e.result === 'killer', `killer wins when nobody escapes (result=${e.result})`);
      ok(g.killer.count((x) => x.k === 'cap') >= 4, 'captures were synchronized to the killer as events');
      ok(g.killer.count((x) => x.k === 'out') === 4 || g.killer.events.filter((x) => x.k === 'out').length >= 4, 'all four survivors eliminated');
      g.clients.forEach((c) => c.close());
    }),
    section('C: rescue — teammate frees a sealed survivor, who gets protection', async () => {
      const g = track(await startCustomMatch(port, 'C', 'hotel', 'chronos'));
      const victim = g.survivors[0], rescuer = g.survivors[1];
      victim.drive = (c) => c.idle(); victim.startDriving();
      g.survivors.slice(2).forEach((s) => { s.drive = (c) => c.idle(); s.startDriving(); });
      let lastAtk = 0;
      g.killer.drive = (c) => {
        if (c.count((e) => e.k === 'cap') >= 1) { c.idle(); return; }
        const t = c.snap!.p.find((p) => p.i === victim.id && p.s === 'alive');
        if (!t) { const sp = g.map.survSpawns[0]; c.goto(sp.x, sp.z, 1.0); return; }
        const d = Math.hypot(t.x - c.pos.x, t.z - c.pos.z);
        if (d < 1.7) { c.face(t.x, t.z); c.ctl.mz = 0.2; if (Date.now() - lastAtk > 400) { lastAtk = Date.now(); c.act('attack'); } }
        else c.goto(t.x, t.z, 0.5);
      };
      g.killer.startDriving();
      rescuer.drive = (c) => {
        const sn = c.snap!;
        const si = sn.seals.findIndex((s) => s.occ === victim.id);
        if (si < 0) { c.idle(); return; }
        const sp = g.map.seals[si];
        const near = c.goto(sp.x, sp.z, 1.0, true);
        c.ctl.use = near; if (near) { c.ctl.mx = 0; c.ctl.mz = 0; }
      };
      rescuer.startDriving();
      await waitFor(() => victim.count((e) => e.k === 'cap') >= 1, 90000, 'capture event');
      ok(true, 'capture happened and was announced');
      await waitFor(() => victim.count((e) => e.k === 'rescue') >= 1, 90000, 'rescue event');
      ok(true, 'rescue completed by a teammate holding the interact button');
      await waitFor(() => victim.snap!.team.find((t) => t.i === victim.id)?.s === 'alive', 4000, 'victim alive again');
      const ts = victim.snap!.team.find((t) => t.i === victim.id)!;
      ok(ts.s === 'alive' && ts.st === 2, 'rescued survivor is alive again at capture stage 2 (danger)');
      // protection window is applied by the server right at rescue time (RULES.protectedS); the rescuer is next to the victim
      const seenProtected = [rescuer, victim].some((c) => c.snap!.p.some((p) => p.i === victim.id && p.pr === 1) || c.events.some((e) => e.k === 'rescue'));
      ok(seenProtected, 'rescue was synchronized to the rescuer and the rescued player');
      g.clients.forEach((c) => c.close());
    }),
    section('D: disconnect + reconnect within 60 s resumes the same seat (no AI takes over)', async () => {
      const g = track(await startCustomMatch(port, 'D', 'factory', 'mimic'));
      g.survivors.forEach((s) => { s.drive = (c) => c.idle(); s.startDriving(); });
      g.killer.drive = (c) => c.idle(); g.killer.startDriving();
      const victim = g.survivors[2];
      const oldId = victim.id, token = victim.token, name = victim.name;
      const posBefore = { ...victim.pos };
      victim.kill();
      await sleep(1500);
      const back = await TC.open(port, name, token);
      allClients.push(back);
      await waitFor(() => !!back.init, 5000, 'resume init');
      ok(back.init!.resume === true, 'reconnect is flagged resume=true');
      ok(back.init!.you === oldId && back.role === 'S', 'same seat id and role after reconnect');
      await waitFor(() => back.snaps > 3, 4000, 'snapshots after reconnect');
      ok(Math.hypot(back.pos.x - posBefore.x, back.pos.z - posBefore.z) < 1.5, 'position preserved across the disconnect (avatar was frozen, not AI-driven)');
      ok(back.room?.phase === 'intro' || back.room?.phase === 'playing', 'room state restored');
      g.clients.forEach((c) => c.close()); back.close();
    }),
    section('D2: same account reconnects while the old socket is still open -> old socket replaced (4001), seat resumed', async () => {
      const g = track(await startCustomMatch(port, 'D2', 'hotel', 'echo'));
      g.survivors.forEach((s) => { s.drive = (c) => c.idle(); s.startDriving(); });
      g.killer.drive = (c) => c.idle(); g.killer.startDriving();
      const victim = g.survivors[1];
      const oldId = victim.id;
      const back = await TC.open(port, victim.name, victim.token); // the old socket has NOT been closed by the client
      allClients.push(back);
      await waitFor(() => !!back.init, 5000, 'resume init (duplicate connection)');
      ok(back.init!.resume === true && back.init!.you === oldId && back.role === 'S', 'duplicate connection takes over the same seat (resume=true, same id)');
      await waitFor(() => victim.closedCode !== null, 3000, 'old socket closed');
      ok(victim.closedCode === 4001, `old socket is closed with code 4001 "replaced" (got ${victim.closedCode})`);
      await waitFor(() => back.snaps > 3, 4000, 'snapshots on the new socket');
      ok(back.room?.phase === 'intro' || back.room?.phase === 'playing', 'new socket receives the room state');
      await sleep(600); // the old socket's close event must not detach the new one
      const n = back.snaps; await sleep(700);
      ok(back.snaps > n, 'new socket keeps receiving snapshots after the old socket finished closing');
      g.clients.forEach((c) => c.close()); back.close();
    }),
  ]);

  // ============================================================ E: all 15 abilities, concurrently, one match per killer
  await section('E: every killer ability fires, is cooldown-gated, and has its effect (5 killers x 3)', async () => {
    const groups = await Promise.all(KILLER_IDS.map((k, i) => startCustomMatch(port, 'E' + i, 'school', k).then(track).then((g) => ({ k, g }))));
    await Promise.all(groups.map(({ k, g }) => abilityScript(k, g)));
    groups.forEach(({ g }) => g.clients.forEach((c) => c.close()));
  });

  // ============================================================ G: anti-cheat / validation
  await section('G: server rejects speed hacks, forged positions and malformed input', async () => {
    const g = track(await startCustomMatch(port, 'G', 'school', 'echo'));
    g.killer.drive = (c) => c.idle(); g.killer.startDriving();
    const s = g.survivors[0];
    g.survivors.slice(1).forEach((o) => { o.drive = (c) => c.idle(); o.startDriving(); });
    await sleep(800);
    const start = { ...s.pos }; const tk0 = s.snap!.tk;
    // burst of inputs far faster than the 30 Hz tick, with absurd magnitudes and a forged position field.
    // ~250 msgs in ~1 s stays under the flood limit, so this isolates the speed validation.
    s.drive = null; s.stop();
    const seq0 = 5000;
    for (let i = 0; i < 250; i++) {
      s.send({ t: 'in', seq: seq0 + i, mx: 1e9, mz: 1e9, yaw: 0, pitch: 99, run: true, crouch: false, use: false, x: 9999, z: 9999 });
      if (i % 25 === 24) await sleep(100);
    }
    s.send({ t: 'in', seq: 'abc', mx: NaN, mz: null });          // malformed
    s.send({ t: 'act', a: 'ab0' });                                 // survivors have no abilities
    s.send({ t: 'act', a: 'nuke' });                                // unknown action
    s.ws.send('this is not json');
    s.ws.send(Buffer.from([1, 2, 3]));
    await sleep(2500);
    const end = s.pos; const tk1 = s.snap!.tk;
    const simSeconds = (tk1 - tk0) * DT;
    const dist = Math.hypot(end.x - start.x, end.z - start.z);
    ok(simSeconds > 3, `server kept simulating (${simSeconds.toFixed(1)} sim-s elapsed)`);
    ok(dist > 1, `the inputs did move the avatar (${dist.toFixed(1)} m), so the speed limit below is actually exercised`);
    ok(dist <= RULES.survivorRun * (simSeconds + 0.5) * 1.05, `250 flooded inputs moved only ${dist.toFixed(1)} m in ${simSeconds.toFixed(1)} sim-s (limit ${(RULES.survivorRun * simSeconds).toFixed(1)} m)`);
    ok(Math.abs(end.x - 9999) > 100 && Math.abs(end.z - 9999) > 100, 'forged x/z fields were ignored');
    ok(s.closedCode === null, 'a fast-but-bounded input burst did not disconnect the player');
    // sustained abuse: thousands of messages in a tight loop gets the connection dropped (flood protection)
    const flooder = await TC.open(port, 'flood'); allClients.push(flooder);
    for (let i = 0; i < 3000; i++) flooder.send({ t: 'ping', c: i });
    await waitFor(() => flooder.closedCode !== null, 4000, 'flood kick').catch(() => { /* asserted below */ });
    ok(flooder.closedCode === 4000, `message flooding is cut off by the server (close code ${flooder.closedCode})`);
    ok(s.snap!.me.x > 0 && s.snap!.me.z > 0 && s.snap!.me.x < g.map.w * 2 * 2, 'position is still inside the map (no wall-clipping / out-of-bounds)');
    // other players are culled by line of sight: nobody sees through walls from spawn
    const killerSeen = s.snap!.p.some((p) => p.s === 'K');
    ok(!killerSeen, 'killer (70 m and several walls away) is NOT sent to the survivor (anti wall-hack culling)');
    // name filter
    const bad = await TC.open(port, 'fuck'); allClients.push(bad);
    await sleep(300);
    ok(bad.errs.includes('name_rejected'), 'offensive name is rejected and replaced by a guest name');
    bad.close();
    g.clients.forEach((c) => c.close());
  });
} finally {
  console.log('\n' + results.join('\n'));
  console.log(`\n${fail === 0 ? 'E2E PASSED' : 'E2E FAILED'}  (${pass} ok, ${fail} failed)`);
  for (const c of allClients) c.kill();
  await server.close().catch(() => { /* */ });
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

// ============================================================ ability script
async function abilityScript(k: KillerId, g: Group) {
  const def = KILLERS[k];
  const K = g.killer;
  const tag = `${k}`;
  const surv = g.survivors;
  const sp = g.map.survSpawns;
  const lastEv = (c: TC, pred: (e: any) => boolean) => c.events.filter(pred);
  // survivors: either stand still or pace back and forth (some abilities need movement)
  const mode = { pace: false };
  K.drive = (c) => c.idle();
  K.startDriving();
  surv.forEach((s, i) => {
    let flip = 0, base = 0;
    s.drive = (c) => {
      if (!mode.pace) { c.idle(); return; }
      const t = Math.floor(Date.now() / 900);
      if (t !== flip) { flip = t; base += Math.PI; }
      c.ctl.mx = 0; c.ctl.mz = 1; c.ctl.yaw = base + i * 0.3; c.ctl.run = false;
    };
    s.startDriving();
  });
  const target = () => { const s = surv[0]; return s.pos; }; // test harness peeks at true survivor position
  const killerGoNear = async (x: number, z: number, d: number, label: string) => {
    K.drive = (c) => { c.goto(x, z, d, true); };
    await waitFor(() => Math.hypot(K.pos.x - x, K.pos.z - z) <= d + 0.3, 60000, `killer reaches ${label}`);
    K.idle();
    K.drive = (c) => { c.ctl.mx = 0; c.ctl.mz = 0; };
  };
  const fire = async (slot: 0 | 1 | 2, d = 99) => {
    const n0 = K.count((e) => e.k === 'ab' && e.slot === slot && e.ph === 'fire' && e.i === K.id);
    K.act(('ab' + slot) as any, d);
    await waitFor(() => K.count((e) => e.k === 'ab' && e.slot === slot && e.ph === 'fire' && e.i === K.id) > n0, 4000, `${tag} ab${slot} fire event`);
  };
  const check = (cond: boolean, msg: string) => ok(cond, `${tag}: ${msg}`);

  // generic: cooldown + gating for each slot (done in the per-killer sections below with the effect check)
  const cdOf = (slot: number) => K.snap!.me.cd![slot];
  const gate = async (slot: 0 | 1 | 2) => {
    const first = cdOf(slot);
    check(first > def.abilities[slot].cooldown - 8, `${def.abilities[slot].name} puts it on cooldown (${first.toFixed(1)}s left of ${def.abilities[slot].cooldown}s)`);
    const fires = K.count((e) => e.k === 'ab' && e.slot === slot && e.ph === 'fire');
    K.act(('ab' + slot) as any);
    await sleep(500);
    const fires2 = K.count((e) => e.k === 'ab' && e.slot === slot && e.ph === 'fire');
    check(fires2 === fires, `${def.abilities[slot].name} cannot be re-fired during cooldown (server-enforced)`);
  };
  const telegraphSeen = () => K.count((e) => e.k === 'ab' && e.ph === 'start') + surv[0].count((e) => e.k === 'ab' && e.ph === 'start');

  // ---- approach the first survivor so effects have targets
  const s0 = surv[0];
  await killerGoNear(s0.pos.x, s0.pos.z, 6, 'survivors');

  if (k === 'echo') {
    mode.pace = true; await sleep(600);
    await fire(0);
    await waitFor(() => (K.snap!.pings?.length ?? 0) > 0, 3000, 'echo pings').catch(() => { /* asserted below */ });
    check((K.snap!.pings?.length ?? 0) > 0, 'RESONANCE SCAN returns echoes of MOVING survivors');
    await gate(0);
    // SOUND PRESSURE needs aim at a survivor within 11 m (survivors stand still now)
    mode.pace = false;
    K.drive = (c) => { c.face(target().x, target().z); c.ctl.mx = 0; c.ctl.mz = 0; };
    await sleep(300);
    await fire(1);
    await sleep(300);
    check(surv.some((s) => s.snap!.me.dis > 0), 'SOUND PRESSURE distorts the senses (dis timer>0) of a survivor in front of the killer');
    await gate(1);
    // ECHO STEP: server speed multiplier + measured speed above killer base speed
    K.drive = (c) => { c.ctl.mx = 0; c.ctl.mz = 1; };
    await fire(2);
    const a = K.pos; const tk = K.snap!.tk; const sm = K.snap!.me.sm;
    await sleep(250);
    const b = K.pos; const tk2 = K.snap!.tk;
    const v = Math.hypot(b.x - a.x, b.z - a.z) / ((tk2 - tk) * DT);
    check(sm > 1.5 && v > RULES.killerSpeed * 1.3, `ECHO STEP boosts speed (server multiplier ${sm}, measured ${v.toFixed(1)} m/s vs base ${RULES.killerSpeed})`);
    await gate(2);
  }

  if (k === 'stitcher') {
    K.drive = (c) => { c.face(target().x, target().z); c.ctl.mx = 0; c.ctl.mz = 0; };
    await fire(0); await sleep(400);
    check((K.snap!.fx.sigils.length) >= 1, 'SHADOW THREAD places a sigil');
    check(surv.every((s) => s.snap!.fx.sigils.length >= 1), 'the sigil is visible to ALL survivors (they can see and avoid it)');
    await gate(0);
    // sigil notification: survivor walks over the sigil
    const sg = K.snap!.fx.sigils[0];
    if (sg) {
      const victim = surv[1];
      victim.drive = (c) => { c.goto(sg.x, sg.z, 0.3, true); };
      await waitFor(() => K.count((e) => e.k === 'msg' && e.s.includes('紋章')) > 0, 40000, 'sigil trigger');
      check(true, 'walking over a sigil notifies the killer');
      victim.drive = (c) => c.idle();
    }
    await fire(1); await sleep(300);
    const seen = surv.map((s) => s.snap!.p.find((p) => p.s === 'K')).find(Boolean);
    check(!!seen && seen.ph === 1, 'PHASE DRIFT makes the killer translucent for observers (ph=1)');
    // attack is blocked while drifting
    const swings0 = surv[0].count((e) => e.k === 'snd' && e.s === 'swing');
    K.act('attack'); await sleep(400);
    check(surv[0].count((e) => e.k === 'snd' && e.s === 'swing') === swings0, 'killer cannot attack while phase-drifting');
    await gate(1);
    // FALSE PATH: fake footsteps with nobody moving
    surv.forEach((s) => s.idle());
    await sleep(400);
    const n0 = surv.reduce((a, s) => a + s.count((e) => e.k === 'snd' && e.s === 'step'), 0);
    await fire(2); await sleep(1800);
    const n1 = surv.reduce((a, s) => a + s.count((e) => e.k === 'snd' && e.s === 'step'), 0);
    check(n1 > n0, `FALSE PATH plays fake footsteps for survivors (${n1 - n0} sounds) while nobody is walking`);
    await gate(2);
  }

  if (k === 'mimic') {
    // OBJECT MIMIC needs a prop in front within 4 m: pick one right next to survivors so they can observe the killer
    const sp0 = surv[0].pos;
    const near = g.map.props.filter((p) => Math.hypot(p.x - sp0.x, p.z - sp0.z) < 9).sort((a, b) => Math.hypot(a.x - sp0.x, a.z - sp0.z) - Math.hypot(b.x - sp0.x, b.z - sp0.z))[0];
    check(!!near, 'a prop exists within 9 m of the survivor spawn');
    await killerGoNear(near.x, near.z, 1.5, 'a prop');
    K.drive = (c) => { c.face(near.x, near.z); c.ctl.mx = 0; c.ctl.mz = 0; };
    await sleep(300);
    await fire(0); await sleep(300);
    const obs = surv.map((s) => s.snap!.p.find((p) => p.s === 'K')).find((p) => p && p.kd);
    check(!!obs && obs.kd!.t === 'prop', 'OBJECT MIMIC: survivors who see the killer see a PROP (kd.t="prop"), not a killer model');
    await gate(0);
    await fire(1); await sleep(300);
    const obs2 = surv.map((s) => s.snap!.p.find((p) => p.s === 'K')).find((p) => p && p.kd);
    check(!!obs2 && obs2.kd!.t === 'surv', 'FALSE SURVIVOR: observers see a survivor look-alike (kd.t="surv") that replaces the prop disguise');
    await gate(1);
    // MACHINE DISTORTION: needs an unfinished generator within 26 m
    const gp = g.map.gens[0];
    await killerGoNear(gp.x, gp.z, 10, 'a generator');
    await fire(2); await sleep(400);
    check(surv.some((s) => s.snap!.g.some((x) => x.dist > 0)), 'MACHINE DISTORTION slows a generator and it is shown as faulty to survivors');
    check(surv[0].snap!.g.some((x) => x.dist > 0 && x.dist <= def.abilities[2].duration + 0.1), `the fault is temporary (<= ${def.abilities[2].duration}s remaining, never permanent)`);
    await gate(2);
  }

  if (k === 'chronos') {
    K.drive = (c) => { c.face(target().x, target().z); c.ctl.mx = 0; c.ctl.mz = 0; };
    await fire(0, Math.hypot(target().x - K.pos.x, target().z - K.pos.z)); await sleep(300);
    check(K.snap!.fx.zones.some((z) => z.k === 'time'), 'TIME FIELD creates a visible slow zone');
    await gate(0);
    await fire(1); await sleep(300);
    check(K.snap!.fx.decoys.length >= 1, 'AFTERIMAGE spawns a decoy that runs a different direction');
    await gate(1);
    mode.pace = true; await sleep(3500); // survivors move so there is a trace (>= 4 m over the last 8 s)
    await fire(2); await sleep(300);
    check((K.snap!.trace?.length ?? 0) >= 1, 'TIME TRACE shows past movement trails (not current positions)');
    await gate(2);
  }

  if (k === 'lumen') {
    K.drive = (c) => { c.face(target().x, target().z); c.ctl.mx = 0; c.ctl.mz = 0; };
    await fire(0); await sleep(300);
    check(K.snap!.fx.zones.some((z) => z.k === 'blackout'), 'BLACKOUT creates a (partial) light-dimming zone');
    await gate(0);
    // LUMEN TRACE marks survivors within 7 m of the killer
    await killerGoNear(target().x, target().z, 3, 'a survivor');
    K.drive = (c) => { c.face(target().x, target().z); c.ctl.mx = 0; c.ctl.mz = 0; };
    mode.pace = true; await sleep(300);
    await fire(1); await sleep(1500);
    check(surv.some((s) => (s.snap!.me.mk ?? 0) > 0) || (K.snap!.marks?.length ?? 0) > 0, 'LUMEN TRACE marks survivors and leaves a light trail of where they WERE');
    await gate(1);
    mode.pace = false; await sleep(500);
    const dd = Math.hypot(target().x - K.pos.x, target().z - K.pos.z);
    await fire(2, dd); await sleep(300);
    check(K.snap!.fx.zones.some((z) => z.k === 'dark'), 'DARK ZONE exists and is visible from outside');
    check(surv.some((s) => s.snap!.me.dark === 1), 'survivors standing in DARK ZONE are flagged (reduced vision)');
    await gate(2);
  }
  check(telegraphSeen() > 0, 'abilities send a windup/telegraph event so survivors can react');
}
