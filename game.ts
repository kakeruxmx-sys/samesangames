// In-match client: server-authoritative state + client-side prediction (own avatar), interpolation (others),
// camera, rendering, effects, HUD, audio hooks. The client never decides outcomes; it only sends intent.
import { CELL, CHAT_PRESETS, DT, RULES, SURVIVOR_LOOKS, WALL_H } from '../../shared/constants';
import { KILLERS, KillerId } from '../../shared/killers';
import { buildMap, GameMap, losClear } from '../../shared/maps';
import type { GameEvent, InitMsg, SnapMsg, SnapPlayer } from '../../shared/protocol';
import { PROPS } from '../../shared/props';
import { baseSpeed, bodyRadius, InputCmd, stepMove } from '../../shared/sim';
import { Sfx } from './audio';
import { Light, QUALITY, Quality, Renderer, Rgb } from './gl';
import { Input } from './input';
import { Draw, drawGate, drawGenerator, drawKiller, drawProp, drawSeal, drawSigil, drawSurvivor, drawZone, Anim } from './models';
import type { Net } from './net';
import { bakeWorld, pickLights, World } from './world';

interface Ent {
  id: number;
  buf: { t: number; p: SnapPlayer }[];
  lastSeen: number;
  lx: number; lz: number; // last rendered position
  face: number; // smoothed body facing
  propYaw: number;
  phase: number;
  speed: number;
  x: number; z: number; yaw: number; cur: SnapPlayer;
}
interface Fx { kind: 'ring' | 'burst' | 'flash'; x: number; y: number; z: number; t0: number; dur: number; r: number; c: Rgb }

/** An entity that has not appeared in a snapshot for this long is hidden (server-side visibility culling); when it reappears its interpolation buffer starts fresh. */
const STALE_MS = 300;
const hexRgb = (h: string): Rgb => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
const $ = (id: string) => document.getElementById(id)!;
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface GameHooks { onLeave: () => void; blocked: (pub: string) => boolean; openSettings: () => void }

export class Game {
  map: GameMap;
  world: World;
  d: Draw;
  me: number;
  role: 'S' | 'K';
  killerId: KillerId;
  names = new Map<number, string>();
  pubs = new Map<number, string>();
  chars = new Map<number, number>();
  snap: SnapMsg | null = null;
  ents = new Map<number, Ent>();
  // prediction
  px = 0; pz = 0; ox = 0; oz = 0; seq = 1; pending: InputCmd[] = []; tickAcc = 0; havePos = false; moveSpeedEst = 0;
  bodyYaw = 0; phase = 0; lastPx = 0; lastPz = 0;
  playing = false; resumed: boolean;
  running = false; raf = 0; last = 0; t = 0;
  fx: Fx[] = []; bubbles = new Map<number, { s: string; until: number }>();
  labelPool: HTMLElement[] = []; labelsUsed = 0;
  slashT = -9; hitT = -9; capT = -9; bannerT = 0;
  specIdx = 0; paused = false;
  fpsEma = 60; qualCheck = 0; goodTime = 0; qName: Quality['name'];
  gateSpanZ = true;
  cdTotal: number[];
  wasDistort = false; gensDone = 0; lastTerror = 0;
  prompt = '';
  dimZones: { x: number; z: number; r: number }[] = [];
  userQual: 'auto' | Quality['name'];
  tfAvail = false;
  matchSeconds: number;
  lockLostAt = -1e9;

  constructor(private r: Renderer, private net: Net, private sfx: Sfx, private input: Input, init: InitMsg, private hooks: GameHooks) {
    this.map = buildMap(init.map);
    this.world = bakeWorld(r, this.map, QUALITY.medium);
    this.d = new Draw(r);
    this.matchSeconds = init.matchSeconds;
    this.me = init.you; this.role = init.role; this.killerId = init.killer; this.resumed = init.resume;
    for (const p of init.players) { this.names.set(p.id, p.name); this.pubs.set(p.id, p.pub); this.chars.set(p.id, p.char); }
    this.cdTotal = KILLERS[init.killer].abilities.map((a) => a.cooldown);
    // gate frame orientation: parallel to the nearest wall
    const gx = Math.floor(this.map.gate.x / CELL), gz = Math.floor(this.map.gate.z / CELL);
    const dist = (dx: number, dz: number) => { let n = 0; let x = gx, z = gz; while (n < 60 && !this.isWall(x + dx, z + dz)) { x += dx; z += dz; n++; } return n; };
    const dx = Math.min(dist(1, 0), dist(-1, 0)), dz = Math.min(dist(0, 1), dist(0, -1));
    this.gateSpanZ = dx <= dz;
    const th = this.map.theme; r.fog = hexRgb(th.fog); r.fogD = th.fogDensity; r.amb = th.ambient; r.ambCol = [0.55, 0.62, 0.7];
    this.userQual = input.prefs.quality;
    this.qName = this.userQual === 'auto' ? (input.touch ? 'low' : 'medium') : this.userQual;
    r.setQuality(QUALITY[this.qName]);
    this.setupHud();
    input.setRole(init.role); input.enabled = true; input.reset();
    this.input.yaw = Math.atan2(this.map.w * CELL * 0.5 - this.map.survSpawns[0].x, this.map.h * CELL * 0.5 - this.map.survSpawns[0].z);
    this.input.pitch = 0.0;
    document.body.dataset.screen = 'game';
    $('hud').classList.remove('hidden');
    if (input.touch) $('touch').classList.remove('hidden');
    document.body.dataset.input = input.touch ? 'touch' : 'kbm';
    sfx.startAmbience({ rain: init.map === 'mall' || init.map === 'school' ? 1 : 0.4, wind: 1 });
    if (!input.touch) {
      // Esc while the pointer is locked only releases the lock (the browser swallows the key), so treat "lock lost during play" as "open the pause menu"
      let wasLocked = false;
      input.onLockChange = (l) => {
        $('lockhint').classList.toggle('hidden', l || this.paused);
        if (wasLocked && !l && this.running && !this.paused) { this.lockLostAt = performance.now(); this.setPaused(true); }
        wasLocked = l;
      };
      $('lockhint').classList.remove('hidden');
    }
    if (this.resumed) this.feed('試合に復帰しました');
    this.bindOnce();
  }

