// Static map validation: every objective must be reachable by a walking survivor (radius 0.35) from every spawn,
// props must not seal any passage, and nothing may spawn inside a wall.
import { buildMap, moveCircle, isWallCell } from '../shared/maps';
import { MAP_IDS, CELL, RULES } from '../shared/constants';
import { PROPS } from '../shared/props';

let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.log('  FAIL:', msg); } };

console.log(`prop types: ${PROPS.length}`);
check(PROPS.length >= 30, 'need >= 30 prop types');

for (const id of MAP_IDS) {
  const m = buildMap(id);
  const R = RULES.playerRadius;
  const STEP = 0.5;
  const nx = Math.ceil((m.w * CELL) / STEP), nz = Math.ceil((m.h * CELL) / STEP);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * STEP, z = (j + 0.5) * STEP;
    const p = moveCircle(m, x, z, 0, 0, R, true);
    free[j * nx + i] = Math.hypot(p.x - x, p.z - z) < 0.02 ? 1 : 0;
  }
  const seen = new Uint8Array(nx * nz);
  const start = m.killerSpawn;
  const si = Math.floor(start.x / STEP), sj = Math.floor(start.z / STEP);
  check(free[sj * nx + si] === 1, `${id}: killer spawn is free`);
  const q: number[] = [sj * nx + si]; seen[sj * nx + si] = 1;
  while (q.length) {
    const c = q.pop()!; const ci = c % nx, cj = (c / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const k = nj * nx + ni;
      if (seen[k] || !free[k]) continue;
      // diagonal moves must not cut a blocked corner
      if (di && dj && (!free[cj * nx + ni] || !free[nj * nx + ci])) continue;
      seen[k] = 1; q.push(k);
    }
  }
  const reach = (v: { x: number; z: number }) => seen[Math.floor(v.z / STEP) * nx + Math.floor(v.x / STEP)] === 1;
  const names: [string, { x: number; z: number }][] = [
    ...m.gens.map((g, i) => [`gen${i}`, g] as [string, { x: number; z: number }]),
    ...m.seals.map((g, i) => [`seal${i}`, g] as [string, { x: number; z: number }]),
    ['gate', m.gate],
    ...m.survSpawns.map((g, i) => [`spawn${i}`, g] as [string, { x: number; z: number }]),
  ];
  for (const [n, v] of names) check(reach(v), `${id}: ${n} reachable from killer spawn`);
  check(m.gens.length === RULES.genCount, `${id}: ${RULES.genCount} generators`);
  for (const v of [...m.gens, ...m.seals, m.gate, m.killerSpawn, ...m.survSpawns]) {
    check(!isWallCell(m, Math.floor(v.x / CELL), Math.floor(v.z / CELL)), `${id}: special inside wall`);
  }
  // props never inside walls
  let bad = 0;
  for (const p of m.props) if (isWallCell(m, Math.floor(p.x / CELL), Math.floor(p.z / CELL))) bad++;
  check(bad === 0, `${id}: ${bad} props inside walls`);
  const total = free.reduce((a, b) => a + b, 0), reached = seen.reduce((a, b) => a + b, 0);
  // everything walkable should be one connected region (rooms isolated by props would show here)
  check(reached / total > 0.985, `${id}: walkable area connected (${reached}/${total})`);
  const kinds = new Set(m.props.map((p) => p.type));
  console.log(`${id.padEnd(8)} ${m.w}x${m.h} cells  props=${m.props.length} (types used ${kinds.size})  lights=${m.lights.length}  walkable-connected=${(100 * reached / total).toFixed(1)}%`);
}
console.log(failures === 0 ? 'MAP TESTS PASSED' : `MAP TESTS FAILED (${failures})`);
process.exit(failures ? 1 : 0);
