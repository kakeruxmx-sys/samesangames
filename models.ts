// Procedural 3D models (built from primitives at draw time): 8 survivors, 5 killers, props, generators, seals, gate.
// NOTE: these are original low-poly procedural models, not production DCC/glTF art (see README "Known limits").
import { SurvivorLook } from '../../shared/constants';
import { KillerId } from '../../shared/killers';
import { PROPS } from '../../shared/props';
import { hex, M4, m4, mul, MATS, Mat, Renderer, Rgb, trs } from './gl';
import type { Shape } from '../../shared/props';

export class Draw {
  pool: M4[] = Array.from({ length: 6000 }, () => m4());
  pi = 0;
  constructor(public r: Renderer) {}
  reset() { this.pi = 0; }
  private m(): M4 { return this.pool[this.pi++ % this.pool.length]; }
  /** child frame: parent * T(tx,ty,tz) * R */
  node(p: M4, tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0): M4 {
    const t = trs(this.m(), tx, ty, tz, rx, ry, rz); const o = this.m(); return mul(o, p, t);
  }
  root(x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1): M4 { return trs(this.m(), x, y, z, 0, yaw, 0, sx, sy, sz); }
  shp(s: Shape, p: M4, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, c: Rgb, mat: Mat = MATS.plastic, o: { emis?: number; alpha?: number; unlit?: boolean; low?: boolean } = {}, rx = 0, ry = 0, rz = 0) {
    const t = trs(this.m(), ox, oy, oz, rx, ry, rz, sx, sy, sz); const m = mul(this.m(), p, t);
    this.r.prim(s, m, c, { mat, ...o });
  }
  glow(s: Shape, p: M4, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, c: Rgb, a: number, noDepth = false) {
    const t = trs(this.m(), ox, oy, oz, 0, 0, 0, sx, sy, sz); const m = mul(this.m(), p, t);
    this.r.glow(s, m, c, a, noDepth);
  }
}

const cache = new Map<string, Rgb>();
const col = (h: string): Rgb => { let c = cache.get(h); if (!c) { c = hex(h); cache.set(h, c); } return c; };
const SK: Mat = { k: 0, shine: 14, spec: 0.12 };
const HAIR: Mat = { k: 0, shine: 28, spec: 0.22 };
const CLOTH = MATS.cloth;

export interface Anim {
  t: number; phase: number; speed: number; run: boolean; crouch: boolean; repair: boolean; scared: number; atk: number; cast: number;
  alpha?: number; sealed?: boolean; protectedFx?: boolean; stage?: number; moving?: boolean; uncanny?: number; ph?: boolean; tint?: Rgb;
}