  private isWall(cx: number, cz: number) { return cx < 0 || cz < 0 || cx >= this.map.w || cz >= this.map.h || this.map.grid[cz * this.map.w + cx] === 1; }

  // ------------------------------------------------------------------ lifecycle
  private unbind: (() => void)[] = [];
  private bindOnce() {
    const off1 = this.net.on('snap', (m) => this.onSnap(m as SnapMsg));
    this.unbind.push(off1);
    const click = (e: Event) => { if ((e.target as HTMLElement).closest('#pause,#chatpanel,.btn')) return; if (this.isSpectating()) this.cycleSpectate(); };
    document.getElementById('gl')!.addEventListener('click', click); this.unbind.push(() => document.getElementById('gl')!.removeEventListener('click', click));
    const pr = $('p-resume'), ps = $('p-settings'), pl = $('p-leave');
    pr.onclick = () => this.setPaused(false); ps.onclick = () => this.hooks.openSettings(); pl.onclick = () => { this.hooks.onLeave(); };
  }
  start() { this.running = true; this.last = performance.now(); const loop = (n: number) => { if (!this.running) return; this.frame(n); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() {
    this.running = false; cancelAnimationFrame(this.raf);
    for (const f of this.unbind) f(); this.unbind = [];
    this.input.enabled = false; this.input.unlockPointer(); this.input.reset();
    $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); $('labels').innerHTML = ''; this.labelPool = [];
    document.body.classList.remove('distort');
    for (const id of ['fx-dark', 'fx-time', 'fx-mark', 'fx-hit']) ($(id) as HTMLElement).style.opacity = '0';
    this.sfx.stopAmbience();
  }
  setPaused(p: boolean) {
    this.paused = p; $('pause').classList.toggle('hidden', !p); this.input.enabled = !p;
    if (this.input.touch) $('touch').classList.toggle('hidden', p);
    if (p) { this.input.unlockPointer(); this.input.reset(); } else if (!this.input.touch) { this.input.lockPointer(); }
  }
  isSpectating() { return this.role === 'S' && !!this.snap && (this.snap.me.s === 'eliminated' || this.snap.me.s === 'escaped'); }
  private spectateTargets(): number[] { return this.snap ? this.snap.team.filter((t) => t.s === 'alive' && t.i !== this.me).map((t) => t.i).concat(this.role === 'S' ? [] : []) : []; }
  private cycleSpectate() { this.specIdx++; }

  // ------------------------------------------------------------------ network input
  private onSnap(m: SnapMsg) {
    const now = performance.now();
    const first = !this.snap;
    this.snap = m;
    const me = m.me;
    this.playing = m.left < this.matchSeconds - 0.02;
    // ---- reconcile own avatar with the authoritative state, then replay unacknowledged inputs
    const visX = this.px + this.ox, visZ = this.pz + this.oz;
    this.px = me.x; this.pz = me.z;
    this.pending = this.pending.filter((c) => c.seq > me.ack);
    for (const c of this.pending) this.applyLocal(c);
    if (!this.havePos || first) {
      this.havePos = true; this.ox = this.oz = 0; this.lastPx = this.px; this.lastPz = this.pz;
      // start facing the middle of the map (never straight into a wall)
      this.input.yaw = Math.atan2(this.map.w * CELL * 0.5 - this.px, this.map.h * CELL * 0.5 - this.pz); this.bodyYaw = this.input.yaw;
    }
    else {
      this.ox = visX - this.px; this.oz = visZ - this.pz;
      if (Math.hypot(this.ox, this.oz) > 1.8) { this.ox = this.oz = 0; }
    }
    // ---- others
    for (const p of m.p) {
      let e = this.ents.get(p.i);
      if (!e) { e = { id: p.i, buf: [], lastSeen: now, lx: p.x, lz: p.z, face: p.y, propYaw: p.y, phase: Math.random() * 6, speed: 0, x: p.x, z: p.z, yaw: p.y, cur: p }; this.ents.set(p.i, e); }
      else if (now - e.lastSeen > STALE_MS) { e.buf.length = 0; e.x = e.lx = p.x; e.z = e.lz = p.z; e.yaw = e.face = e.propYaw = p.y; e.speed = 0; } // came back into view: do not glide from the old position
      e.buf.push({ t: now, p }); if (e.buf.length > 8) e.buf.shift(); e.lastSeen = now;
    }
    // ---- events
    for (const ev of m.ev) this.onEvent(ev);
    this.updateHudSnap();
  }

  private onEvent(ev: GameEvent) {
    const nm = (i: number) => this.names.get(i) ?? '?';
    const isSurvChar = (i: number) => this.role === 'S' || i !== this.me;
    switch (ev.k) {
      case 'snd': this.sfx.play(ev.s, ev.x, ev.z, ev.v ?? 1); break;
      case 'ab': {
        if (ev.ph === 'start') {
          if (ev.i === this.me) this.banner(ev.n);
          else if (Math.hypot(ev.x - this.px, ev.z - this.pz) < 40) this.banner('⚠ ' + ev.n, true);
          this.fx.push({ kind: 'ring', x: ev.x, y: 0.1, z: ev.z, t0: this.t, dur: 0.7, r: 3, c: hexRgb(KILLERS[this.killerId].color) });
        } else {
          const def = KILLERS[this.killerId].abilities[ev.slot];
          if (this.killerId === 'echo' && ev.slot === 0) this.fx.push({ kind: 'ring', x: ev.x, y: 0.2, z: ev.z, t0: this.t, dur: 1.0, r: def.radius ?? 26, c: [0.5, 0.85, 1] });
          if (this.killerId === 'echo' && ev.slot === 1) for (let i = 0; i < 4; i++) this.fx.push({ kind: 'ring', x: ev.x, y: 1.2, z: ev.z, t0: this.t + i * 0.1, dur: 0.8, r: 6, c: [0.5, 0.85, 1] });
        }
        break;
      }
      case 'hit': if (ev.i === this.me) { this.hitT = this.t; this.sfx.play('hit'); } break;
      case 'cap':
        this.feed(`${nm(ev.i)} が捕獲された（${ev.stage}/3）`);
        if (ev.i === this.me) { this.banner('捕獲された — 仲間の救助を待て', true); this.capT = this.t; }
        this.fx.push({ kind: 'burst', x: this.map.seals[0].x, y: 1, z: this.map.seals[0].z, t0: this.t, dur: 0.01, r: 0, c: [0.6, 0.4, 1] });
        break;
      case 'rescue': this.feed(`${nm(ev.i)} が ${nm(ev.by)} に救助された`); if (ev.i === this.me) this.banner('救助された！'); break;
      case 'out': this.feed(`${nm(ev.i)} が脱落`); if (ev.i === this.me) this.banner('脱落 — 観戦モード', true); break;
      case 'esc': this.feed(`${nm(ev.i)} が脱出！`); if (ev.i === this.me) this.banner('脱出成功！'); break;
      case 'gen': this.gensDone = ev.done; this.feed(`装置 ${ev.done}/${RULES.genRequired} 修理完了`); break;
      case 'gate': if (ev.s === 1) this.banner('脱出ゲートに電力が届いた'); break;
      case 'msg': this.feed(ev.s); break;
      case 'chat': {
        if (this.hooks.blocked(this.pubs.get(ev.i) ?? '')) break;
        const text = CHAT_PRESETS[ev.id] ?? '';
        this.bubbles.set(ev.i, { s: text, until: this.t + 3.5 }); this.feed(`${nm(ev.i)}: ${text}`);
        break;
      }
      default: break;
    }
    void isSurvChar;
  }

  // ------------------------------------------------------------------ prediction
  private applyLocal(c: InputCmd) {
    const s = this.snap?.me; if (!s) return;
    if (s.fz) return;
    if (this.role === 'S' && s.s !== 'alive') return;
    const speed = baseSpeed({ role: this.role, run: c.run, crouch: c.crouch, canRun: s.cr === 1, disguise: s.d, mul: s.sm });
    const q = stepMove(this.map, this.px, this.pz, c, speed, bodyRadius(this.role, s.d));
    this.px = q.x; this.pz = q.z;
  }

  private sendInput() {
    const i = this.input;
    const cmd: InputCmd = { seq: this.seq++, mx: i.mx, mz: i.mz, yaw: i.yaw, pitch: i.pitch, run: i.run, crouch: i.crouch, use: i.use };
    this.net.send({ t: 'in', seq: cmd.seq, mx: cmd.mx, mz: cmd.mz, yaw: cmd.yaw, pitch: cmd.pitch, run: cmd.run, crouch: cmd.crouch, use: cmd.use });
    this.pending.push(cmd); if (this.pending.length > 120) this.pending.shift();
    this.applyLocal(cmd);
  }

  private handleActions() {
    for (const a of this.input.actions()) {
      const me = this.snap?.me;
      switch (a) {
        case 'menu': if (this.paused && performance.now() - this.lockLostAt < 300) break; /* same Esc press that released the pointer lock */ this.setPaused(!this.paused); break;
        case 'chat': if (this.role === 'S') $('chatpanel').classList.toggle('hidden'); break;
        case 'spectate': if (this.isSpectating()) this.cycleSpectate(); break;
        case 'transform': if (me && this.role === 'S') { this.net.send({ t: 'act', a: me.d >= 0 ? 'untransform' : 'transform' }); } break;
        case 'attack': if (this.role === 'K') { this.net.send({ t: 'act', a: 'attack' }); this.slashT = this.t; } break;
        case 'ab0': case 'ab1': case 'ab2': if (this.role === 'K') this.net.send({ t: 'act', a, d: 40 }); break;
      }
    }
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.t += dt;
    this.fpsEma = lerp(this.fpsEma, 1 / Math.max(0.001, dt), 0.05);
    this.autoQuality(dt);
    if (!this.paused) this.handleActions(); else this.input.actions();
    if (this.snap && this.playing && !this.paused && !this.isSpectating() && !(this.role === 'S' && this.snap.me.s !== 'alive')) {
      this.tickAcc += dt; let n = 0;
      while (this.tickAcc >= DT && n < 5) { this.tickAcc -= DT; this.sendInput(); n++; }
      if (this.tickAcc > DT * 5) this.tickAcc = 0;
    } else this.tickAcc = 0;
    const k = Math.exp(-dt * 11); this.ox *= k; this.oz *= k;
    this.updateEnts(now, dt);
    if (this.snap) this.render(dt, now);
    this.updateFrameHud(dt);
  }

  private autoQuality(dt: number) {
    if (this.userQual !== 'auto') return;
    this.qualCheck += dt;
    if (this.qualCheck < 2.5) return;
    this.qualCheck = 0;
    const order: Quality['name'][] = ['low', 'medium', 'high'];
    const idx = order.indexOf(this.qName);
    const cap = this.input.touch ? 1 : 2; // phones never auto-climb to "high" (heat / battery)
    if (this.fpsEma < 40 && idx > 0) { this.qName = order[idx - 1]; this.r.setQuality(QUALITY[this.qName]); this.goodTime = 0; }
    else if (this.fpsEma > 57) { this.goodTime += 2.5; if (this.goodTime > 15 && idx < cap) { this.qName = order[idx + 1]; this.r.setQuality(QUALITY[this.qName]); this.goodTime = 0; } }
    else this.goodTime = 0;
  }

  private updateEnts(now: number, dt: number) {
    const rt = now - 105;
    for (const [id, e] of this.ents) {
      if (now - e.lastSeen > STALE_MS) { continue; }
      const b = e.buf; let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t > rt) { a = b[i]; c = b[i + 1]; break; }
      if (rt >= b[b.length - 1].t) { a = c = b[b.length - 1]; }
      else if (rt < b[0].t) { a = c = b[0]; }
      const f = a === c ? 0 : (rt - a.t) / Math.max(1, c.t - a.t);
      e.x = lerp(a.p.x, c.p.x, f); e.z = lerp(a.p.z, c.p.z, f); e.yaw = lerpAngle(a.p.y, c.p.y, f); e.cur = c.p;
      const vx = (e.x - e.lx) / Math.max(dt, 0.001), vz = (e.z - e.lz) / Math.max(dt, 0.001);
      const sp = Math.hypot(vx, vz);
      e.speed = lerp(e.speed, Math.min(sp, 12), 0.25);
      if (sp > 0.4) { e.face = lerpAngle(e.face, Math.atan2(vx, vz), Math.min(1, dt * 9)); e.propYaw = e.face; }
      e.phase += e.speed * dt * 2.3;
      e.lx = e.x; e.lz = e.z;
      void id;
    }
    // own avatar animation
    const vx = (this.px + this.ox - this.lastPx) / Math.max(dt, 0.001), vz = (this.pz + this.oz - this.lastPz) / Math.max(dt, 0.001);
    const sp = Math.hypot(vx, vz);
    this.moveSpeedEst = lerp(this.moveSpeedEst, Math.min(sp, 12), 0.25);
    if (sp > 0.4) this.bodyYaw = lerpAngle(this.bodyYaw, Math.atan2(vx, vz), Math.min(1, dt * 9)); else this.bodyYaw = lerpAngle(this.bodyYaw, this.bodyYaw, 0);
    this.phase += this.moveSpeedEst * dt * 2.3;
    this.lastPx = this.px + this.ox; this.lastPz = this.pz + this.oz;
  }

