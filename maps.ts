// Four original maps, authored as room rectangles on a cell grid (CELL metres per cell).
// buildMap() is deterministic: server and client generate IDENTICAL geometry/props from the same id.
// NOTE (MVP limit): maps are single-level. Hotel/Mall "multi-floor" and stairs are NOT implemented.
import { CELL, MapId } from './constants';
import { K_, PROPS } from './props';

export type Vec = { x: number; z: number };

export interface RoomType {
  name: string;
  pool: string[]; // prop keys (repeat = weight)
  density: number; // probability per eligible cell
  ceil: boolean;
  floor: string; // floor tint
  wall: string; // wall tint
  dark?: boolean;
}

const T = (name: string, floor: string, wall: string, density: number, pool: string[], ceil = true, dark = false): RoomType => ({ name, floor, wall, density, pool, ceil, dark });

export const ROOM_TYPES: Record<string, RoomType> = {
  h: T('Hall', '#3b3d3a', '#59615a', 0.1, ['trashcan', 'cone', 'bucket', 'extinguisher', 'plant', 'umbrella', 'lamp']),
  d: T('Door', '#34322f', '#59615a', 0, []),
  c: T('Classroom', '#5a4a38', '#6b7466', 0.3, ['desk', 'desk', 'chair', 'chair', 'desk', 'chair', 'shelf', 'cabinet', 'trashcan', 'plant', 'locker', 'books']),
  o: T('Office', '#4a4a50', '#6d6a60', 0.22, ['desk', 'chair', 'cabinet', 'shelf', 'plant', 'table', 'lamp', 'trashcan', 'books']),
  b: T('Broadcast Room', '#2f3a40', '#4a5560', 0.26, ['tv', 'desk', 'chair', 'cabinet', 'lamp', 'shelf', 'cooler']),
  t: T('Restroom', '#6a7378', '#7e8a88', 0.18, ['bucket', 'trashcan', 'cone', 'locker', 'cooler'], true, true),
  g: T('Gymnasium', '#6b5230', '#6f6a58', 0.12, ['cone', 'bucket', 'crate', 'beanbag', 'trashcan', 'barrel', 'cushion']),
  l: T('Library', '#4f3a2a', '#5a4a3a', 0.32, ['shelf', 'shelf', 'table', 'chair', 'chair', 'books', 'lamp', 'globe', 'statue', 'books']),
  s: T('Science Lab', '#3c4a45', '#566a62', 0.28, ['table', 'stool', 'stool', 'cabinet', 'extinguisher', 'barrel', 'plant', 'cooler', 'globe', 'locker'], true, true),
  m: T('Music Room', '#5a4538', '#64584c', 0.22, ['stool', 'chair', 'statue', 'tv', 'shelf', 'plant', 'candle', 'chair', 'cushion']),
  y: T('Schoolyard', '#2f3a2c', '#4a4f48', 0.07, ['barrel', 'crate', 'trashcan', 'cone', 'bucket', 'horse', 'plant'], false),
  r: T('Guest Room', '#4d3b44', '#6b5a50', 0.3, ['sofa', 'table', 'lamp', 'suitcase', 'chair', 'cabinet', 'tv', 'chest', 'plant', 'cushion', 'mannequin']),
  R: T('Restaurant', '#4a3022', '#6a5040', 0.3, ['table', 'chair', 'chair', 'chair', 'plant', 'candle', 'cooler', 'table', 'umbrella']),
  k: T('Kitchen', '#5a6065', '#7b8284', 0.28, ['barrel', 'crate', 'cabinet', 'bucket', 'trashcan', 'table', 'extinguisher', 'cardboard']),
  e: T('Elevator Hall', '#3a3448', '#5a4f60', 0.15, ['sofa', 'plant', 'statue', 'lamp', 'umbrella', 'trashcan']),
  L: T('Lobby', '#5a4a3c', '#6e5f4e', 0.22, ['sofa', 'table', 'statue', 'plant', 'lamp', 'suitcase', 'clock', 'umbrella', 'chest', 'sofa']),
  a: T('Admin Office', '#3f4348', '#5c6064', 0.25, ['desk', 'chair', 'cabinet', 'shelf', 'lamp', 'tv', 'extinguisher', 'books']),
  B: T('Basement', '#33342f', '#4a4a44', 0.25, ['barrel', 'crate', 'chest', 'bucket', 'suitcase', 'trashcan', 'cardboard', 'cardboard'], true, true),
  n: T('Boiler Room', '#2c2e30', '#3f4448', 0.2, ['barrel', 'bucket', 'extinguisher', 'crate', 'cabinet', 'barrel'], true, true),
  p: T('Packing Area', '#4a4f6a', '#5f6788', 0.3, ['cardboard', 'cardboard', 'crate', 'blocks', 'teddy', 'horse', 'bucket', 'blocks']),
  w: T('Storage', '#44403a', '#58544c', 0.32, ['crate', 'crate', 'barrel', 'cardboard', 'shelf', 'chest', 'suitcase', 'cone', 'cardboard']),
  F: T('Production Floor', '#3a3f48', '#5a6270', 0.13, ['crate', 'barrel', 'cardboard', 'teddy', 'blocks', 'cone', 'extinguisher', 'horse']),
  x: T('Break Room', '#6a5a3a', '#7a7460', 0.3, ['sofa', 'table', 'chair', 'cooler', 'beanbag', 'tv', 'plant', 'trashcan', 'cushion']),
  f: T('Food Court', '#6a6258', '#7b766c', 0.2, ['table', 'chair', 'chair', 'chair', 'plant', 'trashcan', 'cooler', 'umbrella']),
  u: T('Supermarket', '#58606a', '#78808a', 0.3, ['shelf', 'shelf', 'crate', 'cardboard', 'cabinet', 'trashcan', 'cone', 'shelf', 'barrel']),
  v: T('Arcade', '#2a2438', '#3a3050', 0.3, ['tv', 'tv', 'stool', 'beanbag', 'blocks', 'horse', 'cabinet', 'tv'], true, true),
  q: T('Cinema', '#3a2230', '#4f2a3c', 0.24, ['sofa', 'beanbag', 'tv', 'plant', 'statue', 'sofa'], true, true),
  z: T('Clothing Store', '#6a5a6a', '#8a7a8a', 0.28, ['mannequin', 'mannequin', 'screen', 'suitcase', 'shelf', 'chest', 'cushion']),
  j: T('Concourse', '#6e6a62', '#85817a', 0.1, ['plant', 'statue', 'sofa', 'trashcan', 'umbrella', 'lamp']),
  P: T('Parking Garage', '#3c3c3e', '#55565a', 0.07, ['cone', 'barrel', 'crate', 'cardboard', 'extinguisher']),
};