// ------------------------------------------------------------------ survivor
export function drawSurvivor(d: Draw, L: SurvivorLook, x: number, y: number, z: number, yaw: number, a: Anim, scale = 1) {
  d.reset();
  const root = d.root(x, y, z, yaw, L.width * scale, L.height * scale, L.width * scale);
  const skin = col(L.skin), hair = col(L.hair), shirt = col(L.shirt), pants = col(L.pants), shoes = col(L.shoes);
  const al = a.alpha ?? 1;
  const o = { alpha: al < 1 ? al : undefined };
  const sw = Math.sin(a.phase), sw2 = Math.sin(a.phase + Math.PI);
  const amp = a.crouch ? 0.28 : a.run ? 0.95 : 0.55;
  const sp = a.moving ? Math.min(1, a.speed) : 0;
  const crouchDrop = a.crouch ? 0.34 : 0;
  const breath = Math.sin(a.t * 1.6) * 0.012;
  const hipY = 0.92 - crouchDrop;
  const lean = a.run ? 0.26 : a.crouch ? 0.28 : 0.05 + (a.scared > 0.5 ? 0.08 : 0);
  const body = d.node(root, 0, hipY, 0, lean, 0, 0);

  // legs
  for (const side of [-1, 1]) {
    const swing = (side === -1 ? sw : sw2) * amp * sp;
    const thRx = a.crouch ? -0.95 + swing * 0.3 : -swing;
    const knee = a.crouch ? 1.7 : Math.max(0, (side === -1 ? -sw2 : -sw) * 0.9 * sp * (a.run ? 1.4 : 0.8));
    const hip = d.node(root, side * 0.1, hipY, 0, thRx, 0, side * (a.crouch ? 0.05 : 0.02));
    d.shp('c', hip, 0, -0.225, 0, 0.16, 0.46, 0.16, pants, CLOTH, o);
    const kn = d.node(hip, 0, -0.45, 0, knee);
    d.shp('c', kn, 0, -0.21, 0, 0.125, 0.43, 0.125, pants, CLOTH, o);
    d.shp('b', kn, 0, -0.44, 0.05, 0.105, 0.075, 0.24, shoes, MATS.plastic, o);
  }
  // pelvis + torso
  d.shp('b', body, 0, 0.0, 0, 0.35, 0.17, 0.2, pants, CLOTH, o);
  d.shp('b', body, 0, 0.33, 0, 0.38, 0.5, 0.21, shirt, CLOTH, o);
  d.shp('b', body, 0, 0.56 + breath, 0, 0.41, 0.2, 0.22, shirt, CLOTH, o);
  if (L.accessory === 'backpack') { d.shp('b', body, 0, 0.42, -0.17, 0.3, 0.38, 0.14, col('#3a3f2a'), CLOTH, o); d.shp('b', body, 0, 0.3, -0.25, 0.22, 0.14, 0.06, col('#2a2d20'), CLOTH, o); }
  if (L.accessory === 'scarf') { d.shp('c', body, 0, 0.68, 0, 0.17, 0.09, 0.17, col('#c9b25a'), CLOTH, o); d.shp('b', body, 0.07, 0.52, 0.12, 0.06, 0.3, 0.02, col('#c9b25a'), CLOTH, o); }
  // arms
  for (const side of [-1, 1]) {
    const swing = (side === -1 ? sw2 : sw) * amp * 0.9 * sp;
    let sRx = swing, eRx = -0.25 - Math.max(0, swing) * 0.4;
    if (a.run) eRx = -1.0;
    if (a.repair) { sRx = -1.05 + Math.sin(a.t * 9 + side) * 0.12; eRx = -0.7; }
    if (a.scared > 0.6 && !a.moving) { sRx = -1.2; eRx = -1.5; }
    if (a.sealed) { sRx = 0.1; eRx = -0.1; }
    const sh = d.node(body, side * 0.25, 0.58, 0, -sRx, 0, side * 0.06);
    d.shp('c', sh, 0, -0.14, 0, 0.095, 0.3, 0.095, shirt, CLOTH, o);
    const el = d.node(sh, 0, -0.28, 0, eRx);
    d.shp('c', el, 0, -0.13, 0, 0.075, 0.27, 0.075, skin, SK, o);
    // hand: palm + 4 fingers + thumb
    d.shp('b', el, 0, -0.29, 0, 0.075, 0.07, 0.035, skin, SK, o);
    d.shp('b', el, 0, -0.35, 0, 0.07, 0.06, 0.03, skin, SK, o);
    d.shp('b', el, side * -0.045, -0.3, 0.012, 0.025, 0.045, 0.025, skin, SK, o, 0, 0, side * 0.5);
  }
  // neck + head
  d.shp('c', body, 0, 0.7, 0, 0.1, 0.1, 0.1, skin, SK, o);
  const head = d.node(body, 0, 0.82, 0, a.repair ? 0.28 : -0.04 * sp, Math.sin(a.t * 0.7) * 0.08 * (a.moving ? 0 : 1), 0);
  d.shp('s', head, 0, 0, 0, 0.2 * L.faceW, 0.26, 0.23, skin, SK, o);
  d.shp('s', head, 0, -0.07, 0.03, 0.15 * L.faceW, 0.12, 0.15, skin, SK, o); // jaw
  for (const side of [-1, 1]) d.shp('s', head, side * 0.105 * L.faceW, -0.005, 0, 0.035, 0.07, 0.035, skin, SK, o); // ears
  d.shp('c', head, 0, -0.02, 0.118, 0.04, 0.05, 0.05, skin, SK, o, 0.35); // nose
  const eyeS = 1 + a.scared * 0.35 + (a.uncanny ?? 0) * 0.5;
  for (const side of [-1, 1]) {
    const ex = side * 0.045 * L.eyeSpacing * L.faceW;
    d.shp('s', head, ex, 0.03, 0.09, 0.05 * eyeS, 0.04 * eyeS, 0.03, [0.95, 0.95, 0.93], SK, o);
    d.shp('s', head, ex, 0.03, 0.108, 0.026, 0.026, 0.012, col(L.eyeColor), MATS.glass, o);
    d.shp('b', head, ex, 0.075 + a.scared * 0.01, 0.098, 0.06, 0.012, 0.014, hair, HAIR, o, 0, 0, side * (a.scared * 0.35 - 0.05));
  }
  const mouthOpen = 0.012 + a.scared * 0.045 + (a.run ? 0.02 : 0);
  d.shp('b', head, 0, -0.075, 0.108, 0.06, mouthOpen, 0.01, col('#5a1f22'), SK, o);
  // hair
  const hs = L.hairStyle;
  if (hs !== 'bald') {
    const cap = (w: number, h: number, dd: number, yy: number, zz: number) => d.shp('s', head, 0, yy, zz, w, h, dd, hair, HAIR, o);
    if (hs === 'short') { cap(0.225 * L.faceW, 0.2, 0.25, 0.055, -0.012); }
    if (hs === 'long') { cap(0.235 * L.faceW, 0.22, 0.26, 0.045, -0.015); d.shp('b', head, 0, -0.14, -0.1, 0.22 * L.faceW, 0.4, 0.06, hair, HAIR, o); }
    if (hs === 'bun') { cap(0.225 * L.faceW, 0.2, 0.25, 0.055, -0.012); d.shp('s', head, 0, 0.17, -0.04, 0.11, 0.11, 0.11, hair, HAIR, o); }
    if (hs === 'cap') { cap(0.23 * L.faceW, 0.16, 0.25, 0.08, -0.01); d.shp('b', head, 0, 0.06, 0.15, 0.2, 0.012, 0.14, col('#2d2d2d'), CLOTH, o); }
    if (hs === 'curly') { for (let i = 0; i < 9; i++) { const aa = (i / 9) * 6.28; d.shp('s', head, Math.cos(aa) * 0.085 * L.faceW, 0.1 + Math.sin(i * 2.3) * 0.02, Math.sin(aa) * 0.09 - 0.01, 0.09, 0.09, 0.09, hair, HAIR, o); } d.shp('s', head, 0, 0.13, 0, 0.16, 0.08, 0.16, hair, HAIR, o); }
    if (hs === 'ponytail') { cap(0.225 * L.faceW, 0.2, 0.25, 0.055, -0.012); d.shp('c', head, 0, -0.07, -0.16, 0.06, 0.3, 0.06, hair, HAIR, o, 0.4); }
    if (hs === 'beanie') { cap(0.24 * L.faceW, 0.2, 0.26, 0.07, -0.005); d.shp('s', head, 0, 0.18, 0, 0.07, 0.07, 0.07, col('#d97a9a'), CLOTH, o); }
  }
  if (L.accessory === 'glasses') { for (const side of [-1, 1]) d.shp('c', head, side * 0.05 * L.faceW, 0.03, 0.125, 0.07, 0.01, 0.07, col('#222'), MATS.metal, o, Math.PI / 2); d.shp('b', head, 0, 0.035, 0.128, 0.05, 0.01, 0.01, col('#222'), MATS.metal, o); }
  if (L.accessory === 'headband') d.shp('c', head, 0, 0.07, 0, 0.235 * L.faceW, 0.03, 0.26, col('#f0f0f0'), CLOTH, o);

  if (a.protectedFx) d.glow('s', root, 0, 0.9, 0, 1.2, 2.0, 1.2, [1, 0.85, 0.35], 0.18 + 0.08 * Math.sin(a.t * 6));
  if (a.sealed) d.glow('c', root, 0, 0.9, 0, 1.0, 2.0, 1.0, [0.6, 0.5, 1], 0.35);
}

