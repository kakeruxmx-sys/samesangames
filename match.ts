// Authoritative match simulation. 5 humans, no AI: every avatar is driven only by a connected (or briefly
// disconnected, frozen) human. The server owns positions, speeds, collisions, abilities, cooldowns, repair,
// capture, rescue, escape and the winner. Clients send intent; they never send positions.
import { CELL, DT, LOBBY, MATCH_SECONDS, PLAYERS_PER_MATCH, RECONNECT_GRACE_S, RULES, SNAP_EVERY, XP, CHAT_PRESETS, SurvState } from '../../shared/constants';
import type { MapId } from '../../shared/constants';
import { KILLERS, KillerId } from '../../shared/killers';
import { buildMap, GameMap, losClear, moveCircle } from '../../shared/maps';
import { PROPS } from '../../shared/props';
import { baseSpeed, bodyRadius, fwd, InputCmd, stepMove } from '../../shared/sim';
import type { GameEvent, GenState, InitMsg, SnapMsg, SnapPlayer, ServerMsg } from '../../shared/protocol';
import type { Conn } from './conn';
import { normYaw } from './validation';

interface Stats { gens: number; rescues: number; caps: number; elims: number }

export interface MatchSeat {
  id: number;
  conn: Conn;
  role: 'S' | 'K';
  name: string;
  char: number;
  pub: string;
}

export interface MatchEnd {
  result: 'survivors' | 'killer' | 'aborted';
  escaped: number;
  killer: KillerId;
  seats: { id: number; role: 'S' | 'K'; conn: Conn | null; name: string; pub: string; state: string; stats: Stats; gone: boolean }[];
}

class P {
  conn: Conn | null;
  discAt: number | null = null;
  gone = false;
  x = 0; z = 0; yaw = 0; pitch = 0;
  q: InputCmd[] = [];
  budget = 3;
  ack = 0; lastSeq = -1;
  use = false; run = false; crouch = false;
  moving = false; lastMoveT = -99;
  state: SurvState = 'alive';
  caps = 0; stamina = RULES.staminaMax; exhausted = false;
  disg = -1; disgSc = 1; anim = 0; animStart = 0; animUntil = 0; tfCdUntil = 0;
  protUntil = 0; sealIdx = -1; sealUntil = 0;
  inter: { kind: 'gen' | 'rescue' | 'gate'; idx: number } | null = null;
  distortUntil = 0; inTime = false; inDark = false; markedUntil = 0; lastMarkAt = 0;
  stats: Stats = { gens: 0, rescues: 0, caps: 0, elims: 0 };
  footAcc = 0;
  hist: { t: number; x: number; z: number }[] = [];
  // killer
  cdUntil = [0, 0, 0];
  cast: { slot: number; fireAt: number; d: number } | null = null;
  atk: { fireAt: number; start: number } | null = null;
  recoverUntil = 0; recoverStart = 0;
  echoUntil = 0; phaseUntil = 0;
  mimic: { type: number; sc: number; until: number } | null = null;
  fsUntil = 0; fsChar = 0;
  lumenUntil = 0;
  falseUntil = 0; falseAcc = 0; falsePos = { x: 0, z: 0 };
  constructor(public id: number, public role: 'S' | 'K', public name: string, public char: number, public pub: string, conn: Conn | null) { this.conn = conn; }
}

type Target = 'K' | 'S' | number | undefined;
interface QEvent { ev: GameEvent; to: Target; at?: { x: number; z: number; rad: number } }

export class Match {
  map: GameMap;
  players: P[] = [];
  t = 0;
  tk = 0;
  introLeft = LOBBY.introS;
  ended = false;
  private timer: NodeJS.Timeout | null = null;
  private lastReal = Date.now();
  private acc = 0;
  // TEST ONLY: PN_TEST_SPEED=3 makes the simulation run 3x faster so automated tests finish quickly.
  // Unset in production (=1). Game rules are unaffected: the same fixed DT steps are simply executed more often.
  private speed = Math.max(1, Math.min(6, Number(process.env.PN_TEST_SPEED) || 1));
  // TEST ONLY: PN_TEST_MATCH_SECONDS shortens the match (e.g. 25) so the results flow can be exercised quickly. Never set in production.
  private matchSeconds = Math.max(10, Number(process.env.PN_TEST_MATCH_SECONDS) || MATCH_SECONDS);

  gens: { p: number; distUntil: number; done: boolean; act: number; recent: Set<number> }[] = [];
  seals: { occ: number[]; prog: number }[] = [];
  gate = 0 as 0 | 1 | 2 | 3;
  gateProg = 0;
  zones: { id: number; k: 'time' | 'dark' | 'blackout'; x: number; z: number; r: number; until: number }[] = [];
  sigils: { id: number; x: number; z: number; cool: Map<number, number> }[] = [];
  decoys: { id: number; x: number; z: number; y: number; vx: number; vz: number; until: number }[] = [];
  pings: { x: number; z: number; until: number }[] = [];
  trace: { until: number; lines: { x: number; z: number }[][] } | null = null;
  marks: { x: number; z: number; until: number }[] = [];
  private idc = 1;
  private evq: QEvent[] = [];
  killer: P;
  killerType: KillerId;
  escaped = 0;

  constructor(mapId: MapId, killerType: KillerId, seats: MatchSeat[], private onEnd: (e: MatchEnd) => void) {
    this.map = buildMap(mapId);
    this.killerType = killerType;
    let si = 0;
    for (const s of seats) {
      const p = new P(s.id, s.role, s.name, s.char, s.pub, s.conn);
      const sp = s.role === 'K' ? this.map.killerSpawn : this.map.survSpawns[si++ % this.map.survSpawns.length];
      p.x = sp.x; p.z = sp.z;
      p.yaw = Math.atan2(this.map.w * CELL * 0.5 - p.x, this.map.h * CELL * 0.5 - p.z);
      this.players.push(p);
    }
    this.killer = this.players.find((p) => p.role === 'K')!;
    this.gens = this.map.gens.map(() => ({ p: 0, distUntil: 0, done: false, act: 0, recent: new Set<number>() }));
    this.seals = this.map.seals.map(() => ({ occ: [], prog: 0 }));
  }