  // ------------------------------------------------------------------ camera
  private camera(): { ex: number; ey: number; ez: number; tx: number; ty: number; tz: number; fov: number; lx: number; lz: number; fy: number } {
    const i = this.input; const yaw = i.yaw, pitch = i.pitch;
    const fx = Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
    const me = this.snap!.me;
    const pos = { x: this.px + this.ox, z: this.pz + this.oz };
    if (this.role === 'K') {
      const ey = 1.78;
      return { ex: pos.x, ey, ez: pos.z, tx: pos.x + fx, ty: ey + fy, tz: pos.z + fz, fov: (i.prefs.fov + 4) * Math.PI / 180, lx: pos.x, lz: pos.z, fy: yaw };
    }
    let target = pos; let height = me.d >= 0 ? 0.9 : 1.35;
    if (this.isSpectating()) {
      const t = this.spectateTargets(); const id = t.length ? t[this.specIdx % t.length] : -1;
      const e = this.ents.get(id);
      if (e) target = { x: e.x, z: e.z }; else if (this.snap!.p.length) { const q = this.snap!.p[0]; target = { x: q.x, z: q.z }; }
    }
    const dist = me.d >= 0 ? 2.6 : 3.1;
    const rx = -Math.cos(yaw) * 0.45, rz = Math.sin(yaw) * 0.45; // over-the-shoulder
    const tx = target.x + rx * 0.5, tz = target.z + rz * 0.5, ty = height;
    let ex = tx - fx * dist + rx * 0.4, ez = tz - fz * dist + rz * 0.4, ey = ty - fy * dist + 0.25;
    // camera collision: pull in until the line to the head is free of walls
    let k = 1;
    for (let n = 0; n < 12 && !losClear(this.map, tx, tz, tx + (ex - tx) * k, tz + (ez - tz) * k); n++) k -= 0.09;
    k = Math.max(0.12, k - 0.06);
    ex = tx + (ex - tx) * k; ez = tz + (ez - tz) * k; ey = ty + (ey - ty) * k;
    ey = Math.max(0.35, Math.min(WALL_H - 0.2, ey));
    return { ex, ey, ez, tx: tx + fx * 4, ty: ty + fy * 4 + 0.1, tz: tz + fz * 4, fov: i.prefs.fov * Math.PI / 180, lx: ex, lz: ez, fy: yaw };
  }

