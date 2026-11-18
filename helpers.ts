// TEST HARNESS ONLY. These are scripted WebSocket test clients used to exercise the server end-to-end.
// They are NOT part of the game: the server has no bot/AI/NPC participant type, and this file is never
// imported by server/ or client/. Real matches need 5 real humans.
import { WebSocket } from 'ws';
import { CELL, MapId, RULES } from '../shared/constants';
import type { KillerId } from '../shared/killers';
import { buildMap, GameMap, moveCircle } from '../shared/maps';
import type { GameEvent, InitMsg, RoomInfo, ServerMsg, SnapMsg } from '../shared/protocol';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(cond: () => boolean, ms: number, label: string): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for: ' + label);
    await sleep(15);
  }
}

// ------------------------------------------------------------------ navigation on a 0.5 m free-space grid
const STEP = 0.5;
class Nav {
  nx: number; nz: number; free: Uint8Array;
  constructor(public map: GameMap) {
    this.nx = Math.ceil((map.w * CELL) / STEP); this.nz = Math.ceil((map.h * CELL) / STEP);
    this.free = new Uint8Array(this.nx * this.nz);
    const R = RULES.killerRadius + 0.05;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = (i + 0.5) * STEP, z = (j + 0.5) * STEP;
      const p = moveCircle(map, x, z, 0, 0, R, true);
      this.free[j * this.nx + i] = Math.hypot(p.x - x, p.z - z) < 0.02 ? 1 : 0;
    }
  }
  private nearestFree(x: number, z: number): number {
    const ci = Math.max(0, Math.min(this.nx - 1, Math.floor(x / STEP))), cj = Math.max(0, Math.min(this.nz - 1, Math.floor(z / STEP)));
    for (let r = 0; r < 12; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const a = ci + i, b = cj + j;
      if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
      if (this.free[b * this.nx + a]) return b * this.nx + a;
    }
    return cj * this.nx + ci;
  }
  path(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
    const s = this.nearestFree(from.x, from.z), g = this.nearestFree(to.x, to.z);
    const prev = new Int32Array(this.nx * this.nz).fill(-2);
    const q = [s]; prev[s] = -1;
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      if (c === g) break;
      const ci = c % this.nx, cj = (c / this.nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = ci + di, b = cj + dj;
        if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
        const k = b * this.nx + a;
        if (prev[k] !== -2 || !this.free[k]) continue;
        if (di && dj && (!this.free[cj * this.nx + a] || !this.free[b * this.nx + ci])) continue;
        prev[k] = c; q.push(k);
      }
    }
    if (prev[g] === -2) return [to];
    const out: { x: number; z: number }[] = [];
    for (let c = g; c !== -1; c = prev[c]) out.push({ x: ((c % this.nx) + 0.5) * STEP, z: (((c / this.nx) | 0) + 0.5) * STEP });
    out.reverse();
    // thin the path: keep every 2nd waypoint, always the last
    const thin = out.filter((_, i) => i % 2 === 1 || i === out.length - 1);
    return thin.length ? thin : [to];
  }
}
const navCache = new Map<MapId, Nav>();
export const navFor = (id: MapId) => { let n = navCache.get(id); if (!n) { n = new Nav(buildMap(id)); navCache.set(id, n); } return n; };