export interface Theme {
  fog: string;
  fogDensity: number;
  ambient: number;
  lamp: string; // lamp colour
  lampI: number;
  accent: string; // neon / emergency accent
  sky: string;
}

export interface MapLight { x: number; y: number; z: number; r: number; color: string; i: number; flicker: boolean }
export interface PropInst { id: number; type: number; x: number; z: number; yaw: number; sc: number; r: number }
export interface RoomRect { t: string; x: number; y: number; w: number; h: number }

export interface GameMap {
  id: MapId;
  name: string;
  jp: string;
  desc: string;
  w: number;
  h: number;
  grid: Uint8Array; // 1 = wall
  types: string[]; // room type char per cell ('#' for wall)
  solidKind: Map<number, string>; // wall cells with special look: machine/pillar/escalator
  rooms: RoomRect[];
  theme: Theme;
  props: PropInst[];
  propCells: number[][]; // cell index -> prop indices (for collision)
  gens: Vec[];
  seals: Vec[];
  gate: Vec;
  survSpawns: Vec[];
  killerSpawn: Vec;
  lights: MapLight[];
  seed: number;
}

// ---------------------------------------------------------------- builder DSL
class Builder {
  types: string[];
  solidKind = new Map<number, string>();
  rooms: RoomRect[] = [];
  constructor(public w: number, public h: number) {
    this.types = new Array(w * h).fill('#');
  }
  room(t: string, x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.types[j * this.w + i] = t;
    this.rooms.push({ t, x, y, w, h });
  }
  door(x: number, y: number, w = 1, h = 1) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.types[j * this.w + i] = 'd';
  }
  solid(x: number, y: number, w: number, h: number, kind: string) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        this.types[j * this.w + i] = '#';
        this.solidKind.set(j * this.w + i, kind);
      }
  }
}

interface MapDef {
  id: MapId;
  name: string;
  jp: string;
  desc: string;
  w: number;
  h: number;
  seed: number;
  theme: Theme;
  build: (b: Builder) => void;
  gens: [number, number][];
  seals: [number, number][];
  gate: [number, number];
  surv: [number, number][];
  killer: [number, number];
}