  // ------------------------------------------------------------ lifecycle
  start() {
    for (const p of this.players) if (p.conn) this.sendInit(p, false);
    this.lastReal = Date.now();
    this.timer = setInterval(() => this.loop(), 8);
  }
  destroy() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private loop() {
    const now = Date.now();
    this.acc += Math.min(250, now - this.lastReal) * this.speed;
    this.lastReal = now;
    let n = 0;
    const maxSteps = 6 * this.speed;
    while (this.acc >= DT * 1000 && n < maxSteps) {
      this.acc -= DT * 1000;
      try { this.tick(); }
      catch (e) {
        // a bug in one match must never take the whole server (and every other match) down
        console.error('[match] tick error:', e);
        if (++this.tickErrors >= 3) { try { this.abort(); } catch (e2) { console.error('[match] abort failed:', e2); } this.destroy(); return; }
      }
      n++;
    }
    if (n === maxSteps) this.acc = 0;
  }
  private tickErrors = 0;

  sendInit(p: P, resume: boolean) {
    const msg: InitMsg = {
      t: 'init', map: this.map.id, you: p.id, role: p.role, killer: this.killerType,
      players: this.players.map((o) => ({ id: o.id, name: o.name, role: o.role, char: o.char, pub: o.pub })),
      matchSeconds: this.matchSeconds, resume,
    };
    p.conn?.send(msg);
  }

  playerByConn(c: Conn) { return this.players.find((p) => p.conn === c); }

  onDisconnect(c: Conn) {
    const p = this.playerByConn(c);
    if (!p) return;
    p.conn = null; p.discAt = this.t; p.q.length = 0; p.moving = false;
    p.use = false;
  }

  /** Returns true when the player was re-attached to this running match (reconnect within the grace window). */
  onReconnect(c: Conn, pub: string): boolean {
    const p = this.players.find((o) => o.pub === pub && !o.gone);
    if (!p || p.conn) return false;
    p.conn = c; p.discAt = null;
    this.sendInit(p, true);
    return true;
  }

  // ------------------------------------------------------------ input
  input(c: Conn, m: Extract<import('../../shared/protocol').ClientMsg, { t: 'in' }>) {
    const p = this.playerByConn(c);
    if (!p || this.introLeft > 0) return;
    if (m.seq <= p.lastSeq) return; // replay / out of order
    p.lastSeq = m.seq;
    if (p.q.length >= 8) return; // flooding
    p.q.push({ seq: m.seq, mx: m.mx, mz: m.mz, yaw: m.yaw, pitch: m.pitch, run: m.run, crouch: m.crouch, use: m.use });
  }

  act(c: Conn, a: string, d: number) {
    const p = this.playerByConn(c);
    if (!p || this.ended || this.introLeft > 0) return;
    if (p.role === 'S') {
      if (a === 'transform') this.transform(p);
      else if (a === 'untransform') this.untransform(p);
    } else {
      if (a === 'attack') this.startAttack(p);
      else if (a === 'ab0' || a === 'ab1' || a === 'ab2') this.startCast(p, Number(a[2]), d);
    }
  }

  chat(c: Conn, id: number) {
    const p = this.playerByConn(c);
    if (!p || id < 0 || id >= CHAT_PRESETS.length) return;
    this.emit({ k: 'chat', i: p.id, id }, p.role === 'S' ? 'S' : undefined);
  }

  // ------------------------------------------------------------ helpers
  private emit(ev: GameEvent, to?: Target, at?: { x: number; z: number; rad: number }) { this.evq.push({ ev, to, at }); }
  private sound(s: string, x: number, z: number, rad: number, to?: Target, v = 1) { this.emit({ k: 'snd', s, x, z, v }, to, { x, z, rad }); }
  private get survivors() { return this.players.filter((p) => p.role === 'S'); }
  private alive(p: P) { return p.role === 'S' && p.state === 'alive'; }
  private speedMul(p: P): number {
    let m = 1;
    if (p.role === 'K') {
      if (p.cast) m *= RULES.castingSpeedMul;
      if (p.atk || this.t < p.recoverUntil) m *= RULES.attackRecoverSpeedMul;
      if (this.t < p.echoUntil) m *= 2.1;
      if (this.t < p.phaseUntil) m *= 1.5;
      if (p.mimic) m *= 0.8;
    } else if (p.inTime) m *= 0.6;
    return m;
  }
  private frozen(p: P): boolean {
    if (p.role === 'K') return false;
    return p.state !== 'alive' || this.t < p.animUntil || p.inter !== null;
  }