// ------------------------------------------------------------------ killers
export function drawKiller(d: Draw, id: KillerId, x: number, y: number, z: number, yaw: number, a: Anim) {
  d.reset();
  const al = a.alpha ?? 1;
  const o = { alpha: al < 1 ? al : undefined };
  const sp = a.moving ? Math.min(1, a.speed) : 0;
  const sw = Math.sin(a.phase), sw2 = -sw;
  const atkArm = a.atk > 0 ? (a.atk < 1 ? -2.4 + a.atk * 0.4 : -0.6 + (a.atk - 1) * 0) : 0; // windup: raise, then swing handled by atk>=1 (recover)
  const castUp = a.cast ? -2.2 + Math.sin(a.t * 14) * 0.15 : 0;
  const root = d.root(x, y, z, yaw);
  switch (id) {
    case 'echo': {
      const sway = Math.sin(a.t * 0.9) * 0.06;
      const cloth = col('#2a2a38'), cloth2 = col('#3a3a52'), glowc = col('#7fd0ff');
      const lean = 0.12 * sp + (a.atk > 0 ? 0.3 : 0);
      const body = d.node(root, 0, 0, 0, lean, 0, sway);
      d.shp('k', body, 0, 0.9, 0, 1.0 + 0.1 * Math.sin(a.t * 2), 1.8, 1.0, cloth, CLOTH, o);
      d.shp('k', body, 0, 0.95, 0.03, 0.8, 1.7, 0.8, cloth2, CLOTH, o);
      d.shp('c', body, 0, 2.0, 0, 0.42, 0.7, 0.3, cloth, CLOTH, o);
      d.shp('c', body, 0, 2.38, 0, 0.1, 0.5, 0.1, col('#cfc6b8'), SK, o);
      const head = d.node(body, 0, 2.62, 0, 0.1 * Math.sin(a.t * 0.5), 0, 0.3 + Math.sin(a.t * 0.7) * 0.1);
      d.shp('s', head, 0, 0, 0, 0.26, 0.42, 0.26, col('#cfc6b8'), SK, o);
      d.shp('k', head, 0, 0.12, -0.02, 0.4, 0.5, 0.4, cloth, CLOTH, o); // hood
      d.shp('s', head, 0, -0.02, 0.07, 0.2, 0.3, 0.12, [0.02, 0.02, 0.03], SK, o); // void face
      for (const s of [-1, 1]) d.shp('s', head, s * 0.045, 0.02, 0.12, 0.02, 0.02, 0.01, glowc, SK, { emis: 1, alpha: o.alpha });
      for (const s of [-1, 1]) {
        const sh = d.node(body, s * 0.28, 2.1, 0, (s === 1 ? (atkArm || castUp) : -sw * 0.25 * sp), 0, s * 0.15);
        d.shp('c', sh, 0, -0.5, 0, 0.07, 1.0, 0.07, col('#cfc6b8'), SK, o);
        d.shp('b', sh, 0, -1.05, 0, 0.08, 0.35, 0.03, col('#cfc6b8'), SK, o);
      }
      for (let i = 0; i < 7; i++) {
        const aa = a.t * (0.8 + i * 0.07) + i * 0.9, r = 0.9 + 0.15 * Math.sin(a.t + i);
        d.glow('s', root, Math.cos(aa) * r, 1.2 + (i % 4) * 0.35 + Math.sin(a.t * 1.3 + i) * 0.12, Math.sin(aa) * r, 0.09, 0.09, 0.09, glowc, 0.8);
      }
      if (a.cast) for (let k = 0; k < 3; k++) { const f = ((a.t * 1.6 + k / 3) % 1); d.glow('c', root, 0, 1.4, 0, 1 + f * 5, 0.04, 1 + f * 5, glowc, 0.5 * (1 - f)); }
      break;
    }
    case 'stitcher': {
      const q = Math.floor(a.t * 8) / 8; // creaky, stepped motion
      const fab = col('#8a6a52'), fab2 = col('#6a4a62'), porcelain = col('#e8e0d4'), dark = col('#1a1210'), thread = col('#7a1f2a');
      const bob = Math.sin(q * 6.0 + a.phase) * 0.03 * (a.moving ? 1 : 0.3);
      const body = d.node(root, 0, 0.95 + bob, 0, 0.1 + 0.15 * sp, Math.sin(q * 1.3) * 0.12, Math.sin(q * 2.1) * 0.06);
      for (const s of [-1, 1]) {
        const sw1 = (s === -1 ? sw : sw2) * 0.6 * sp;
        const hip = d.node(root, s * 0.14, 0.95, 0, -sw1 * 1.0 + 0.1, 0, s * 0.18);
        d.shp('c', hip, 0, -0.25, 0, 0.1, 0.5, 0.1, fab, CLOTH, o);
        const kn = d.node(hip, 0, -0.5, 0, 0.3 + Math.max(0, sw1) * 0.5, 0, 0);
        d.shp('c', kn, 0, -0.25, 0, 0.08, 0.5, 0.08, fab2, CLOTH, o);
        d.shp('b', kn, 0, -0.52, 0.05, 0.12, 0.06, 0.22, dark, CLOTH, o);
      }
      d.shp('b', body, 0, 0.1, 0, 0.42, 0.74, 0.26, fab, CLOTH, o);
      d.shp('b', body, 0.1, 0.18, 0.135, 0.18, 0.3, 0.01, fab2, CLOTH, o);
      for (let i = 0; i < 5; i++) d.shp('b', body, 0.1, 0.06 + i * 0.07, 0.142, 0.2, 0.012, 0.006, dark, CLOTH, o, 0, 0, 0.3);
      const head = d.node(body, 0, 0.7, 0, Math.sin(q * 1.7) * 0.15, Math.sin(q * 0.9) * 0.3, Math.sin(q * 1.1) * 0.35);
      d.shp('s', head, 0, 0.18, 0, 0.5, 0.5, 0.46, porcelain, { k: 0, shine: 60, spec: 0.5 }, o);
      d.shp('c', head, -0.12, 0.24, 0.2, 0.15, 0.03, 0.15, [0.1, 0.8, 0.85], MATS.glass, { emis: 0.6, alpha: o.alpha }, Math.PI / 2 - 0.2);
      d.shp('c', head, 0.13, 0.2, 0.21, 0.1, 0.03, 0.1, [0.9, 0.9, 0.85], MATS.glass, o, Math.PI / 2);
      for (let i = 0; i < 6; i++) d.shp('b', head, -0.09 + i * 0.036, 0.05, 0.225, 0.016, 0.07, 0.01, dark, CLOTH, o, 0, 0, i % 2 ? 0.4 : -0.4);
      d.shp('b', head, 0, 0.05, 0.225, 0.22, 0.012, 0.01, dark, CLOTH, o);
      for (let i = 0; i < 5; i++) d.shp('s', head, (i - 2) * 0.09, 0.42, -0.02, 0.1, 0.1, 0.1, col('#a07a4a'), CLOTH, o);
      for (const s of [-1, 1]) {
        const sh = d.node(body, s * 0.28, 0.4, 0, (s === 1 ? (atkArm || castUp) : -sw * 0.2 * sp - 0.1), 0, s * 0.12);
        d.shp('c', sh, 0, -0.38, 0, 0.07, 0.8, 0.07, fab2, CLOTH, o);
        const el = d.node(sh, 0, -0.76, 0, -0.2 - (a.atk > 0 ? 0.6 : 0));
        d.shp('c', el, 0, -0.4, 0, 0.055, 0.82, 0.055, fab, CLOTH, o);
        for (let f = 0; f < 3; f++) d.shp('b', el, (f - 1) * 0.04, -0.95, 0, 0.012, 0.28, 0.012, [0.7, 0.7, 0.72], MATS.metal, o, 0, 0, (f - 1) * 0.12);
        d.shp('c', el, 0, -0.42 - 0.8, 0.0, 0.012, 0.8, 0.012, thread, MATS.cloth, o);
      }
      for (let i = 0; i < 8; i++) d.glow('s', root, Math.sin(a.t * 0.7 + i) * 0.6, 0.4 + i * 0.25, Math.cos(a.t * 0.7 + i * 1.3) * 0.6, 0.05, 0.05, 0.05, [0.9, 0.4, 1], 0.4);
      break;
    }
    case 'mimic': {
      const skin = col('#b8b3a6'), cloth = col('#1b1b1e');
      const gl = (Math.sin(a.t * 3.3) > 0.97 || Math.sin(a.t * 1.17) > 0.985) ? 1 : 0;
      const body = d.node(root, 0, 0.95, 0, 0.12 * sp, 0.22 + gl * 0.3, 0.03);
      for (const s of [-1, 1]) {
        const swing = (s === -1 ? sw : sw2) * 0.6 * sp;
        const hip = d.node(root, s * 0.1, 0.95, 0, -swing, 0, 0);
        d.shp('c', hip, 0, -0.23, 0, 0.15, 0.48, 0.15, cloth, CLOTH, o);
        const kn = d.node(hip, 0, -0.46, 0, Math.max(0, -swing) * 0.8);
        d.shp('c', kn, 0, -0.22, 0, 0.12, 0.44, 0.12, cloth, CLOTH, o);
        d.shp('b', kn, 0, -0.46, 0.05, 0.1, 0.07, 0.23, [0.05, 0.05, 0.05], CLOTH, o);
      }
      d.shp('b', body, 0, 0.35, 0, 0.4, 0.62, 0.21, cloth, CLOTH, o);
      d.shp('b', body, -0.12, 0.45, 0.1, 0.12, 0.3, 0.02, col('#26262b'), CLOTH, o);
      const head = d.node(body, 0.03, 0.84, 0, 0, 0.12, 0.12 + gl * 0.2);
      d.shp('s', head, 0, 0, 0, 0.22, 0.27, 0.23, skin, SK, o);
      // misplaced facial features
      d.shp('s', head, -0.055, 0.06, 0.092, 0.07, 0.05, 0.03, [0.95, 0.95, 0.9], SK, o);
      d.shp('s', head, -0.055, 0.06, 0.112, 0.03, 0.03, 0.012, [0.02, 0.02, 0.02], MATS.glass, o);
      d.shp('s', head, 0.07, -0.02, 0.095, 0.045, 0.04, 0.03, [0.95, 0.95, 0.9], SK, o);
      d.shp('s', head, 0.07, -0.02, 0.113, 0.02, 0.02, 0.012, [0.02, 0.02, 0.02], MATS.glass, o);
      d.shp('b', head, 0.02, -0.09, 0.108, 0.012, 0.09, 0.01, col('#3a1515'), SK, o);
      d.shp('c', head, -0.01, 0.0, 0.118, 0.03, 0.05, 0.04, skin, SK, o, 0.2);
      for (const s of [-1, 1]) {
        const long = s === 1;
        const sh = d.node(body, s * 0.25, 0.6, 0, (long ? (atkArm || castUp) : -sw * 0.4 * sp), 0, s * 0.08);
        d.shp('c', sh, 0, long ? -0.22 : -0.16, 0, 0.09, long ? 0.45 : 0.32, 0.09, cloth, CLOTH, o);
        const el = d.node(sh, 0, long ? -0.44 : -0.3, 0, -0.3);
        d.shp('c', el, 0, long ? -0.3 : -0.15, 0, 0.07, long ? 0.65 : 0.3, 0.07, skin, SK, o);
        d.shp('b', el, 0, long ? -0.72 : -0.34, 0, 0.09, long ? 0.25 : 0.1, 0.03, skin, SK, o);
      }
      break;
    }
    case 'chronos': {
      const tq = Math.floor(a.t * 5) / 5 + (Math.sin(a.t * 0.7) > 0.8 ? 0.12 : 0); // irregular, time-quantized
      const coat = col('#4a3a22'), brass = col('#c9a64a'), dark = col('#17120c');
      const sp2 = a.moving ? 1 : 0;
      const body = d.node(root, 0, 1.0, 0, 0.1 * sp2, Math.sin(tq * 0.8) * 0.08, 0);
      for (const s of [-1, 1]) {
        const swing = (s === -1 ? Math.sin(tq * 6) : -Math.sin(tq * 6)) * 0.5 * sp2;
        const hip = d.node(root, s * 0.13, 1.0, 0, -swing, 0, 0);
        d.shp('c', hip, 0, -0.26, 0, 0.14, 0.52, 0.14, dark, CLOTH, o);
        const kn = d.node(hip, 0, -0.5, 0, Math.max(0, -swing) * 0.7);
        d.shp('c', kn, 0, -0.26, 0, 0.11, 0.5, 0.11, dark, CLOTH, o);
        d.shp('b', kn, 0, -0.52, 0.05, 0.11, 0.07, 0.25, brass, MATS.metal, o);
      }
      d.shp('k', body, 0, -0.1, 0, 0.85, 1.2, 0.6, coat, CLOTH, o);
      d.shp('b', body, 0, 0.5, 0, 0.5, 0.7, 0.3, coat, CLOTH, o);
      d.shp('c', body, 0, 0.5, 0.16, 0.34, 0.03, 0.34, brass, MATS.metal, { emis: 0.25, alpha: o.alpha }, Math.PI / 2);
      d.shp('b', body, 0, 0.52, 0.185, 0.02, 0.14, 0.01, dark, MATS.metal, o, 0, 0, tq * 3);
      d.shp('b', body, 0, 0.52, 0.19, 0.016, 0.1, 0.01, dark, MATS.metal, o, 0, 0, tq * 0.4);
      const head = d.node(body, 0, 1.0, 0, 0, 0, Math.sin(tq * 3) * 0.08);
      d.shp('b', head, 0, 0, 0, 0.28, 0.34, 0.28, col('#2a2418'), MATS.metal, o);
      d.shp('c', head, -0.145, 0.02, 0, 0.26, 0.03, 0.26, [0.9, 0.85, 0.65], MATS.metal, { emis: 0.3, alpha: o.alpha }, 0, 0, Math.PI / 2);
      d.shp('b', head, -0.165, 0.02, 0.04, 0.012, 0.01, 0.1, dark, MATS.metal, o, tq * 4);
      d.shp('c', head, 0, 0.26, 0, 0.34, 0.04, 0.34, dark, CLOTH, o);
      d.shp('c', head, 0, 0.38, 0, 0.22, 0.24, 0.22, dark, CLOTH, o);
      d.shp('s', head, 0.06, -0.02, 0.145, 0.04, 0.04, 0.02, brass, MATS.glass, { emis: 1, alpha: o.alpha });
      for (const s of [-1, 1]) {
        const sh = d.node(body, s * 0.34, 0.75, 0, (s === 1 ? (atkArm || castUp) : -0.15), 0, s * 0.1);
        d.shp('c', sh, 0, -0.3, 0, 0.12, 0.62, 0.12, coat, CLOTH, o);
        d.shp('c', sh, 0, -0.64, 0.02, 0.07, 0.3, 0.07, brass, MATS.metal, o);
        d.shp('b', sh, 0, -0.84, 0.02, 0.1, 0.12, 0.05, brass, MATS.metal, o);
      }
      for (const [gx, gy, sc, dir] of [[0.0, 1.9, 1.0, 1], [0.35, 1.5, 0.6, -1]] as [number, number, number, number][]) {
        const g = d.node(root, gx, gy, -0.5, 0, 0, tq * 0.8 * dir);
        d.shp('c', g, 0, 0, 0, 0.9 * sc, 0.06, 0.9 * sc, brass, MATS.metal, { emis: 0.12, alpha: o.alpha }, Math.PI / 2);
        for (let i = 0; i < 8; i++) { const aa = (i / 8) * Math.PI * 2; d.shp('b', g, Math.cos(aa) * 0.48 * sc, Math.sin(aa) * 0.48 * sc, 0, 0.14 * sc, 0.12 * sc, 0.06, brass, MATS.metal, o, 0, 0, aa); }
      }
      for (let i = 0; i < 9; i++) d.glow('s', root, Math.cos(a.t * 0.9 + i) * 0.9, 0.5 + i * 0.22, Math.sin(a.t * 0.9 + i) * 0.9, 0.05, 0.05, 0.05, [1, 0.85, 0.4], 0.7);
      break;
    }
    case 'lumen': {
      const black = col('#07070b'), rune = col('#b36bff');
      const lean = 0.35 + 0.15 * sp + (a.atk > 0 ? 0.25 : 0);
      const body = d.node(root, 0, 1.2, 0, lean, Math.sin(a.t * 0.5) * 0.05, 0);
      for (const s of [-1, 1]) {
        const swing = (s === -1 ? sw : sw2) * 0.5 * sp;
        const hip = d.node(root, s * 0.13, 1.2, 0, -swing + 0.15, 0, s * 0.05);
        d.shp('c', hip, 0, -0.32, 0, 0.1, 0.66, 0.1, black, { k: 0, shine: 6, spec: 0.02 }, o);
        const kn = d.node(hip, 0, -0.64, 0, 0.35 + Math.max(0, -swing) * 0.6);
        d.shp('c', kn, 0, -0.32, 0, 0.08, 0.66, 0.08, black, { k: 0, shine: 6, spec: 0.02 }, o);
        d.shp('b', kn, 0, -0.66, 0.08, 0.08, 0.05, 0.3, black, CLOTH, o);
      }
      d.shp('b', body, 0, 0.3, 0, 0.36, 0.9, 0.2, black, { k: 0, shine: 6, spec: 0.02 }, o);
      for (let i = 0; i < 6; i++) d.shp('k', body, (i - 2.5) * 0.12, -0.35, -0.1 - Math.sin(a.t + i) * 0.04, 0.18, 0.9 + (i % 3) * 0.2, 0.1, black, CLOTH, o, Math.sin(a.t * 1.3 + i) * 0.1 + 0.15);
      const head = d.node(body, 0, 0.95, 0.05, 0.4, 0, Math.sin(a.t * 0.8) * 0.08);
      d.shp('s', head, 0, 0, 0, 0.22, 0.34, 0.22, black, { k: 0, shine: 6, spec: 0.02 }, o);
      for (const s of [-1, 1]) d.shp('b', head, s * 0.05, 0.04, 0.105, 0.07, 0.014, 0.01, rune, SK, { emis: 1, alpha: o.alpha }, 0, 0, s * -0.3);
      for (let i = 0; i < 3; i++) d.shp('b', head, 0, -0.03 - i * 0.04, 0.108, 0.1 - i * 0.025, 0.01, 0.01, rune, SK, { emis: 0.9, alpha: o.alpha });
      d.shp('b', head, 0, 0.1, 0.1, 0.012, 0.1, 0.01, rune, SK, { emis: 0.9, alpha: o.alpha });
      for (const s of [-1, 1]) {
        const sh = d.node(body, s * 0.25, 0.75, 0, (s === 1 ? (atkArm || castUp) : -sw * 0.35 * sp + 0.1), 0, s * 0.1);
        d.shp('c', sh, 0, -0.45, 0, 0.07, 0.95, 0.07, black, CLOTH, o);
        const el = d.node(sh, 0, -0.9, 0, -0.3);
        d.shp('c', el, 0, -0.35, 0, 0.055, 0.75, 0.055, black, CLOTH, o);
        for (let f = 0; f < 4; f++) d.shp('b', el, (f - 1.5) * 0.03, -0.9, 0, 0.012, 0.28, 0.012, black, CLOTH, o, 0, 0, (f - 1.5) * 0.1);
      }
      d.glow('s', root, 0, 1.4, 0, 1.3, 2.6, 1.3, [0.25, 0.1, 0.45], 0.1 + (a.cast ? 0.1 : 0));
      break;
    }
  }
}