  // ------------------------------------------------------------------ render
  private render(dt: number, now: number) {
    const r = this.r, d = this.d, s = this.snap!, map = this.map, t = this.t;
    const cam = this.camera();
    const me = s.me;
    r.dark = 1;
    const th = map.theme;
    r.fogD = th.fogDensity * (me.dark ? 1.8 : 1); r.amb = th.ambient * (me.dark ? 0.55 : 1);
    this.dimZones = s.fx.zones.filter((z) => z.k === 'blackout').map((z) => ({ x: z.x, z: z.z, r: z.r }));
    const lights: Light[] = [];
    // flashlight (spot) from the camera; killers get a dim ambient glow instead
    if (this.role === 'S') lights.push({ x: cam.ex, y: cam.ey - 0.05, z: cam.ez, r: 16, c: [1, 0.96, 0.85], i: me.d >= 0 ? 0.5 : 1.25, dx: Math.sin(this.input.yaw) * Math.cos(this.input.pitch), dy: Math.sin(this.input.pitch), dz: Math.cos(this.input.yaw) * Math.cos(this.input.pitch), cut: 0.84 });
    else lights.push({ x: cam.ex, y: cam.ey, z: cam.ez, r: 9, c: [0.7, 0.75, 1], i: 0.45 });
    pickLights(this.world, cam.ex, cam.ez, t, 7, this.dimZones, lights);
    r.setLights(lights);
    r.begin(cam.ex, cam.ey, cam.ez, cam.tx, cam.ty, cam.tz, cam.fov, t);
    this.sfx.setListener(cam.ex, cam.ey, cam.ez, this.input.yaw);
    r.drawChunks(this.world.opaque, r.q.draw);
    const maxD = r.q.draw;

    // lamp fixtures (visible light sources; flicker follows the light)
    for (const l of this.world.lamps) {
      if (Math.hypot(l.x - cam.ex, l.z - cam.ez) > maxD * 0.8) continue;
      const f = l.flicker ? (Math.sin(t * 17 + l.seed * 9) > 0.7 ? 0.2 : 1) : 1;
      d.reset(); const m = d.root(l.x, l.y + 0.25, l.z, 0);
      d.shp('b', m, 0, 0, 0, 0.7, 0.06, 0.25, l.color, undefined, { emis: l.i * f * 1.2, unlit: true });
    }
    // objectives
    map.gens.forEach((g, i) => { const gs = s.g[i]; if (Math.hypot(g.x - cam.ex, g.z - cam.ez) < maxD) drawGenerator(d, g.x, g.z, i * 1.3, gs.p, gs.act === 1, gs.done === 1, gs.dist, t); });
    map.seals.forEach((sp, i) => { if (Math.hypot(sp.x - cam.ex, sp.z - cam.ez) < maxD) drawSeal(d, sp.x, sp.z, s.seals[i].occ >= 0, s.seals[i].prog, t); });
    drawGate(d, map.gate.x, map.gate.z, this.gateSpanZ, s.gate, s.gp, t);
    for (const sg of s.fx.sigils) drawSigil(d, sg.x, sg.z, t);
    for (const z of s.fx.zones) drawZone(d, z.k, z.x, z.z, z.r, t, z.left);
    // sealed survivors appear inside their seal as light-encased figures
    // players
    d.reset();
    const mePos = { x: this.px + this.ox, z: this.pz + this.oz };
    if (this.role === 'S' && me.s !== 'eliminated' && me.s !== 'escaped') this.drawAvatar(this.me, mePos.x, mePos.z, this.bodyYaw, this.moveSpeedEst, this.moveSpeedEst > 0.4 ? 1 : 0, me, true, t, this.phase);
    for (const e of this.ents.values()) {
      if (now - e.lastSeen > STALE_MS) continue;
      if (Math.hypot(e.x - cam.ex, e.z - cam.ez) > maxD + 6) continue;
      const p = e.cur;
      this.drawAvatar(e.id, e.x, e.z, p.s === 'K' ? e.yaw : e.face, e.speed, p.m, p, false, t, e.phase, e);
    }
    // afterimages (Chronos): translucent killer copies that cannot hurt anyone
    for (const dc of s.fx.decoys) drawKiller(d, 'chronos', dc.x, 0, dc.z, dc.y, { t, phase: t * 8, speed: 1, run: true, crouch: false, repair: false, scared: 0, atk: 0, cast: 0, moving: true, alpha: 0.55 });
    this.drawFx(t, cam);
    // killer-only information layers (drawn through walls on purpose: they are the Echo/Chronos/Lumen powers)
    if (this.role === 'K') this.drawKillerInfo(t);
    if (this.role === 'K' && t - this.slashT < 0.3) this.drawSlash(cam, (t - this.slashT) / 0.3);
    if (r.q.decals) r.drawChunks(this.world.decals, 22, true);
    this.updateLabels(cam);
    this.sfx.tick(dt, s.terror, me.dis > 0, cam.ex, cam.ez, this.playing && !this.paused);
  }