function buildSchool(b: Builder) {
  b.room('h', 1, 13, 42, 3);
  b.room('c', 1, 2, 9, 10); b.room('c', 11, 2, 9, 10); b.room('o', 21, 2, 7, 10); b.room('b', 29, 2, 5, 10); b.room('t', 35, 2, 8, 10);
  b.door(4, 12, 2, 1); b.door(14, 12, 2, 1); b.door(23, 12, 2, 1); b.door(30, 12, 2, 1); b.door(38, 12, 2, 1);
  b.door(10, 6); b.door(20, 6); b.door(28, 6); b.door(34, 6);
  b.room('g', 1, 17, 16, 13); b.room('l', 18, 17, 10, 13); b.room('s', 29, 17, 8, 13); b.room('m', 38, 17, 5, 13);
  b.door(7, 16, 2, 1); b.door(12, 16, 2, 1); b.door(22, 16, 2, 1); b.door(32, 16, 2, 1); b.door(40, 16);
  b.door(17, 22); b.door(28, 22); b.door(37, 22);
  b.room('y', 1, 31, 42, 4);
  b.door(8, 30, 2, 1); b.door(22, 30, 2, 1); b.door(32, 30, 2, 1); b.door(40, 30);
}

function buildHotel(b: Builder) {
  b.room('h', 1, 9, 44, 2);
  for (const x of [1, 7, 13, 19, 25, 31, 37]) b.room('r', x, 1, 5, 7);
  for (const x of [3, 9, 15, 21, 27, 33, 39]) b.door(x, 8);
  b.door(6, 4); b.door(12, 4); b.door(30, 4); b.door(36, 4);
  b.room('R', 1, 12, 14, 9); b.room('k', 16, 12, 7, 9); b.room('e', 24, 12, 6, 9); b.room('L', 31, 12, 14, 9);
  b.door(6, 11, 2, 1); b.door(19, 11); b.door(26, 11, 2, 1); b.door(37, 11, 2, 1);
  b.door(15, 16); b.door(23, 16); b.door(30, 16);
  b.room('h', 1, 22, 44, 2);
  b.door(8, 21); b.door(19, 21); b.door(26, 21); b.door(40, 21);
  b.room('a', 1, 25, 8, 8); b.room('B', 10, 25, 8, 8); b.room('n', 19, 25, 8, 8); b.room('B', 28, 25, 8, 8); b.room('B', 37, 25, 8, 8);
  for (const x of [4, 13, 22, 31, 40]) b.door(x, 24);
  b.door(9, 28); b.door(18, 28); b.door(27, 28); b.door(36, 28);
}

function buildFactory(b: Builder) {
  b.room('F', 1, 2, 30, 15);
  for (const y of [5, 11]) for (const x of [4, 11, 18, 25]) b.solid(x, y, 4, 3, 'machine');
  b.room('h', 1, 18, 42, 2);
  for (const x of [6, 13, 20, 27]) b.door(x, 17, 2, 1);
  b.room('p', 32, 2, 11, 7); b.room('w', 32, 10, 11, 7);
  b.door(37, 9, 2, 1); b.door(31, 5, 1, 2); b.door(31, 13, 1, 2); b.door(34, 17, 2, 1); b.door(38, 17, 2, 1);
  b.room('x', 1, 21, 9, 10); b.room('o', 11, 21, 7, 10); b.room('n', 19, 21, 12, 10); b.room('w', 32, 21, 11, 10);
  b.door(5, 20, 2, 1); b.door(14, 20, 2, 1); b.door(24, 20, 2, 1); b.door(36, 20, 2, 1);
  b.door(10, 25); b.door(18, 25); b.door(31, 25);
}

function buildMall(b: Builder) {
  b.room('u', 1, 2, 12, 15); b.room('v', 1, 18, 12, 7); b.room('o', 1, 26, 12, 7);
  b.door(6, 17, 2, 1); b.door(6, 25, 2, 1);
  b.room('q', 35, 2, 12, 15); b.room('z', 35, 18, 12, 7); b.room('w', 35, 26, 12, 7);
  b.door(40, 17, 2, 1); b.door(40, 25, 2, 1);
  b.room('j', 14, 2, 20, 7);
  b.room('f', 14, 10, 20, 15);
  b.door(19, 9, 10, 1);
  b.room('P', 14, 26, 20, 7);
  b.door(20, 25, 2, 1); b.door(26, 25, 2, 1);
  b.door(13, 5, 1, 2); b.door(13, 12, 1, 2); b.door(13, 20, 1, 2); b.door(13, 29, 1, 2);
  b.door(34, 5, 1, 2); b.door(34, 12, 1, 2); b.door(34, 20, 1, 2); b.door(34, 29, 1, 2);
  for (const [x, y] of [[19, 14], [28, 14], [19, 19], [28, 19]]) b.solid(x, y, 2, 2, 'pillar');
  b.solid(22, 11, 1, 3, 'escalator'); b.solid(26, 11, 1, 3, 'escalator');
}