// ------------------------------------------------------------------ props (disguise / decoration)
export function drawProp(d: Draw, type: number, x: number, y: number, z: number, yaw: number, sc: number, tint?: Rgb, alpha?: number, low = false) {
  d.reset();
  const def = PROPS[type];
  const root = d.root(x, y, z, yaw, sc, sc, sc);
  for (const p of def.parts) {
    const c = hex(p.c);
    if (tint) { c[0] *= tint[0]; c[1] *= tint[1]; c[2] *= tint[2]; }
    d.shp(p.s, root, p.p[0], p.p[1], p.p[2], p.z[0], p.z[1], p.z[2], c as Rgb, MATS[p.m], { emis: p.e ?? 0, alpha: alpha !== undefined && alpha < 1 ? alpha : undefined, low }, 0, p.ry ?? 0, p.rz ?? 0);
  }
}

// ------------------------------------------------------------------ objectives
export function drawGenerator(d: Draw, x: number, z: number, yaw: number, progress: number, active: boolean, done: boolean, faulty: number, t: number) {
  d.reset();
  const root = d.root(x, 0, z, yaw);
  d.shp('b', root, 0, 0.3, 0, 0.95, 0.6, 0.7, col('#5b6650'), MATS.metal);
  d.shp('b', root, 0, 0.64, 0, 1.0, 0.06, 0.75, col('#3d4636'), MATS.metal);
  d.shp('c', root, -0.25, 0.95, 0, 0.42, 0.55, 0.42, col('#6a7260'), MATS.metal, {}, 0, 0, 0);
  d.shp('c', root, 0.28, 0.85, 0, 0.3, 0.35, 0.3, col('#4a5240'), MATS.metal);
  d.shp('b', root, 0, 0.4, 0.36, 0.7, 0.34, 0.04, col('#1c1f1a'), MATS.plastic);
  for (let i = 0; i < 5; i++) {
    const lit = progress >= (i + 1) / 5 - 0.001 || (done);
    d.shp('b', root, -0.28 + i * 0.14, 0.4, 0.385, 0.09, 0.14, 0.02, lit ? [0.2, 1, 0.4] : [0.15, 0.2, 0.15], MATS.plastic, { emis: lit ? 1 : 0, unlit: lit });
  }
  for (const s of [-1, 1]) { d.shp('c', root, s * 0.42, 0.04, 0.3, 0.1, 0.08, 0.1, [0.1, 0.1, 0.1], MATS.plastic); d.shp('c', root, s * 0.42, 0.04, -0.3, 0.1, 0.08, 0.1, [0.1, 0.1, 0.1], MATS.plastic); }
  const flick = faulty > 0 ? (Math.sin(t * 40) > 0 ? 1 : 0.15) : 1;
  const beacon: Rgb = done ? [0.2, 1, 0.4] : faulty > 0 ? [1, 0.25, 0.1] : active ? [1, 0.8, 0.2] : [0.9, 0.25, 0.2];
  d.shp('s', root, 0, 1.3, 0.0, 0.2, 0.2, 0.2, beacon, MATS.glass, { emis: 1 * flick, unlit: true });
  d.glow('s', root, 0, 1.3, 0, 0.9, 0.9, 0.9, beacon, (active || done ? 0.25 : 0.12) * flick);
  if (active && !done) for (let i = 0; i < 4; i++) d.glow('s', root, Math.sin(t * 31 + i * 7) * 0.4, 0.8 + Math.sin(t * 23 + i) * 0.3, Math.cos(t * 27 + i * 3) * 0.4, 0.05, 0.05, 0.05, [1, 0.9, 0.5], 0.9);
}