// ------------------------------------------------------------------ client
export class TC {
  ws!: WebSocket;
  token = ''; pub = '';
  room: RoomInfo | null = null;
  init: InitMsg | null = null;
  snap: SnapMsg | null = null;
  prevSnap: SnapMsg | null = null;
  snaps = 0;
  end: Extract<ServerMsg, { t: 'end' }> | null = null;
  errs: string[] = [];
  events: GameEvent[] = [];
  wantKiller: KillerId = 'echo';
  closedCode: number | null = null;
  // control state (sent at ~90 Hz)
  ctl = { mx: 0, mz: 0, yaw: 0, run: false, crouch: false, use: false };
  seq = 1;
  drive: ((c: TC) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private path: { x: number; z: number }[] = []; private pathGoal = ''; private pathAt = 0;
  private lastPos = { x: 0, z: 0, t: 0 };
  snapLog: { t: number; tk: number; x: number; z: number }[] = [];

  static async open(port: number, name: string, token?: string): Promise<TC> {
    const c = new TC(); c.name = name;
    c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    c.ws.on('message', (d) => c.onMsg(JSON.parse(d.toString()) as ServerMsg));
    c.ws.on('close', (code) => { c.closedCode = code; });
    c.ws.on('error', () => { /* surfaced via close */ });
    await new Promise<void>((res, rej) => { c.ws.on('open', () => res()); c.ws.on('error', rej); });
    c.send({ t: 'hello', v: 1, name, token });
    await waitFor(() => !!c.token, 4000, 'welcome ' + name);
    return c;
  }
  name = '';

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': this.token = m.token; this.pub = m.profile.pub; break;
      case 'room': this.room = m.room; break;
      case 'pickkiller': this.send({ t: 'killer', id: this.wantKiller }); break;
      case 'init': this.init = m; break;
      case 'snap':
        this.prevSnap = this.snap; this.snap = m; this.snaps++;
        for (const e of m.ev) this.events.push(e);
        this.snapLog.push({ t: Date.now(), tk: m.tk, x: m.me.x, z: m.me.z });
        if (this.snapLog.length > 400) this.snapLog.shift();
        break;
      case 'end': this.end = m; break;
      case 'err': this.errs.push(m.code); break;
      default: break;
    }
  }
  send(m: unknown) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  get role(): 'S' | 'K' | null { return this.init?.role ?? null; }
  get id(): number { return this.init?.you ?? -1; }
  get mapId(): MapId { return this.init!.map; }
  get map(): GameMap { return buildMap(this.init!.map); }
  get pos() { return this.snap ? { x: this.snap.me.x, z: this.snap.me.z } : { x: 0, z: 0 }; }
  act(a: 'transform' | 'untransform' | 'attack' | 'ab0' | 'ab1' | 'ab2', d?: number) { this.send({ t: 'act', a, d }); }
  count(pred: (e: GameEvent) => boolean) { return this.events.filter(pred).length; }

  startDriving(hz = 90) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.init || !this.snap) return;
      this.drive?.(this);
      const k = this.ctl;
      this.send({ t: 'in', seq: this.seq++, mx: k.mx, mz: k.mz, yaw: k.yaw, pitch: 0, run: k.run, crouch: k.crouch, use: k.use });
    }, Math.round(1000 / hz));
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  close() { this.stop(); try { this.ws.close(); } catch { /* */ } }
  kill() { this.stop(); try { this.ws.terminate(); } catch { /* */ } }

  // ---- steering helpers (set this.ctl; the interval sends it)
  idle() { this.ctl = { mx: 0, mz: 0, yaw: this.ctl.yaw, run: false, crouch: false, use: false }; this.path = []; }
  face(x: number, z: number) { const p = this.pos; this.ctl.yaw = Math.atan2(x - p.x, z - p.z); }
  /** walk to (x,z) via the nav grid; returns true when within `reach` metres. */
  goto(x: number, z: number, reach = 0.8, run = false): boolean {
    const p = this.pos;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= reach) { this.ctl.mx = 0; this.ctl.mz = 0; this.ctl.run = false; return true; }
    const goal = `${Math.round(x)},${Math.round(z)}`;
    const now = Date.now();
    // stuck detection: no progress for 1.2 s -> re-plan with a nudge
    if (now - this.lastPos.t > 1200) {
      const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      this.lastPos = { x: p.x, z: p.z, t: now };
      if (moved < 0.15) this.pathAt = 0;
    }
    if (goal !== this.pathGoal || now - this.pathAt > 1500 || !this.path.length) {
      this.path = navFor(this.mapId).path(p, { x, z }); this.pathGoal = goal; this.pathAt = now;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.7) this.path.shift();
    const w = this.path[0] ?? { x, z };
    this.ctl.yaw = Math.atan2(w.x - p.x, w.z - p.z);
    this.ctl.mx = 0; this.ctl.mz = 1; this.ctl.run = run; this.ctl.crouch = false;
    return false;
  }
}

// ------------------------------------------------------------------ room setup
export interface Group { clients: TC[]; killer: TC; survivors: TC[]; map: GameMap }

/** 5 humans (scripted) create a custom room, pick a map, the server picks the killer, killer picks a type. */
export async function startCustomMatch(port: number, tag: string, map: MapId, killerType: KillerId): Promise<Group> {
  const clients: TC[] = [];
  for (let i = 0; i < 5; i++) clients.push(await TC.open(port, `${tag}${i}`));
  for (const c of clients) c.wantKiller = killerType;
  const host = clients[0];
  host.send({ t: 'create' });
  await waitFor(() => !!host.room?.code, 3000, 'room code');
  const code = host.room!.code;
  for (const c of clients.slice(1)) c.send({ t: 'join', code });
  await waitFor(() => clients.every((c) => c.room && c.room.slots.filter(Boolean).length === 5), 4000, 'all joined');
  host.send({ t: 'setmap', map });
  await sleep(100);
  host.send({ t: 'start' });
  await waitFor(() => clients.every((c) => !!c.init), 40000, 'init for all (lobby countdown + killer pick)');
  const killer = clients.find((c) => c.role === 'K')!;
  const survivors = clients.filter((c) => c.role === 'S');
  await waitFor(() => clients.every((c) => c.snaps > 2), 8000, 'first snapshots');
  return { clients, killer, survivors, map: buildMap(map) };
}