  // ------------------------------------------------------------ survivors: disguise
  private nearestProp(p: P): number {
    let best = -1, bestScore = 1e9;
    const m = this.map;
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    const reach = Math.ceil(RULES.transformRange / CELL) + 1;
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
      const x = cx + i, z = cz + j;
      if (x < 0 || z < 0 || x >= m.w || z >= m.h) continue;
      for (const idx of m.propCells[z * m.w + x]) {
        const pr = m.props[idx];
        const dx = pr.x - p.x, dz = pr.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > RULES.transformRange) continue;
        let da = 0;
        if (d > 1.0) {
          const [fx, fz] = fwd(p.yaw);
          da = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
          if (da > RULES.transformArcRad) continue;
        }
        if (!losClear(m, p.x, p.z, pr.x, pr.z)) continue;
        const score = d + da * 1.2;
        if (score < bestScore) { bestScore = score; best = idx; }
      }
    }
    return best;
  }

  private transform(p: P) {
    if (!this.alive(p) || this.t < p.tfCdUntil || this.t < p.animUntil) return;
    const idx = this.nearestProp(p);
    if (idx < 0) { this.emit({ k: 'msg', s: '変身できる物が近くにありません' }, p.id); return; }
    const pr = this.map.props[idx];
    p.disg = pr.type;
    p.disgSc = pr.sc * (0.97 + ((p.id * 7 + this.tk) % 7) * 0.01);
    p.anim = 1; p.animStart = this.t; p.animUntil = this.t + RULES.transformInS;
    p.tfCdUntil = this.t + RULES.transformInS + RULES.transformCooldownS;
    p.inter = null;
    const q = moveCircle(this.map, p.x, p.z, 0, 0, bodyRadius('S', p.disg), true);
    p.x = q.x; p.z = q.z;
    this.sound('transform', p.x, p.z, 8);
  }

  private untransform(p: P) {
    if (!this.alive(p) || p.disg < 0 || this.t < p.animUntil) return;
    this.reveal(p, true);
  }

  private reveal(p: P, anim: boolean) {
    p.disg = -1;
    if (anim) { p.anim = 2; p.animStart = this.t; p.animUntil = this.t + RULES.transformOutS; }
    p.tfCdUntil = Math.max(p.tfCdUntil, this.t + RULES.transformCooldownS);
    this.sound('untransform', p.x, p.z, 8);
  }

  // ------------------------------------------------------------ killer: attack / abilities
  private startAttack(k: P) {
    if (k.role !== 'K' || k.atk || k.cast || this.t < k.recoverUntil || this.t < k.phaseUntil) return;
    k.mimic = null; k.fsUntil = 0;
    k.atk = { fireAt: this.t + RULES.attackWindupS, start: this.t };
    this.sound('swing', k.x, k.z, 18);
  }

  private fireAttack(k: P) {
    const [fx, fz] = fwd(k.yaw);
    let hit: P | null = null, bd = 1e9;
    for (const s of this.survivors) {
      if (s.state !== 'alive' || this.t < s.protUntil) continue;
      const dx = s.x - k.x, dz = s.z - k.z, d = Math.hypot(dx, dz);
      if (d > RULES.attackRange) continue;
      if (d > 0.7) {
        const a = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
        if (a > RULES.attackArcRad) continue;
      }
      if (!losClear(this.map, k.x, k.z, s.x, s.z)) continue;
      if (d < bd) { bd = d; hit = s; }
    }
    k.atk = null;
    k.recoverStart = this.t;
    if (hit) {
      k.recoverUntil = this.t + RULES.attackRecoverHitS;
      this.emit({ k: 'hit', i: hit.id });
      this.capture(k, hit);
    } else {
      k.recoverUntil = this.t + RULES.attackRecoverMissS;
    }
  }

  private startCast(k: P, slot: number, d: number) {
    if (k.role !== 'K' || k.cast || k.atk || this.t < k.recoverUntil) return;
    const ab = KILLERS[this.killerType].abilities[slot];
    if (!ab || this.t < k.cdUntil[slot]) return;
    if (this.t < k.phaseUntil && slot !== 1) { /* allowed: other abilities while drifting */ }
    k.cdUntil[slot] = this.t + ab.cooldown;
    k.cast = { slot, fireAt: this.t + ab.windup, d };
    this.emit({ k: 'ab', i: k.id, slot, n: ab.name, x: k.x, z: k.z, ph: 'start' }, undefined, { x: k.x, z: k.z, rad: 40 }); // range-limited: far survivors learn nothing
    this.sound('cast_' + this.killerType + slot, k.x, k.z, 30);
  }

  private aimPoint(k: P, dist: number): { x: number; z: number } {
    const [fx, fz] = fwd(k.yaw);
    let d = dist;
    // pull the point back until it is inside open space
    for (let i = 0; i < 24; i++) {
      const x = k.x + fx * d, z = k.z + fz * d;
      if (losClear(this.map, k.x, k.z, x, z)) {
        const q = moveCircle(this.map, x, z, 0, 0, 0.45, true);
        return q;
      }
      d -= 0.6; if (d < 0) break;
    }
    return { x: k.x, z: k.z };
  }

  private fireAbility(k: P, slot: number, dReq: number) {
    const ab = KILLERS[this.killerType].abilities[slot];
    const range = Math.min(ab.range ?? 8, Math.max(1.5, dReq));
    const surv = this.survivors.filter((s) => s.state === 'alive' || s.state === 'sealed');
    const [fx, fz] = fwd(k.yaw);
    this.emit({ k: 'ab', i: k.id, slot, n: ab.name, x: k.x, z: k.z, ph: 'fire' }, undefined, { x: k.x, z: k.z, rad: 40 });
    const id = this.killerType + slot;
    switch (id) {
      // ---------------- THE ECHO
      case 'echo0': {
        k.cdUntil[0] = this.t + ab.cooldown;
        this.pings = [];
        for (const s of surv) {
          if (s.state !== 'alive') continue;
          if (Math.hypot(s.x - k.x, s.z - k.z) > (ab.radius ?? 26)) continue;
          if (this.t - s.lastMoveT > 0.6) continue; // stopped survivors do not echo back
          this.pings.push({ x: s.x + (Math.random() - 0.5) * 2.4, z: s.z + (Math.random() - 0.5) * 2.4, until: this.t + ab.duration });
        }
        this.emit({ k: 'msg', s: `反応 ${this.pings.length}` }, k.id);
        break;
      }
      case 'echo1': {
        let hits = 0;
        for (const s of surv) {
          if (s.state !== 'alive') continue;
          const dx = s.x - k.x, dz = s.z - k.z, d = Math.hypot(dx, dz);
          if (d > (ab.range ?? 11) || d < 0.01) continue;
          const a = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
          if (a > 0.62) continue;
          if (!losClear(this.map, k.x, k.z, s.x, s.z)) continue;
          s.distortUntil = this.t + ab.duration; hits++;
        }
        this.emit({ k: 'msg', s: `音圧 命中 ${hits}（位置は特定できない）` }, k.id);
        break;
      }
      case 'echo2': k.echoUntil = this.t + ab.duration; break;
      // ---------------- THE STITCHER
      case 'stitcher0': {
        const pt = this.aimPoint(k, range);
        if (this.sigils.length >= 3) this.sigils.shift();
        this.sigils.push({ id: this.idc++, x: pt.x, z: pt.z, cool: new Map() });
        break;
      }
      case 'stitcher1': k.phaseUntil = this.t + ab.duration; break;
      case 'stitcher2': {
        const pt = this.aimPoint(k, range);
        k.falseUntil = this.t + ab.duration; k.falsePos = pt; k.falseAcc = 0;
        break;
      }
      // ---------------- THE MIMIC
      case 'mimic0': {
        let best = -1, bd = 1e9;
        for (let i = 0; i < this.map.props.length; i++) {
          const pr = this.map.props[i];
          const dx = pr.x - k.x, dz = pr.z - k.z, d = Math.hypot(dx, dz);
          if (d > (ab.range ?? 4) || d < 0.01) continue;
          const a = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
          const score = d + a;
          if (score < bd) { bd = score; best = i; }
        }
        if (best < 0) {
          k.cdUntil[0] = this.t + 2;
          this.emit({ k: 'msg', s: '近くに擬態できる物がない' }, k.id);
          break;
        }
        const pr = this.map.props[best];
        k.mimic = { type: pr.type, sc: pr.sc, until: this.t + ab.duration };
        k.fsUntil = 0;
        break;
      }
      case 'mimic1': {
        const pool = this.survivors.filter((s) => s.state === 'alive');
        const src = pool.length ? pool[Math.floor(Math.random() * pool.length)] : this.survivors[0];
        k.fsChar = src ? src.char : 0;
        k.fsUntil = this.t + ab.duration; k.mimic = null;
        break;
      }
      case 'mimic2': {
        let best = -1, bd = 1e9;
        this.gens.forEach((g, i) => {
          if (g.done) return;
          const d = Math.hypot(this.map.gens[i].x - k.x, this.map.gens[i].z - k.z);
          if (d < bd && d <= (ab.range ?? 26)) { bd = d; best = i; }
        });
        if (best < 0) { k.cdUntil[2] = this.t + 2; this.emit({ k: 'msg', s: '範囲内に修理中の装置がない' }, k.id); break; }
        this.gens[best].distUntil = this.t + ab.duration;
        this.emit({ k: 'msg', s: `装置 #${best + 1} に異常が発生した` }, 'S');
        this.emit({ k: 'msg', s: `装置 #${best + 1} を妨害中` }, k.id);
        break;
      }
      // ---------------- THE CHRONOS
      case 'chronos0': {
        const pt = this.aimPoint(k, range);
        this.zones.push({ id: this.idc++, k: 'time', x: pt.x, z: pt.z, r: ab.radius ?? 5, until: this.t + ab.duration });
        break;
      }
      case 'chronos1': {
        const side = Math.random() < 0.5 ? 1 : -1;
        const y = k.yaw + side * 0.9;
        const sp = RULES.killerSpeed;
        this.decoys.push({ id: this.idc++, x: k.x, z: k.z, y, vx: Math.sin(y) * sp, vz: Math.cos(y) * sp, until: this.t + ab.duration });
        break;
      }
      case 'chronos2': {
        const lines: { x: number; z: number }[][] = [];
        for (const s of surv) {
          if (s.state !== 'alive') continue;
          const pts = s.hist.filter((h) => h.t >= this.t - 8 && h.t <= this.t - 1.5);
          let len = 0;
          for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
          if (len < 4) continue; // only large movements leave a trace
          lines.push(pts.filter((_, i) => i % 5 === 0).map((h) => ({ x: h.x, z: h.z })));
        }
        this.trace = { until: this.t + ab.duration, lines };
        this.emit({ k: 'msg', s: `痕跡 ${lines.length}（現在地ではない）` }, k.id);
        break;
      }
      // ---------------- THE LUMEN
      case 'lumen0': {
        const pt = this.aimPoint(k, range);
        this.zones.push({ id: this.idc++, k: 'blackout', x: pt.x, z: pt.z, r: ab.radius ?? 12, until: this.t + ab.duration });
        break;
      }
      case 'lumen1': k.lumenUntil = this.t + ab.duration; break;
      case 'lumen2': {
        const pt = this.aimPoint(k, range);
        this.zones.push({ id: this.idc++, k: 'dark', x: pt.x, z: pt.z, r: ab.radius ?? 4, until: this.t + ab.duration });
        break;
      }
    }
  }

  // ------------------------------------------------------------ capture / seal / rescue
  private capture(k: P, s: P) {
    if (s.disg >= 0) this.reveal(s, false);
    s.caps++;
    k.stats.caps++;
    s.inter = null;
    if (s.caps >= RULES.maxCaptures) { // stage 3: eliminated
      this.eliminate(s, k);
      return;
    }
    // choose the nearest free seal that is not right next to the killer (so a rescue is possible)
    let best = -1, bs = 1e9;
    this.map.seals.forEach((sp, i) => {
      const d = Math.hypot(sp.x - s.x, sp.z - s.z);
      const crowded = this.seals[i].occ.length ? 1000 : 0;
      const tooNear = d < 8 ? 50 : 0;
      const score = d + crowded + tooNear;
      if (score < bs) { bs = score; best = i; }
    });
    s.state = 'sealed'; s.sealIdx = best; s.sealUntil = this.t + RULES.sealTimeoutS;
    this.seals[best].occ.push(s.id);
    s.x = this.map.seals[best].x; s.z = this.map.seals[best].z; s.moving = false;
    this.emit({ k: 'cap', i: s.id, by: k.id, stage: s.caps + 1 });
    this.sound('seal', s.x, s.z, 40);
  }

  private eliminate(s: P, by: P | null) {
    if (s.state === 'eliminated') return;
    if (s.sealIdx >= 0) this.seals[s.sealIdx].occ = this.seals[s.sealIdx].occ.filter((i) => i !== s.id);
    s.sealIdx = -1; s.state = 'eliminated'; s.disg = -1; s.inter = null;
    if (by) by.stats.elims++;
    this.emit({ k: 'out', i: s.id });
  }

  // ------------------------------------------------------------ tick
  private tick() {
    this.tk++;
    if (this.ended) return;
    if (this.introLeft > 0) {
      this.introLeft -= DT;
      if (this.tk % SNAP_EVERY === 0) this.sendSnaps();
      return;
    }
    this.t += DT;
    this.computeInteractions();
    this.processInputs();
    this.updateKiller();
    this.updateWorld();
    this.updateTimers();
    this.checkEnd();
    if (this.tk % SNAP_EVERY === 0) this.sendSnaps();
  }

  private computeInteractions() {
    for (const s of this.survivors) {
      s.inter = null;
      if (s.state !== 'alive' || !s.use || s.disg >= 0 || this.t < s.animUntil) continue;
      // priority: rescue > gate > generator
      for (let i = 0; i < this.seals.length; i++) {
        if (!this.seals[i].occ.length) continue;
        const sp = this.map.seals[i];
        if (Math.hypot(sp.x - s.x, sp.z - s.z) <= RULES.rescueRange) { s.inter = { kind: 'rescue', idx: i }; break; }
      }
      if (s.inter) continue;
      if ((this.gate === 1 || this.gate === 2) && Math.hypot(this.map.gate.x - s.x, this.map.gate.z - s.z) <= RULES.gateRange) { s.inter = { kind: 'gate', idx: 0 }; continue; }
      for (let i = 0; i < this.gens.length; i++) {
        if (this.gens[i].done) continue;
        const g = this.map.gens[i];
        if (Math.hypot(g.x - s.x, g.z - s.z) <= RULES.genRange) { s.inter = { kind: 'gen', idx: i }; break; }
      }
    }
  }

  private processInputs() {
    for (const p of this.players) {
      if (p.gone) continue;
      p.budget = Math.min(3, p.budget + 1);
      let used = 0;
      while (p.q.length && p.budget >= 1) {
        p.budget -= 1;
        this.applyInput(p, p.q.shift()!);
        used++;
      }
      if (!used) {
        p.moving = false;
        if (p.role === 'S' && p.state === 'alive') this.regen(p, RULES.regenIdle);
      }
      if (p.moving) p.lastMoveT = this.t;
      // footsteps / scraping sounds (positional, range-limited on the server)
      if (p.role === 'K' || (p.state === 'alive' && p.moving)) {
        if (p.moving) {
          const crouching = p.role === 'S' && p.crouch && p.disg < 0;
          if (!crouching) {
            const running = p.role === 'S' && p.run && p.disg < 0 && !p.exhausted;
            const iv = p.role === 'K' ? 0.42 : p.disg >= 0 ? 0.7 : running ? 0.34 : 0.5;
            p.footAcc += DT;
            if (p.footAcc >= iv) {
              p.footAcc = 0;
              const rad = p.role === 'K' ? RULES.hearKiller : p.disg >= 0 ? RULES.hearDisguisedMove : running ? RULES.hearRun : RULES.hearWalk;
              this.sound(p.role === 'K' ? 'step_k' : p.disg >= 0 ? 'scrape' : 'step', p.x, p.z, rad, p.role === 'K' ? undefined : undefined, running ? 1 : 0.6);
            }
          }
        } else p.footAcc = 0;
      }
      // history for Time Trace / Lumen Trace (10 Hz)
      if (p.role === 'S' && this.tk % 3 === 0) {
        p.hist.push({ t: this.t, x: p.x, z: p.z });
        if (p.hist.length > 130) p.hist.shift();
      }
    }
  }

  private regen(p: P, rate: number) {
    p.stamina = Math.min(RULES.staminaMax, p.stamina + rate * DT);
    if (p.exhausted && p.stamina >= RULES.exhaustRecover) p.exhausted = false;
  }

  private applyInput(p: P, inp: InputCmd) {
    p.ack = inp.seq;
    p.yaw = normYaw(inp.yaw);
    p.pitch = inp.pitch;
    p.use = inp.use; p.run = inp.run; p.crouch = inp.crouch;
    if (p.role === 'S' && p.state !== 'alive') { p.moving = false; return; }
    if (this.frozen(p)) { p.moving = false; if (p.role === 'S') this.regen(p, RULES.regenIdle); return; }
    const canRun = !p.exhausted && p.stamina > 0;
    const speed = baseSpeed({ role: p.role, run: inp.run, crouch: inp.crouch, canRun, disguise: p.disg, mul: this.speedMul(p) });
    const r = bodyRadius(p.role, p.disg);
    const q = stepMove(this.map, p.x, p.z, inp, speed, r);
    const moved = Math.hypot(q.x - p.x, q.z - p.z);
    p.x = q.x; p.z = q.z;
    p.moving = moved > 0.015;
    if (p.role === 'S') {
      const running = inp.run && !inp.crouch && p.disg < 0 && canRun && p.moving;
      if (running) {
        p.stamina -= RULES.runDrain * DT;
        if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; }
      } else this.regen(p, p.moving ? RULES.regenWalk : RULES.regenIdle);
    }
  }

  private updateKiller() {
    const k = this.killer;
    if (k.gone) return;
    if (k.atk && this.t >= k.atk.fireAt) this.fireAttack(k);
    if (k.cast && this.t >= k.cast.fireAt) { const c = k.cast; k.cast = null; this.fireAbility(k, c.slot, c.d); }
    if (k.mimic && this.t >= k.mimic.until) k.mimic = null;
    if (k.fsUntil && this.t >= k.fsUntil) k.fsUntil = 0;
    // False Path: fake footsteps at the target point (does NOT reveal anyone's position)
    if (this.t < k.falseUntil) {
      k.falseAcc += DT;
      if (k.falseAcc >= 0.5) {
        k.falseAcc = 0;
        this.sound('step', k.falsePos.x + (Math.random() - 0.5) * 0.8, k.falsePos.z + (Math.random() - 0.5) * 0.8, 24, 'S', 0.8);
      }
    }
    // decoys (Chronos afterimage): walk, collide with walls, harmless
    for (const d of this.decoys) {
      const q = moveCircle(this.map, d.x, d.z, d.vx * DT, d.vz * DT, 0.4, false);
      d.x = q.x; d.z = q.z;
    }
    this.decoys = this.decoys.filter((d) => d.until > this.t);
    this.zones = this.zones.filter((z) => z.until > this.t);
    this.pings = this.pings.filter((p) => p.until > this.t);
    this.marks = this.marks.filter((m) => m.until > this.t);
    if (this.trace && this.trace.until <= this.t) this.trace = null;

    // zone membership for survivors
    for (const s of this.survivors) {
      s.inTime = false; s.inDark = false;
      if (s.state !== 'alive') continue;
      for (const z of this.zones) {
        if (Math.hypot(z.x - s.x, z.z - s.z) <= z.r) {
          if (z.k === 'time') s.inTime = true;
          if (z.k === 'dark') s.inDark = true;
        }
      }
    }
    // Lumen Trace: survivors touched by the particle field leave a trail of where they WERE (1s ago)
    if (this.t < k.lumenUntil) {
      for (const s of this.survivors) {
        if (s.state !== 'alive') continue;
        if (Math.hypot(s.x - k.x, s.z - k.z) <= (KILLERS.lumen.abilities[1].radius ?? 7)) s.markedUntil = this.t + 4;
      }
    }
    for (const s of this.survivors) {
      if (this.t < s.markedUntil && s.state === 'alive' && this.t - s.lastMarkAt >= 0.4) {
        s.lastMarkAt = this.t;
        const old = s.hist.find((h) => h.t >= this.t - 1.0) ?? s.hist[0];
        if (old) { this.marks.push({ x: old.x, z: old.z, until: this.t + 3.5 }); if (this.marks.length > 80) this.marks.shift(); }
      }
    }
    // Stitcher sigils notify the killer when a survivor walks over them
    for (const sg of this.sigils) {
      for (const s of this.survivors) {
        if (s.state !== 'alive' || this.t < s.protUntil) continue;
        if (Math.hypot(sg.x - s.x, sg.z - s.z) > KILLERS.stitcher.abilities[0].radius!) continue;
        if ((sg.cool.get(s.id) ?? -99) > this.t - 6) continue;
        sg.cool.set(s.id, this.t);
        this.emit({ k: 'msg', s: '紋章が反応した！' }, k.id);
        this.sound('sigil', sg.x, sg.z, 200, k.id);
      }
    }
  }

  private updateWorld() {
    // generators
    const contrib = new Map<number, number[]>();
    for (const s of this.survivors) {
      if (s.state === 'alive' && s.inter?.kind === 'gen') {
        const arr = contrib.get(s.inter.idx) ?? [];
        arr.push(s.inTime ? 0.6 : 1);
        contrib.set(s.inter.idx, arr);
        this.gens[s.inter.idx].recent.add(s.id);
      }
    }
    this.gens.forEach((g, i) => {
      const arr = (contrib.get(i) ?? []).sort((a, b) => b - a);
      g.act = arr.length ? 1 : 0;
      if (g.done || !arr.length) return;
      let rate = arr[0] + (arr[1] ?? 0) * RULES.genSecondRepairerBonus;
      if (this.t < g.distUntil) rate *= 0.4;
      g.p = Math.min(1, g.p + (rate * DT) / RULES.genRepairS);
      if (this.tk % 90 === 0) this.sound('repair', this.map.gens[i].x, this.map.gens[i].z, 14);
      if (g.p >= 1) {
        g.done = true;
        for (const id of g.recent) this.players[id].stats.gens++;
        g.recent.clear();
        const done = this.gens.filter((x) => x.done).length;
        this.emit({ k: 'gen', n: i, done });
        this.sound('gen_done', this.map.gens[i].x, this.map.gens[i].z, 60);
        if (done >= RULES.genRequired && this.gate === 0) {
          this.gate = 1;
          this.emit({ k: 'gate', s: 1 });
          this.emit({ k: 'msg', s: '脱出ゲートに電力が届いた！ゲートへ向かえ' });
        }
      }
    });
    // rescue
    this.seals.forEach((sl, i) => {
      const rescuers = this.survivors.filter((s) => s.state === 'alive' && s.inter?.kind === 'rescue' && s.inter.idx === i);
      if (!sl.occ.length) { sl.prog = 0; return; }
      if (rescuers.length) {
        sl.prog += (Math.min(2, rescuers.length) * DT) / RULES.rescueS;
        if (this.tk % 45 === 0) this.sound('rescue_work', this.map.seals[i].x, this.map.seals[i].z, 14);
        if (sl.prog >= 1) {
          sl.prog = 0;
          const id = sl.occ.shift()!;
          const s = this.players[id];
          s.state = 'alive'; s.sealIdx = -1; s.protUntil = this.t + RULES.protectedS;
          const sp = this.map.seals[i];
          const q = moveCircle(this.map, sp.x + 1.2, sp.z, 0, 0, RULES.playerRadius, true);
          s.x = q.x; s.z = q.z;
          for (const r of rescuers) r.stats.rescues++;
          this.emit({ k: 'rescue', i: s.id, by: rescuers[0].id });
          this.sound('rescue', sp.x, sp.z, 50);
        }
      } else sl.prog = Math.max(0, sl.prog - 0.25 * DT);
    });
    // gate
    if (this.gate === 1 || this.gate === 2) {
      const working = this.survivors.filter((s) => s.state === 'alive' && s.inter?.kind === 'gate').length;
      if (working) {
        if (this.gate === 1) { this.gate = 2; this.emit({ k: 'gate', s: 2 }); }
        this.gateProg = Math.min(1, this.gateProg + (Math.min(2, working) * DT) / RULES.gateOpenS);
        if (this.tk % 45 === 0) this.sound('gate_work', this.map.gate.x, this.map.gate.z, 30);
        if (this.gateProg >= 1) {
          this.gate = 3; this.emit({ k: 'gate', s: 3 });
          this.emit({ k: 'msg', s: '脱出ゲートが開いた！' });
          this.sound('gate_open', this.map.gate.x, this.map.gate.z, 200);
        }
      }
    }
    // escape
    if (this.gate === 3) {
      for (const s of this.survivors) {
        if (s.state !== 'alive') continue;
        if (Math.hypot(this.map.gate.x - s.x, this.map.gate.z - s.z) <= RULES.exitRange) {
          s.state = 'escaped'; s.disg = -1; s.inter = null; this.escaped++;
          this.emit({ k: 'esc', i: s.id });
        }
      }
    }
  }

  private updateTimers() {
    for (const s of this.survivors) {
      if (s.state === 'sealed' && this.t >= s.sealUntil) this.eliminate(s, this.killer);
      if (s.anim && this.t >= s.animUntil) s.anim = 0;
    }
    for (const p of this.players) {
      if (p.discAt !== null && !p.gone && this.t - p.discAt > RECONNECT_GRACE_S) {
        p.gone = true;
        if (p.role === 'S' && (p.state === 'alive' || p.state === 'sealed')) this.eliminate(p, null);
      }
    }
  }

  private checkEnd() {
    if (this.killer.gone) return this.finish('aborted');
    const ss = this.survivors;
    if (ss.every((s) => s.gone)) return this.finish('aborted');
    if (ss.every((s) => s.state === 'eliminated' || s.state === 'escaped')) return this.finish(this.escaped >= RULES.survivorsNeededToWin ? 'survivors' : 'killer');
    if (this.t >= this.matchSeconds) return this.finish(this.escaped >= RULES.survivorsNeededToWin ? 'survivors' : 'killer');
  }

  /** Called by Room when too few humans remain; never replaced by AI. */
  abort() { if (!this.ended) this.finish('aborted'); }

  private finish(result: 'survivors' | 'killer' | 'aborted') {
    if (this.ended) return;
    this.ended = true;
    this.destroy();
    this.sendSnaps(); // flush last events
    this.onEnd({
      result, escaped: this.escaped, killer: this.killerType,
      seats: this.players.map((p) => ({ id: p.id, role: p.role, conn: p.conn, name: p.name, pub: p.pub, state: p.role === 'K' ? 'killer' : p.state, stats: p.stats, gone: p.gone })),
    });
  }

  // ------------------------------------------------------------ snapshots (per-recipient, visibility-culled)
  private sees(v: P, o: P): boolean {
    if (v === o) return true;
    if (v.role === 'S' && (v.state === 'eliminated' || v.state === 'escaped')) return o.state !== 'eliminated' && o.state !== 'escaped';
    if (o.state === 'eliminated' || o.state === 'escaped') return false;
    const dx = o.x - v.x, dz = o.z - v.z, d = Math.hypot(dx, dz);
    if (d <= RULES.closeRange) return true;
    if (d > RULES.viewRange) return false;
    if (losClear(this.map, v.x, v.z, o.x, o.z)) return true;
    const nx = -dz / d * 0.45, nz = dx / d * 0.45; // peek around corners without popping in late
    return losClear(this.map, v.x, v.z, o.x + nx, o.z + nz) || losClear(this.map, v.x, v.z, o.x - nx, o.z - nz);
  }

  private snapPlayer(o: P): SnapPlayer {
    const sp: SnapPlayer = {
      i: o.id, x: round(o.x), z: round(o.z), y: round(o.yaw, 100), m: o.moving ? 1 : 0, r: o.run && o.moving && o.role === 'S' && o.disg < 0 && !o.exhausted ? 1 : 0,
      c: o.crouch && o.disg < 0 ? 1 : 0, s: o.role === 'K' ? 'K' : o.state, d: o.disg, ds: round(o.disgSc, 100), da: o.anim,
      dp: o.anim ? round(Math.min(1, (this.t - o.animStart) / Math.max(0.01, o.animUntil - o.animStart)), 100) : 0,
      pr: this.t < o.protUntil ? 1 : 0, rp: o.inter ? 1 : 0, st: Math.min(3, o.caps + 1),
    };
    if (o.role === 'K') {
      if (this.t < o.phaseUntil) sp.ph = 1;
      if (o.mimic) sp.kd = { t: 'prop', id: o.mimic.type, sc: o.mimic.sc };
      else if (this.t < o.fsUntil) sp.kd = { t: 'surv', char: o.fsChar };
      if (o.atk) sp.at = round(Math.min(1, (this.t - o.atk.start) / RULES.attackWindupS), 100);
      else if (this.t < o.recoverUntil) sp.at = 1;
      if (o.cast) sp.cs = o.cast.slot + 1;
    }
    return sp;
  }

  private sendSnaps() {
    const evs = this.evq; this.evq = [];
    const secLeft = Math.max(0, this.matchSeconds - this.t);
    for (const v of this.players) {
      if (!v.conn) continue;
      const events: GameEvent[] = [];
      for (const q of evs) {
        if (q.to === 'K' && v.role !== 'K') continue;
        if (q.to === 'S' && v.role !== 'S') continue;
        if (typeof q.to === 'number' && q.to !== v.id) continue;
        if (q.at && !(v.role === 'S' && (v.state === 'eliminated' || v.state === 'escaped'))) {
          if (Math.hypot(q.at.x - v.x, q.at.z - v.z) > q.at.rad) continue;
        }
        events.push(q.ev);
      }
      const spectator = v.role === 'S' && (v.state === 'eliminated' || v.state === 'escaped');
      const others: SnapPlayer[] = [];
      for (const o of this.players) {
        if (o === v) continue;
        if (this.sees(v, o)) others.push(this.snapPlayer(o));
      }
      const gens: GenState[] = this.gens.map((g) => ({ p: round(g.p, 1000), dist: this.t < g.distUntil ? round(g.distUntil - this.t, 10) : 0, act: g.act, done: g.done ? 1 : 0 }));
      const fx = {
        zones: this.zones.map((z) => ({ id: z.id, k: z.k, x: round(z.x), z: round(z.z), r: z.r, left: round(z.until - this.t, 10) })),
        sigils: this.sigils.map((s) => ({ id: s.id, x: round(s.x), z: round(s.z) })),
        decoys: this.decoys.filter((d) => v.role === 'K' || spectator || this.sees(v, { x: d.x, z: d.z, state: 'alive' } as P)).map((d) => ({ id: d.id, x: round(d.x), z: round(d.z), y: round(d.y, 100) })),
      };
      let terror = 0;
      if (v.role === 'S' && v.state === 'alive') {
        const d = Math.hypot(this.killer.x - v.x, this.killer.z - v.z);
        terror = Math.max(0, Math.min(1, 1 - (d - 3) / (RULES.terrorRadius - 3)));
      }
      const me: SnapMsg['me'] = {
        x: round(v.x, 1000), z: round(v.z, 1000), ack: v.ack,
        sm: round(this.speedMul(v), 100), fz: this.frozen(v) ? 1 : 0, cr: !v.exhausted && v.stamina > 0 ? 1 : 0,
        stam: Math.round(v.stamina), dis: this.t < v.distortUntil ? round(v.distortUntil - this.t, 10) : 0,
        dark: v.inDark ? 1 : 0, slow: v.inTime ? 1 : 0, tfcd: Math.max(0, round(v.tfCdUntil - this.t, 10)),
        seal: v.state === 'sealed' ? round(Math.max(0, v.sealUntil - this.t), 10) : 0,
        d: v.disg, ds: round(v.disgSc, 100), s: v.role === 'K' ? 'K' : v.state, pr: this.t < v.protUntil ? 1 : 0, st: Math.min(3, v.caps + 1),
        da: v.anim, dp: v.anim ? round(Math.min(1, (this.t - v.animStart) / Math.max(0.01, v.animUntil - v.animStart)), 100) : 0,
        rp: v.inter ? 1 : 0, mmv: v.mimic ? 1 : 0,
      };
      if (v.role === 'S') me.mk = this.t < v.markedUntil ? round(v.markedUntil - this.t, 10) : 0;
      if (v.role === 'K') {
        me.cd = v.cdUntil.map((c) => Math.max(0, round(c - this.t, 10)));
        let sense = -1, bd = RULES.senseRadius;
        for (const s of this.survivors) if (s.state === 'alive' && s.disg >= 0) { const d = Math.hypot(s.x - v.x, s.z - v.z); if (d <= bd) { bd = d; sense = round(d, 10); } }
        me.sense = sense;
      }
      const msg: SnapMsg = {
        t: 'snap', tk: this.tk, left: round(secLeft, 10), me, p: others, g: gens, gate: this.gate, gp: round(this.gateProg, 1000),
        seals: this.seals.map((s) => ({ occ: s.occ.length ? s.occ[0] : -1, prog: round(s.prog, 1000) })),
        fx, ev: events, terror: round(terror, 100),
        team: this.survivors.map((s) => ({ i: s.id, s: s.state, st: Math.min(3, s.caps + 1), rp: s.inter ? 1 : 0 })),
      };
      if (v.role === 'K') {
        msg.pings = this.pings.map((p) => ({ x: round(p.x), z: round(p.z), l: round(p.until - this.t, 10) }));
        if (this.trace) msg.trace = this.trace.lines.map((l) => ({ pts: l.map((p) => ({ x: round(p.x), z: round(p.z) })) }));
        msg.marks = this.marks.map((m) => ({ x: round(m.x), z: round(m.z), l: round(m.until - this.t, 10) }));
      }
      v.conn.send(msg as ServerMsg);
    }
  }
}

function round(n: number, f = 100) { return Math.round(n * f) / f; }
export { PLAYERS_PER_MATCH, XP };