export function drawSeal(d: Draw, x: number, z: number, occupied: boolean, rescue: number, t: number) {
  d.reset();
  const root = d.root(x, 0, z, 0);
  const c: Rgb = occupied ? [0.7, 0.4, 1] : [0.3, 0.25, 0.45];
  d.shp('c', root, 0, 0.04, 0, 1.9, 0.08, 1.9, col('#1b1722'), MATS.stone);
  d.shp('c', root, 0, 0.09, 0, 1.6, 0.03, 1.6, c, MATS.glass, { emis: occupied ? 0.9 : 0.25, unlit: occupied });
  for (let i = 0; i < 4; i++) { const aa = (i / 4) * Math.PI * 2 + Math.PI / 4; d.shp('b', root, Math.cos(aa) * 0.9, 0.7, Math.sin(aa) * 0.9, 0.1, 1.4, 0.1, col('#2a2433'), MATS.stone); d.shp('s', root, Math.cos(aa) * 0.9, 1.45, Math.sin(aa) * 0.9, 0.12, 0.12, 0.12, c, MATS.glass, { emis: 1, unlit: true }); }
  if (occupied) {
    const f = 0.6 + 0.4 * Math.sin(t * 3);
    d.glow('c', root, 0, 1.0, 0, 1.4, 2.0, 1.4, [0.6, 0.35, 1], 0.2 * f + 0.08);
    for (let i = 0; i < 12; i++) { const aa = (i / 12) * 6.283 + t; d.glow('s', root, Math.cos(aa) * 0.78, 0.15 + ((t * 0.5 + i * 0.1) % 1) * 1.6, Math.sin(aa) * 0.78, 0.05, 0.05, 0.05, [0.85, 0.7, 1], 0.9); }
    const n = Math.round(rescue * 16);
    for (let i = 0; i < n; i++) { const aa = (i / 16) * 6.283 - Math.PI / 2; d.glow('s', root, Math.cos(aa) * 1.05, 0.18, Math.sin(aa) * 1.05, 0.12, 0.12, 0.12, [0.4, 1, 0.6], 1); }
  }
}

