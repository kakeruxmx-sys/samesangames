// Bakes a GameMap (shared with the server) into chunked static geometry + a light list.
import { CELL, WALL_H } from '../../shared/constants';
import { GameMap, ROOM_TYPES } from '../../shared/maps';
import { PROPS } from '../../shared/props';
import { Batch, Chunk, hex, Light, MAT_CEIL, MAT_FLOOR_CONC, MAT_FLOOR_TILE, MAT_FLOOR_WOOD, MAT_WALL_CONC, MAT_WALL_PAPER, MATS, Mat, Quality, Renderer, Rgb } from './gl';

const WOOD_FLOOR = new Set(['c', 'o', 'l', 'm', 'g', 'R', 'r', 'L', 'x', 'a']);
const TILE_FLOOR = new Set(['t', 'k', 's', 'e', 'z']);

export interface World {
  map: GameMap;
  opaque: Chunk[];
  decals: Chunk[];
  lamps: LampInst[];
}
export interface LampInst { x: number; y: number; z: number; r: number; color: Rgb; i: number; flicker: boolean; seed: number }

const mulc = (c: Rgb, k: number): Rgb => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

function hash(n: number) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

export function bakeWorld(r: Renderer, map: GameMap, q: Quality): World {
  const b = new Batch(16), dec = new Batch(16);
  const W = map.w, H = map.h;
  const typeAt = (cx: number, cz: number) => (cx < 0 || cz < 0 || cx >= W || cz >= H ? '#' : map.types[cz * W + cx]);
  const isWall = (cx: number, cz: number) => typeAt(cx, cz) === '#';
  const seg = q.seg;

  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const t = typeAt(cx, cz);
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
    if (t !== '#') {
      const rt = ROOM_TYPES[t];
      const fl = hex(rt?.floor ?? '#333333');
      const v = 0.88 + 0.24 * hash(cx * 73856093 ^ cz * 19349663);
      const fm: Mat = WOOD_FLOOR.has(t) ? MAT_FLOOR_WOOD : TILE_FLOOR.has(t) ? MAT_FLOOR_TILE : MAT_FLOOR_CONC;
      b.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], mulc(fl, v), fm);
      if (rt?.ceil !== false) {
        const cc: Rgb = mulc(hex(rt?.wall ?? '#444444'), 0.45);
        b.quad([x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], cc, MAT_CEIL);
      }
    }
  }

  // walls: a quad on every wall face that borders an open cell
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    if (!isWall(cx, cz)) continue;
    const kind = map.solidKind.get(cz * W + cx);
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
    for (const [dx, dz] of dirs) {
      const nt = typeAt(cx + dx, cz + dz);
      if (nt === '#') continue;
      const rt = ROOM_TYPES[nt];
      let col = hex(rt?.wall ?? '#555555');
      let mat: Mat = (nt === 'r' || nt === 'R' || nt === 'L' || nt === 'm') ? MAT_WALL_PAPER : MAT_WALL_CONC;
      let top = WALL_H;
      let emis = 0;
      if (kind === 'machine') { col = [0.75, 0.55, 0.12]; mat = MATS.metal; top = 2.6; }
      else if (kind === 'pillar') { col = [0.5, 0.5, 0.52]; mat = MAT_WALL_CONC; }
      else if (kind === 'escalator') { col = [0.2, 0.22, 0.26]; mat = MATS.metal; top = 1.4; }
      const v = 0.92 + 0.16 * hash(cx * 92837111 ^ cz * 689287499 ^ (dx + 2 * dz));
      col = mulc(col, v);
      let A: number[], B: number[], C: number[], D: number[];
      if (dx === 1) { A = [x1, 0, z1]; B = [x1, 0, z0]; C = [x1, top, z0]; D = [x1, top, z1]; }
      else if (dx === -1) { A = [x0, 0, z0]; B = [x0, 0, z1]; C = [x0, top, z1]; D = [x0, top, z0]; }
      else if (dz === 1) { A = [x0, 0, z1]; B = [x1, 0, z1]; C = [x1, top, z1]; D = [x0, top, z1]; }
      else { A = [x1, 0, z0]; B = [x0, 0, z0]; C = [x0, top, z0]; D = [x1, top, z0]; }
      b.quad(A, B, C, D, col, mat, emis);
      // baseboard
      const off = 0.012; // lift the baseboard slightly off the wall to avoid z-fighting
      const A2 = [A[0] + dx * off, 0.01, A[2] + dz * off], B2 = [B[0] + dx * off, 0.01, B[2] + dz * off];
      const C2 = [B[0] + dx * off, 0.22, B[2] + dz * off], D2 = [A[0] + dx * off, 0.22, A[2] + dz * off];
      b.quad(A2, B2, C2, D2, mulc(col, 0.35), MATS.wood);
      if (top < WALL_H) {
        // top cap of low solids (machines / escalators)
        const tcol = kind === 'machine' ? ([0.9, 0.65, 0.15] as Rgb) : ([0.3, 0.32, 0.36] as Rgb);
        b.quad([x0, top, z0], [x0, top, z1], [x1, top, z1], [x1, top, z0], tcol, MATS.metal);
      }
    }
    if (kind === 'machine') {
      // indicator lights on machines
      b.shape('b', [0, 2.66, 0], [0.4, 0.12, 0.4], 0, 0, [0.2, 1, 0.4], MATS.plastic, 1, 12, 1, (cx + 0.5) * CELL, (cz + 0.5) * CELL, 0);
    }
  }

  // door lintels at the proper height
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) if (typeAt(cx, cz) === 'd') {
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL, yl = 2.45;
    const lc: Rgb = [0.13, 0.1, 0.08];
    b.quad([x0, yl, z0], [x0, yl, z1], [x0, WALL_H, z1], [x0, WALL_H, z0], lc, MATS.wood);
    b.quad([x1, yl, z1], [x1, yl, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], lc, MATS.wood);
    b.quad([x1, yl, z0], [x0, yl, z0], [x0, WALL_H, z0], [x1, WALL_H, z0], lc, MATS.wood);
    b.quad([x0, yl, z1], [x1, yl, z1], [x1, WALL_H, z1], [x0, WALL_H, z1], lc, MATS.wood);
    b.quad([x0, yl, z0], [x1, yl, z0], [x1, yl, z1], [x0, yl, z1], lc, MATS.wood);
  }

  // props (every prop is a real, individually varied instance; the server uses the same list)
  for (const p of map.props) {
    const def = PROPS[p.type];
    const tint = 0.92 + 0.16 * hash(p.id * 2654435761);
    for (const part of def.parts) {
      const base = hex(part.c);
      b.shape(part.s, part.p, part.z, part.ry ?? 0, part.rz ?? 0, mulc(base, tint), MATS[part.m], part.e ?? 0, seg, p.sc, p.x, p.z, p.yaw);
    }
    if (q.decals) {
      const rr = p.r * 1.35;
      const pts: number[][] = [];
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push([p.x + Math.cos(a) * rr, 0.012, p.z + Math.sin(a) * rr]); }
      const ctr = [p.x, 0.012, p.z];
      for (let i = 0; i < 12; i++) { const a = pts[i], c = pts[(i + 1) % 12]; dec.quad(ctr, c, c, a, [0, 0, 0], { k: 0, shine: 1, spec: 0 }, 0); }
    }
  }
  const opaque = b.build(r);
  // decals need alpha: bake alpha via uTint at draw time; they are plain black unlit fans (soft look by 2 layers)
  const decals = q.decals ? dec.build(r) : [];

  const lamps: LampInst[] = map.lights.map((l, i) => ({ x: l.x, y: l.y, z: l.z, r: l.r, color: hex(l.color) as Rgb, i: l.i, flicker: l.flicker, seed: i * 1.7 }));
  return { map, opaque, decals, lamps };
}

// pick the nearest lamps to the camera, applying flicker and blackout dimming
export function pickLights(w: World, cx: number, cz: number, t: number, max: number, dimZones: { x: number; z: number; r: number }[], out: Light[]) {
  const cand: { l: LampInst; d: number }[] = [];
  for (const l of w.lamps) {
    const d = Math.hypot(l.x - cx, l.z - cz);
    if (d < l.r + 6) cand.push({ l, d });
  }
  cand.sort((a, b) => a.d - b.d);
  for (let i = 0; i < cand.length && out.length < max; i++) {
    const l = cand[i].l;
    let inten = l.i;
    if (l.flicker) {
      const f = Math.sin(t * 17 + l.seed * 9) * Math.sin(t * 5.3 + l.seed) + Math.sin(t * 41 + l.seed * 3);
      inten *= f > 1.1 ? 0.15 : f > 0.8 ? 0.55 : 1;
    }
    for (const z of dimZones) if (Math.hypot(l.x - z.x, l.z - z.z) < z.r) inten *= 0.3; // BLACKOUT: dimmed, never fully dark
    out.push({ x: l.x, y: l.y, z: l.z, r: l.r, c: l.color, i: inten * 1.6 });
  }
}