  private drawAvatar(id: number, x: number, z: number, yaw: number, speed: number, moving: number, p: { d: number; ds: number; da: number; dp: number; pr: number; s: string; rp: number; c?: number; r?: number; kd?: any; ph?: number; at?: number; cs?: number; st?: number }, isMe: boolean, t: number, phase: number, e?: Ent) {
    const d = this.d; d.reset();
    const stateS = p.s;
    if (p.s === 'K') {
      const kid = this.killerId;
      const mimic = p.kd as { t: string; id?: number; sc?: number; char?: number } | undefined;
      if (mimic && mimic.t === 'prop') {
        const wob = 1 + 0.012 * Math.sin(t * 3.1) + (speed > 0.5 ? 0.022 * Math.sin(t * 17) : 0);
        const tint: Rgb = [1 + 0.05 * Math.sin(t * 7), 1 - 0.04 * Math.sin(t * 5), 1];
        drawProp(d, mimic.id!, x, 0, z, e ? e.propYaw : yaw, (mimic.sc ?? 1) * wob, tint, undefined, true);
        return;
      }
      if (mimic && mimic.t === 'surv') {
        const L = SURVIVOR_LOOKS[mimic.char ?? 0];
        drawSurvivor(d, L, x, 0, z, yaw, { t, phase, speed, run: speed > 4, crouch: false, repair: false, scared: 0, atk: 0, cast: 0, moving: moving === 1, uncanny: 1 });
        return;
      }
      const atk = p.at ?? 0;
      drawKiller(d, kid, x, 0, z, yaw, { t, phase, speed: Math.min(1, speed / 4.5), run: speed > 4, crouch: false, repair: false, scared: 0, atk: atk > 0 && atk < 1 ? atk : atk >= 1 ? 1.01 : 0, cast: p.cs ?? 0, moving: moving === 1 || speed > 0.4, alpha: p.ph ? 0.32 : undefined });
      if (p.ph) d.glow('s', d.root(x, 0, z, 0), 0, 1.2, 0, 1.3, 2.2, 1.3, [0.9, 0.5, 1], 0.12);
      return;
    }
    const L = SURVIVOR_LOOKS[this.chars.get(id) ?? 0];
    const disguised = p.d >= 0;
    const anim = (p.da ?? 0) as number, prog = p.dp ?? 0;
    if (disguised) {
      const type = p.d, sc = p.ds || 1;
      const pyaw = isMe ? this.bodyYaw : (e ? e.propYaw : yaw);
      if (anim === 1) {
        const k = Math.min(1, prog);
        if (k < 1) drawSurvivor(d, L, x, 0, z, pyaw, { t, phase: 0, speed: 0, run: false, crouch: false, repair: false, scared: 0, atk: 0, cast: 0, alpha: Math.max(0.05, 1 - k * 1.2) });
        drawProp(d, type, x, 0, z, pyaw, sc * (0.25 + 0.75 * k), undefined, k < 0.95 ? 0.4 + 0.6 * k : undefined);
        for (let q = 0; q < 8; q++) d.glow('s', d.root(x, 0, z, 0), Math.cos(q + t * 9) * (0.6 - k * 0.3), k * 1.4 + q * 0.07, Math.sin(q * 1.7 + t * 9) * (0.6 - k * 0.3), 0.06, 0.06, 0.06, [0.7, 0.9, 1], 0.9);
      } else drawProp(d, type, x, 0, z, pyaw, sc, p.pr ? [1.1, 1.05, 0.9] : undefined, undefined, isMe ? false : false);
      if (p.pr) d.glow('s', d.root(x, 0, z, 0), 0, 0.5, 0, 1.2, 1.2, 1.2, [1, 0.85, 0.3], 0.12);
      return;
    }
    if (anim === 2) {
      const k = Math.min(1, prog);
      drawSurvivor(d, L, x, 0, z, yaw, { t, phase, speed: 0, run: false, crouch: false, repair: false, scared: 0, atk: 0, cast: 0, alpha: 0.35 + 0.65 * k });
      return;
    }
    const sealed = stateS === 'sealed';
    const marked = isMe && (this.snap!.me.mk ?? 0) > 0;
    const terror = isMe ? this.snap!.terror : 0;
    const a: Anim = { t, phase, speed: Math.min(1, speed / 4.5), run: isMe ? this.input.run && speed > 2 : !!p.r, crouch: isMe ? this.input.crouch : !!p.c, repair: !!p.rp, scared: terror, atk: 0, cast: 0, moving: speed > 0.4, sealed, protectedFx: !!p.pr, stage: p.st };
    drawSurvivor(d, L, x, 0, z, yaw, a);
    if (marked) d.glow('s', d.root(x, 0, z, 0), 0, 0.9, 0, 1.0, 1.9, 1.0, [0.7, 0.4, 1], 0.2);
  }