export function drawGate(d: Draw, x: number, z: number, alongX: boolean, state: number, prog: number, t: number) {
  d.reset();
  const root = d.root(x, 0, z, alongX ? Math.PI / 2 : 0);
  const open = state === 3 ? 1 : state === 2 ? prog * 0.9 : 0;
  const metal = col('#2d3238');
  for (const s of [-1, 1]) {
    d.shp('b', root, s * 1.5, 1.6, 0, 0.5, 3.2, 0.5, metal, MATS.metal);
    d.shp('b', root, s * 1.5, 3.25, 0, 0.62, 0.14, 0.62, col('#1c2024'), MATS.metal);
    const lamp: Rgb = state === 3 ? [0.2, 1, 0.4] : state >= 1 ? [1, 0.75, 0.2] : [1, 0.2, 0.15];
    d.shp('s', root, s * 1.5, 3.0, 0.3, 0.18, 0.18, 0.18, lamp, MATS.glass, { emis: 1, unlit: true });
    d.glow('s', root, s * 1.5, 3.0, 0.3, 1.2, 1.2, 1.2, lamp, 0.2 + 0.1 * Math.sin(t * 4));
    d.shp('b', root, s * (0.6 + open * 0.8), 1.4, 0, 1.1, 2.8, 0.12, col('#20252b'), MATS.metal);
    for (let i = 0; i < 5; i++) d.shp('b', root, s * (0.6 + open * 0.8), 0.4 + i * 0.5, 0.07, 1.0, 0.05, 0.03, col('#555d66'), MATS.metal);
  }
  d.shp('b', root, 0, 3.2, 0, 3.5, 0.3, 0.5, col('#1c2024'), MATS.metal);
  if (state === 3) { d.glow('b', root, 0, 1.5, 0, 2.6, 3.0, 0.3, [0.6, 1, 0.8], 0.28 + 0.1 * Math.sin(t * 3)); for (let i = 0; i < 10; i++) d.glow('s', root, Math.sin(t * 0.7 + i * 2) * 1.1, ((t * 0.4 + i * 0.1) % 1) * 3, 0, 0.07, 0.07, 0.07, [0.8, 1, 0.9], 0.9); }
  else if (state === 2) d.glow('b', root, 0, 1.4, 0, 2.0 * open + 0.2, 2.8, 0.2, [1, 0.8, 0.4], 0.2);
}