const DEFS: Record<MapId, MapDef> = {
  school: {
    id: 'school', name: 'ABANDONED SCHOOL', jp: '廃校', w: 44, h: 36, seed: 1101,
    desc: '長い廊下と、机と椅子だらけの教室。隠れる物には事欠かないが、見つかる場所にも事欠かない。',
    theme: { fog: '#050a08', fogDensity: 0.052, ambient: 0.2, lamp: '#cfe8c8', lampI: 1.0, accent: '#7aff9a', sky: '#030605' },
    build: buildSchool,
    gens: [[3, 4], [25, 3], [20, 27], [34, 25], [8, 33]], seals: [[22, 14], [9, 25], [33, 21]], gate: [42, 14],
    surv: [[2, 13], [2, 15], [4, 14], [6, 13]], killer: [36, 14],
  },
  hotel: {
    id: 'hotel', name: 'ABANDONED HOTEL', jp: '廃ホテル', w: 46, h: 34, seed: 2202,
    desc: '長い二本の廊下と客室の迷路。暖色の灯りの下で、家具たちが息をひそめている。',
    theme: { fog: '#0a0605', fogDensity: 0.058, ambient: 0.22, lamp: '#ffc98a', lampI: 0.95, accent: '#ff8a4a', sky: '#060302' },
    build: buildHotel,
    gens: [[3, 3], [27, 3], [18, 19], [4, 28], [32, 28]], seals: [[38, 16], [4, 16], [22, 28]], gate: [44, 22],
    surv: [[2, 9], [2, 10], [4, 9], [4, 10]], killer: [40, 16],
  },
  factory: {
    id: 'factory', name: 'TOY FACTORY', jp: '玩具工場', w: 44, h: 34, seed: 3303,
    desc: '大型機械が作る狭い通路。色あざやかな玩具と、暗い機械室の対比が目を惑わせる。',
    theme: { fog: '#05060c', fogDensity: 0.06, ambient: 0.2, lamp: '#bcd0ff', lampI: 1.0, accent: '#ff5acd', sky: '#02030a' },
    build: buildFactory,
    gens: [[2, 3], [27, 9], [36, 5], [4, 24], [24, 24]], seals: [[16, 9], [36, 14], [14, 24]], gate: [42, 18],
    surv: [[2, 18], [2, 19], [4, 18], [4, 19]], killer: [38, 18],
  },
  mall: {
    id: 'mall', name: 'ABANDONED MALL', jp: '廃ショッピングモール', w: 48, h: 34, seed: 4404,
    desc: '吹き抜けの広場と、それを囲む狭い店舗。変身できるものが多すぎて、本物がわからない。',
    theme: { fog: '#06080c', fogDensity: 0.046, ambient: 0.24, lamp: '#e8f0ff', lampI: 0.9, accent: '#5ad0ff', sky: '#03050a' },
    build: buildMall,
    gens: [[3, 4], [6, 21], [42, 4], [40, 29], [24, 29]], seals: [[24, 17], [6, 10], [40, 21]], gate: [24, 2],
    surv: [[16, 28], [18, 28], [16, 30], [18, 30]], killer: [30, 12],
  },
};

// ---------------------------------------------------------------- rng
export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellCenter = (c: [number, number]): Vec => ({ x: (c[0] + 0.5) * CELL, z: (c[1] + 0.5) * CELL });

const cache = new Map<MapId, GameMap>();