  private drawFx(t: number, cam: { ex: number; ez: number }) {
    const d = this.d, r = this.r;
    void cam;
    this.fx = this.fx.filter((f) => t - f.t0 < f.dur + 0.05);
    for (const f of this.fx) {
      const k = (t - f.t0) / f.dur; if (k < 0) continue;
      if (f.kind === 'ring') {
        d.reset(); const m = d.root(f.x, f.y, f.z, 0);
        const rad = f.r * (0.15 + 0.85 * k);
        d.glow('c', m, 0, 0, 0, rad * 2, 0.06, rad * 2, f.c, 0.45 * (1 - k));
      }
    }
    void r;
  }

  private drawKillerInfo(t: number) {
    const s = this.snap!, d = this.d;
    for (const p of s.pings ?? []) { d.reset(); const m = d.root(p.x, 1.0, p.z, 0); const k = 0.5 + 0.5 * Math.sin(t * 8); d.glow('s', m, 0, 0, 0, 0.7 + k * 0.3, 0.7 + k * 0.3, 0.7 + k * 0.3, [0.5, 0.9, 1], 0.7, true); }
    for (const tr of s.trace ?? []) for (let i = 0; i < tr.pts.length; i++) { d.reset(); const m = d.root(tr.pts[i].x, 0.15, tr.pts[i].z, 0); d.glow('s', m, 0, 0, 0, 0.22, 0.22, 0.22, [1, 0.85, 0.4], 0.9 * (i / tr.pts.length + 0.15), true); }
    for (const mk of s.marks ?? []) { d.reset(); const m = d.root(mk.x, 0.12, mk.z, 0); d.glow('c', m, 0, 0, 0, 0.6, 0.05, 0.6, [0.75, 0.4, 1], Math.min(1, mk.l / 1.5) * 0.8, true); }
  }
  private drawSlash(cam: { ex: number; ez: number; ey: number }, k: number) {
    const d = this.d; const yaw = this.input.yaw;
    d.reset();
    for (let i = 0; i < 7; i++) {
      const a = yaw + 0.9 - (i / 6) * 1.8 * Math.min(1, k * 1.6);
      const m = d.root(cam.ex + Math.sin(a) * 1.3, cam.ey - 0.35 + (i % 2) * 0.1, cam.ez + Math.cos(a) * 1.3, a);
      d.glow('b', m, 0, 0, 0, 0.05, 0.5, 0.5, [1, 0.35, 0.3], 0.8 * (1 - k));
    }
  }