export function drawSigil(d: Draw, x: number, z: number, t: number) {
  d.reset();
  const root = d.root(x, 0.03, z, t * 0.4);
  d.shp('c', root, 0, 0, 0, 2.4, 0.02, 2.4, [0.9, 0.35, 1], MATS.glass, { emis: 1, unlit: true, alpha: 0.55 + 0.2 * Math.sin(t * 3) });
  for (let i = 0; i < 5; i++) { const aa = (i / 5) * 6.283; d.shp('b', root, Math.cos(aa) * 0.6, 0.02, Math.sin(aa) * 0.6, 0.06, 0.02, 1.4, [1, 0.6, 1], MATS.glass, { emis: 1, unlit: true }, 0, aa + Math.PI / 2 + 0.6); }
  d.glow('c', root, 0, 0.5, 0, 2.2, 1.0, 2.2, [0.8, 0.3, 1], 0.08);
}

export function drawZone(d: Draw, kind: 'time' | 'dark' | 'blackout', x: number, z: number, r: number, t: number, left: number) {
  d.reset();
  const root = d.root(x, 0, z, 0);
  const fade = Math.min(1, left * 2);
  if (kind === 'time') {
    d.glow('c', root, 0, 1.2, 0, r * 2, 2.4, r * 2, [0.35, 0.55, 1], 0.1 * fade);
    d.glow('c', root, 0, 0.04, 0, r * 2, 0.04, r * 2, [0.5, 0.75, 1], 0.3 * fade);
    for (let i = 0; i < 12; i++) { const aa = t * 0.3 + (i / 12) * 6.28; d.glow('b', root, Math.cos(aa) * r * 0.8, 1.0 + Math.sin(t + i) * 0.5, Math.sin(aa) * r * 0.8, 0.08, 0.25, 0.02, [0.9, 0.9, 1], 0.7 * fade); }
  } else if (kind === 'dark') {
    d.r.prim('c', trs(d.pool[0], x, 1.5, z, 0, 0, 0, r * 2, 3, r * 2), [0.02, 0.0, 0.05], { alpha: 0.55 * fade, unlit: true });
    d.glow('c', root, 0, 0.05, 0, r * 2, 0.03, r * 2, [0.6, 0.2, 1], 0.25 * fade);
  } else {
    d.glow('c', root, 0, 2.9, 0, r * 2, 0.04, r * 2, [0.45, 0.2, 0.9], 0.12 * fade);
  }
}