export function buildMap(id: MapId): GameMap {
  const hit = cache.get(id);
  if (hit) return hit;
  const d = DEFS[id];
  const b = new Builder(d.w, d.h);
  d.build(b);
  const grid = new Uint8Array(d.w * d.h);
  for (let i = 0; i < grid.length; i++) grid[i] = b.types[i] === '#' ? 1 : 0;

  const map: GameMap = {
    id, name: d.name, jp: d.jp, desc: d.desc, w: d.w, h: d.h, grid, types: b.types, solidKind: b.solidKind, rooms: b.rooms,
    theme: d.theme, props: [], propCells: [], gens: d.gens.map(cellCenter), seals: d.seals.map(cellCenter), gate: cellCenter(d.gate),
    survSpawns: d.surv.map(cellCenter), killerSpawn: cellCenter(d.killer), lights: [], seed: d.seed,
  };
  map.propCells = Array.from({ length: d.w * d.h }, () => []);

  // special cells: props keep clear of these (Chebyshev radius 1)
  const special = new Set<number>();
  const mark = (c: [number, number]) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) special.add((c[1] + j) * d.w + (c[0] + i)); };
  d.gens.forEach(mark); d.seals.forEach(mark); mark(d.gate); d.surv.forEach(mark); mark(d.killer);

  const rng = mulberry32(d.seed);
  const nearDoor = (cx: number, cz: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (b.types[(cz + j) * d.w + (cx + i)] === 'd') return true;
    return false;
  };
  const wallDir = (cx: number, cz: number): [number, number] | null => {
    if (grid[cz * d.w + cx - 1]) return [-1, 0];
    if (grid[cz * d.w + cx + 1]) return [1, 0];
    if (grid[(cz - 1) * d.w + cx]) return [0, -1];
    if (grid[(cz + 1) * d.w + cx]) return [0, 1];
    return null;
  };

  for (let cz = 1; cz < d.h - 1; cz++) {
    for (let cx = 1; cx < d.w - 1; cx++) {
      const idx = cz * d.w + cx;
      const t = b.types[idx];
      if (t === '#' || t === 'd') continue;
      const rt = ROOM_TYPES[t];
      if (!rt || special.has(idx) || nearDoor(cx, cz)) continue;
      // always consume rng in the same order so results never depend on branches
      const roll = rng(), pick = rng(), jx = rng(), jz = rng(), yawR = rng(), scR = rng(), alignR = rng();
      if (roll > rt.density) continue;
      const key = rt.pool[Math.floor(pick * rt.pool.length)];
      const type = K_(key);
      const pr = PROP_R[type];
      let px = (cx + 0.5) * CELL + (jx - 0.5) * 0.5;
      let pz = (cz + 0.5) * CELL + (jz - 0.5) * 0.5;
      if (t === 'h') {
        // corridor: only small props hugging a wall so a 2-wide corridor stays open
        const wd = wallDir(cx, cz);
        if (!wd || pr > 0.36) continue;
        px = (cx + 0.5) * CELL + wd[0] * (CELL / 2 - pr - 0.08);
        pz = (cz + 0.5) * CELL + wd[1] * (CELL / 2 - pr - 0.08);
      }
      if (distToWall(map, px, pz) < pr * 0.75) continue;
      let ok = true;
      for (const o of map.props) {
        const dx = o.x - px, dz = o.z - pz;
        if (dx * dx + dz * dz < (o.r + pr + 0.15) ** 2) { ok = false; break; }
      }
      if (!ok) continue;
      const yaw = alignR < 0.7 ? Math.floor(yawR * 4) * (Math.PI / 2) : yawR * Math.PI * 2;
      const inst: PropInst = { id: map.props.length, type, x: px, z: pz, yaw, sc: 0.92 + scR * 0.18, r: pr };
      map.props.push(inst);
      map.propCells[idx].push(inst.id);
    }
  }

  // lights: one lamp per room (extra lamps in big rooms), some dark rooms, some flicker.
  const lrng = mulberry32(d.seed ^ 0x9e3779b9);
  for (const rm of b.rooms) {
    const rt = ROOM_TYPES[rm.t];
    const dark = (rt.dark ? lrng() < 0.7 : lrng() < 0.18);
    const nx = Math.max(1, Math.round(rm.w / 8)), nz = Math.max(1, Math.round(rm.h / 8));
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const cx = rm.x + (rm.w * (i + 0.5)) / nx, cz = rm.y + (rm.h * (j + 0.5)) / nz;
      const flick = lrng() < 0.22;
      map.lights.push({
        x: cx * CELL, y: rm.t === 'y' ? 4 : 2.8, z: cz * CELL, r: 12,
        color: rm.t === 'y' ? '#6a7aa0' : rm.t === 'v' || rm.t === 'q' ? d.theme.accent : d.theme.lamp,
        i: (dark ? 0.2 : d.theme.lampI) * (rm.t === 'y' ? 0.5 : 1), flicker: flick,
      });
    }
  }
  // exit gate + generators get accent lights so objectives are findable
  map.lights.push({ x: map.gate.x, y: 2.2, z: map.gate.z, r: 9, color: d.theme.accent, i: 0.9, flicker: false });

  cache.set(id, map);
  return map;
}