  // ------------------------------------------------------------------ labels
  private label(i: number): HTMLElement { let el = this.labelPool[i]; if (!el) { el = document.createElement('div'); el.className = 'tag'; $('labels').appendChild(el); this.labelPool[i] = el; } return el; }
  private updateLabels(cam: { ex: number; ey: number; ez: number }) {
    let n = 0;
    const put = (x: number, y: number, z: number, text: string, cls: string, color?: string) => {
      const pr = this.r.project(x, y, z); if (pr.w <= 0.1 || pr.x < -0.1 || pr.x > 1.1 || pr.y < -0.1 || pr.y > 1.1) return;
      const el = this.label(n++); el.className = 'tag ' + cls; el.textContent = text; el.style.left = pr.x * 100 + '%'; el.style.top = pr.y * 100 + '%'; el.style.display = 'block'; if (color) el.style.color = color;
    };
    const L = (i: number) => SURVIVOR_LOOKS[this.chars.get(i) ?? 0];
    if (this.role === 'S') {
      for (const e of this.ents.values()) {
        const p = e.cur; if (performance.now() - e.lastSeen > STALE_MS) continue;
        const known = p.s !== 'K' || (p.kd && (p.kd as any).t === 'surv');
        if (p.s === 'K' && !(p.kd && (p.kd as any).t === 'surv')) continue;
        if (p.d >= 0) continue;
        if (p.s === 'eliminated' || p.s === 'escaped') continue;
        const nm = p.s === 'K' ? L((p.kd as any).char).name : (this.names.get(e.id) ?? '?'); // a fake survivor shows a DUPLICATE character name
        if (known) put(e.x, 2.05 * L(e.id).height, e.z, nm, '');
        const b = this.bubbles.get(e.id); if (b && b.until > this.t) put(e.x, 2.45, e.z, b.s, 'bubble');
      }
      const b = this.bubbles.get(this.me); if (b && b.until > this.t) put(this.px + this.ox, 2.45, this.pz + this.oz, b.s, 'bubble');
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
    void cam;
  }

  // ------------------------------------------------------------------ HUD
  private setupHud() {
    const g = $('h-gens'); g.innerHTML = '';
    for (let i = 0; i < RULES.genCount; i++) { const el = document.createElement('div'); el.className = 'gen'; el.innerHTML = '<i></i>'; g.appendChild(el); }
    const ab = $('hud-abil'); ab.innerHTML = '';
    if (this.role === 'K') {
      const keys = ['Q', 'E', 'R'];
      KILLERS[this.killerId].abilities.forEach((a, i) => { const el = document.createElement('div'); el.className = 'abil'; el.id = 'abil' + i; el.innerHTML = `<b>${keys[i]}</b>${a.name.replace(' ', '<br>')}<div class="cd"></div><span class="t"></span>`; ab.appendChild(el); });
      document.querySelectorAll<HTMLElement>('#touch .k-only[data-act^="ab"] span').forEach((el, i) => { el.textContent = KILLERS[this.killerId].abilities[i].name.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join('\n'); (el as HTMLElement).style.fontSize = '10px'; });
    }
    const cp = $('chatpanel'); cp.innerHTML = '';
    CHAT_PRESETS.forEach((txt, i) => { const b = document.createElement('button'); b.textContent = txt; b.onclick = () => { this.net.send({ t: 'chat', id: i }); cp.classList.add('hidden'); }; cp.appendChild(b); });
    $('h-time').textContent = fmtTime(this.matchSeconds);
    const tl = $('b-tf-l'); if (tl) tl.textContent = '変身';
  }

  private feed(text: string) {
    const f = $('hud-feed'); const el = document.createElement('div'); el.className = 'feed'; el.textContent = text; f.appendChild(el);
    while (f.children.length > 5) f.removeChild(f.firstChild!);
    setTimeout(() => el.remove(), 6200);
  }
  private banner(text: string, danger = false) {
    const b = $('hud-banner'); b.textContent = text; b.style.color = danger ? '#ff8a7a' : '#fff'; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  private nearestProp(): number {
    const me = this.snap!.me; const x = this.px, z = this.pz, yaw = this.input.yaw;
    let best = -1, bs = 1e9; const m = this.map;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), reach = Math.ceil(RULES.transformRange / CELL) + 1;
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
      const gx = cx + i, gz = cz + j; if (gx < 0 || gz < 0 || gx >= m.w || gz >= m.h) continue;
      for (const idx of m.propCells[gz * m.w + gx]) {
        const pr = m.props[idx]; const dx = pr.x - x, dz = pr.z - z, dd = Math.hypot(dx, dz);
        if (dd > RULES.transformRange) continue;
        let da = 0;
        if (dd > 1.0) { da = Math.acos(Math.max(-1, Math.min(1, (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dd))); if (da > RULES.transformArcRad) continue; }
        if (!losClear(m, x, z, pr.x, pr.z)) continue;
        const sc = dd + da * 1.2; if (sc < bs) { bs = sc; best = pr.type; }
      }
    }
    void me;
    return best;
  }

  private updateHudSnap() {
    const s = this.snap!, me = s.me;
    const left = s.left; const tEl = $('h-time'); tEl.textContent = fmtTime(left); tEl.classList.toggle('low', left < 60);
    const gens = $('h-gens').children;
    let done = 0;
    s.g.forEach((g, i) => { const el = gens[i] as HTMLElement; if (!el) return; el.classList.toggle('done', g.done === 1); el.classList.toggle('act', g.act === 1 && g.done === 0); el.classList.toggle('bad', g.dist > 0); (el.firstChild as HTMLElement).style.width = Math.round(g.p * 100) + '%'; if (g.done) done++; });
    this.gensDone = done;
    // objective
    let obj = '';
    if (this.role === 'K') { const alive = s.team.filter((t) => t.s === 'alive').length, sealed = s.team.filter((t) => t.s === 'sealed').length; obj = `生存者を探せ — 行動可能 ${alive} / 封印中 ${sealed} / 修理 ${done}/${RULES.genRequired}`; }
    else if (me.s === 'sealed') obj = `封印中 — 救助を待て (${Math.ceil(me.seal)}s)`;
    else if (me.s === 'eliminated') obj = '脱落 — 観戦中';
    else if (me.s === 'escaped') obj = '脱出成功！';
    else if (s.gate === 3) obj = '脱出ゲートが開いた！ゲートへ走れ！';
    else if (s.gate >= 1) obj = 'ゲートの電源が入った — 近づいて開けろ';
    else obj = `装置を修理しよう (${done}/${RULES.genRequired})`;
    $('h-obj').textContent = obj;
    // team
    const team = $('hud-team'); let html = '';
    for (const t of s.team) {
      const pips = [0, 1].map((i) => `<b class="${t.st > i + 1 || (t.s !== 'alive' && t.st - 1 > i) ? 'on' : (t.st - 1) > i ? 'on' : ''}"></b>`).join('');
      const label = t.s === 'alive' ? (t.rp ? '作業中' : '') : t.s === 'sealed' ? '封印' : t.s === 'eliminated' ? '脱落' : '脱出';
      html += `<div class="mate ${t.s} ${t.i === this.me ? 'me' : ''}"><span>${(this.names.get(t.i) ?? '?').replace(/[<>&]/g, '')}</span><span class="pips">${pips}</span><span class="st">${label}</span></div>`;
    }
    if (team.dataset.h !== html) { team.innerHTML = html; team.dataset.h = html; }
    // stamina / state
    const stam = $('h-stam'); (stam.firstChild as HTMLElement).style.width = me.stam + '%'; stam.classList.toggle('low', me.cr === 0);
    $('h-state').textContent = this.role === 'K' ? KILLERS[this.killerId].name : me.s === 'alive' ? (me.d >= 0 ? `変身中: ${PROPS[me.d]?.jp ?? ''}` : me.cr === 0 ? '疲労' : me.dis > 0 ? '感覚が乱れている' : me.slow ? '時間が遅い' : '') : '';
    $('h-ping').textContent = `${this.net.rtt}ms  ${Math.round(this.fpsEma)}fps  ${this.qName}`;
    // killer HUD
    if (this.role === 'K' && me.cd) {
      me.cd.forEach((cd, i) => {
        const el = document.getElementById('abil' + i); if (!el) return; const tot = this.cdTotal[i];
        (el.querySelector('.cd') as HTMLElement).style.height = Math.min(100, (cd / tot) * 100) + '%'; (el.querySelector('.t') as HTMLElement).textContent = cd > 0.05 ? String(Math.ceil(cd)) : ''; el.classList.toggle('ready', cd <= 0.05);
        const tb = document.querySelector<HTMLElement>(`#b-ab${i} em`); if (tb) tb.textContent = cd > 0.05 ? String(Math.ceil(cd)) : '';
        document.getElementById('b-ab' + i)?.classList.toggle('off', cd > 0.05);
      });
      const sn = $('hud-sense'); const near = (me.sense ?? -1) >= 0;
      sn.style.display = near ? 'block' : 'none'; if (near) (sn.firstChild as HTMLElement).style.width = Math.round(120 * (1 - (me.sense as number) / RULES.senseRadius) + 20) + 'px';
    }
    // fx overlays
    $('fx-dark').style.opacity = me.dark ? '1' : '0'; $('fx-time').style.opacity = me.slow ? '1' : '0'; $('fx-mark').style.opacity = (me.mk ?? 0) > 0 ? '1' : '0';
    document.body.classList.toggle('distort', me.dis > 0);
    $('hud-spec').classList.toggle('hidden', !this.isSpectating());
    document.getElementById('b-chat')?.classList.toggle('off', me.s !== 'alive');
    this.lastTerror = s.terror;
  }

  private updateFrameHud(dt: number) {
    void dt;
    const s = this.snap; if (!s) return;
    const me = s.me;
    // contextual prompt + mobile button states
    let prompt = '';
    let useReady = false, tfLabel = '変身', tfOk = false;
    if (this.role === 'S' && me.s === 'alive') {
      const px = this.px, pz = this.pz;
      const sealIdx = this.map.seals.findIndex((sp, i) => s.seals[i].occ >= 0 && Math.hypot(sp.x - px, sp.z - pz) <= RULES.rescueRange + 0.6);
      const gateNear = (s.gate === 1 || s.gate === 2) && Math.hypot(this.map.gate.x - px, this.map.gate.z - pz) <= RULES.gateRange + 0.5;
      const genIdx = this.map.gens.findIndex((g, i) => !s.g[i].done && Math.hypot(g.x - px, g.z - pz) <= RULES.genRange + 0.5);
      const key = this.input.touch ? '「調べる」' : '[E]';
      if (me.d >= 0) { prompt = this.input.touch ? '「解除」で元の姿に戻る' : '[F] 変身解除'; tfLabel = '解除'; tfOk = me.tfcd <= 0; }
      else if (sealIdx >= 0) { prompt = `${key} 長押し: 救助 ${Math.round(s.seals[sealIdx].prog * 100)}%`; useReady = true; }
      else if (gateNear) { prompt = `${key} 長押し: ゲートを開く ${Math.round(s.gp * 100)}%`; useReady = true; }
      else if (genIdx >= 0) { prompt = `${key} 長押し: 修理 ${Math.round(s.g[genIdx].p * 100)}%${s.g[genIdx].dist > 0 ? '（妨害中）' : ''}`; useReady = true; }
      else {
        const pt = this.nearestProp();
        if (pt >= 0) { prompt = me.tfcd > 0 ? `変身できるまで ${me.tfcd.toFixed(1)}s` : `${this.input.touch ? '「変身」' : '[F]'} ${PROPS[pt].jp} に変身`; tfOk = me.tfcd <= 0; }
      }
      if (me.d >= 0) useReady = false;
    }
    const pe = $('h-prompt'); if (pe.textContent !== prompt) pe.textContent = prompt; pe.classList.toggle('on', !!prompt);
    document.getElementById('b-use')?.classList.toggle('ready', useReady);
    const tf = document.getElementById('b-tf'); tf?.classList.toggle('ready', tfOk); tf?.classList.toggle('off', !tfOk && me.d < 0);
    const tl = document.getElementById('b-tf-l'); if (tl && tl.textContent !== tfLabel) tl.textContent = tfLabel;
    // hit / capture flash + terror pulse
    const hit = Math.max(0, 1 - (this.t - this.hitT) / 0.6), cap = Math.max(0, 1 - (this.t - this.capT) / 1.2);
    const pulse = s.terror > 0.55 ? (0.15 + 0.2 * Math.max(0, Math.sin(this.t * (4 + 6 * s.terror)))) * s.terror : 0;
    $('fx-hit').style.opacity = String(Math.min(1, Math.max(hit, cap * 0.8, pulse)));
    $('lockhint').classList.toggle('hidden', this.input.touch || this.input.locked || this.paused);
  }
}