const PROP_R: number[] = [];
for (const p of PROPS) PROP_R[p.id] = p.r;

// ---------------------------------------------------------------- collision / queries
export const cellIdx = (map: GameMap, cx: number, cz: number) => cz * map.w + cx;
export function isWallCell(map: GameMap, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= map.w || cz >= map.h) return true;
  return map.grid[cz * map.w + cx] === 1;
}

export function distToWall(map: GameMap, x: number, z: number): number {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = 99;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    if (!isWallCell(map, cx + i, cz + j)) continue;
    const minx = (cx + i) * CELL, maxx = minx + CELL, minz = (cz + j) * CELL, maxz = minz + CELL;
    const nx = Math.max(minx, Math.min(x, maxx)), nz = Math.max(minz, Math.min(z, maxz));
    const dd = Math.hypot(x - nx, z - nz);
    if (dd < best) best = dd;
  }
  return best;
}

function pushWalls(map: GameMap, p: { x: number; z: number }, r: number) {
  const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    if (!isWallCell(map, cx + i, cz + j)) continue;
    const minx = (cx + i) * CELL, maxx = minx + CELL, minz = (cz + j) * CELL, maxz = minz + CELL;
    const nx = Math.max(minx, Math.min(p.x, maxx)), nz = Math.max(minz, Math.min(p.z, maxz));
    let dx = p.x - nx, dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 < 1e-9) {
      // centre inside the wall cell: push out through the nearest face
      const l = p.x - minx, rr = maxx - p.x, t = p.z - minz, bm = maxz - p.z;
      const m = Math.min(l, rr, t, bm);
      if (m === l) p.x = minx - r; else if (m === rr) p.x = maxx + r; else if (m === t) p.z = minz - r; else p.z = maxz + r;
    } else {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    }
  }
}

function pushProps(map: GameMap, p: { x: number; z: number }, r: number) {
  const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const x = cx + i, z = cz + j;
    if (x < 0 || z < 0 || x >= map.w || z >= map.h) continue;
    const list = map.propCells[z * map.w + x];
    for (let k = 0; k < list.length; k++) {
      const pr = map.props[list[k]];
      const dx = p.x - pr.x, dz = p.z - pr.z;
      const rr = r + pr.r * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.0001;
      p.x = pr.x + (dx / d) * rr;
      p.z = pr.z + (dz / d) * rr;
    }
  }
}

/** Move a circle by (dx,dz) with wall + prop collision, sub-stepped so it can never tunnel. */
export function moveCircle(map: GameMap, x: number, z: number, dx: number, dz: number, r: number, props = true): Vec {
  const dist = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(dist / (r * 0.7)));
  const p = { x, z };
  const sx = dx / n, sz = dz / n;
  for (let i = 0; i < n; i++) {
    p.x += sx; p.z += sz;
    pushWalls(map, p, r);
    if (props) { pushProps(map, p, r); pushWalls(map, p, r); }
  }
  return p;
}

/** Grid DDA line-of-sight between two points (walls only). */
export function losClear(map: GameMap, x0: number, z0: number, x1: number, z1: number): boolean {
  let cx = Math.floor(x0 / CELL), cz = Math.floor(z0 / CELL);
  const ex = Math.floor(x1 / CELL), ez = Math.floor(z1 / CELL);
  const dx = x1 - x0, dz = z1 - z0;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tx = dx !== 0 ? (((dx > 0 ? cx + 1 : cx) * CELL - x0) / dx) : Infinity;
  let tz = dz !== 0 ? (((dz > 0 ? cz + 1 : cz) * CELL - z0) / dz) : Infinity;
  for (let guard = 0; guard < 400; guard++) {
    if (isWallCell(map, cx, cz)) return false;
    if (cx === ex && cz === ez) return true;
    if (tx < tz) { cx += sx; tx += tdx; } else { cz += sz; tz += tdz; }
  }
  return true;
}

export function cellOfPoint(x: number) { return Math.floor(x / CELL); }
