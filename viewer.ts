// Dev-only model/map viewer: ?mode=killers | survivors | props | map&id=school
import { MAP_IDS, MapId, SURVIVOR_LOOKS } from '../../shared/constants';
import { KILLER_IDS } from '../../shared/killers';
import { buildMap } from '../../shared/maps';
import { PROPS } from '../../shared/props';
import { Light, QUALITY, Renderer } from './gl';
import { Draw, drawGate, drawGenerator, drawKiller, drawProp, drawSeal, drawSigil, drawSurvivor, drawZone } from './models';
import { bakeWorld, pickLights } from './world';

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') ?? 'killers';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('i')!;
const r = new Renderer(canvas);
r.setQuality(QUALITY[(qs.get('q') as 'low' | 'medium' | 'high') ?? 'high']);
const d = new Draw(r);
const mapId = (qs.get('id') ?? 'school') as MapId;
const map = buildMap(MAP_IDS.includes(mapId) ? mapId : 'school');
const world = mode === 'map' || mode === 'objects' ? bakeWorld(r, map, r.q) : null;
const t0 = performance.now();
const frozenT = qs.get('t') ? Number(qs.get('t')) : null;
(window as any).__frames = 0;

function frame() {
  const t = frozenT ?? (performance.now() - t0) / 1000;
  const lights: Light[] = [];
  let eye: [number, number, number] = [0, 1.7, 6], tgt: [number, number, number] = [0, 1.2, 0];
  r.fog = [0.03, 0.035, 0.05]; r.fogD = 0.035; r.amb = 0.5; r.ambCol = [0.55, 0.6, 0.75];
  if (mode === 'killers') {
    eye = [0, 1.9, 9]; tgt = [0, 1.3, 0];
    lights.push({ x: 0, y: 3.5, z: 6, r: 40, c: [1, 0.95, 0.9], i: 2.4 }, { x: -7, y: 3, z: 3, r: 26, c: [0.5, 0.65, 1], i: 2.0 }, { x: 7, y: 3, z: 3, r: 26, c: [1, 0.6, 0.5], i: 1.8 });
    r.setLights(lights); r.begin(eye[0], eye[1], eye[2], tgt[0], tgt[1], tgt[2], 0.9, t);
    KILLER_IDS.forEach((k, i) => drawKiller(d, k, (i - 2) * 2.6, 0, 0, Math.sin(t * 0.5) * 0.25, { t, phase: t * 3, speed: 1, run: false, crouch: false, repair: false, scared: 0, atk: 0, cast: 0, moving: qs.get('move') === '1' }));
  } else if (mode === 'survivors') {
    eye = [0, 1.5, 8]; tgt = [0, 1.0, 0];
    lights.push({ x: 0, y: 3, z: 5, r: 30, c: [1, 0.95, 0.9], i: 1.4 }, { x: -6, y: 2.5, z: 2, r: 20, c: [0.5, 0.6, 1], i: 1 });
    r.setLights(lights); r.begin(eye[0], eye[1], eye[2], tgt[0], tgt[1], tgt[2], 0.8, t);
    SURVIVOR_LOOKS.forEach((L, i) => drawSurvivor(d, L, (i - 3.5) * 1.1, 0, 0, Math.sin(t * 0.4 + i) * 0.3, { t, phase: t * 5, speed: 1, run: i % 3 === 1, crouch: i === 5, repair: i === 7, scared: i === 2 ? 1 : 0, atk: 0, cast: 0, moving: i % 2 === 0 }));
  } else if (mode === 'props') {
    const cols = 9; eye = [0, 3.2, 10]; tgt = [0, 0.4, 0];
    lights.push({ x: 0, y: 4, z: 6, r: 30, c: [1, 0.95, 0.9], i: 1.6 }, { x: -7, y: 3, z: 2, r: 22, c: [0.6, 0.7, 1], i: 1.0 });
    r.setLights(lights); r.begin(eye[0], eye[1], eye[2], tgt[0], tgt[1], tgt[2], 0.95, t);
    PROPS.forEach((p, i) => drawProp(d, p.id, ((i % cols) - (cols - 1) / 2) * 1.9, 0, Math.floor(i / cols) * -2.0 + 2.0, Math.PI * 0.15, 1));
  } else if (mode === 'objects') {
    const c = map.gens[0]; eye = [c.x + 4, 2.2, c.z + 6]; tgt = [c.x, 1, c.z];
    const sg = qs.get('at') === 'gate' ? map.gate : qs.get('at') === 'seal' ? map.seals[0] : c;
    eye = [sg.x + 3.5, 2.4, sg.z + 5.5]; tgt = [sg.x, 1.2, sg.z];
    pickLights(world!, sg.x, sg.z, t, 8, [], lights); lights.push({ x: eye[0], y: 1.6, z: eye[2], r: 15, c: [1, 0.95, 0.85], i: 0.9 });
    r.fog = hexRgb(map.theme.fog); r.fogD = map.theme.fogDensity; r.amb = map.theme.ambient + 0.1;
    r.setLights(lights); r.begin(eye[0], eye[1], eye[2], tgt[0], tgt[1], tgt[2], 1.0, t);
    r.drawChunks(world!.opaque, 80);
    map.gens.forEach((g, i) => drawGenerator(d, g.x, g.z, i, (i + 1) / 6, i === 1, i === 4, i === 2 ? 3 : 0, t));
    map.seals.forEach((s, i) => drawSeal(d, s.x, s.z, i === 0, 0.5, t));
    drawGate(d, map.gate.x, map.gate.z, false, Number(qs.get('gs') ?? 2), 0.5, t);
    drawSigil(d, sg.x + 2, sg.z + 2, t); drawZone(d, 'time', sg.x - 3, sg.z + 2, 2.5, t, 3);
    drawSurvivor(d, SURVIVOR_LOOKS[0], sg.x + 1, 0, sg.z + 1.5, 0.5, { t, phase: t * 4, speed: 1, run: false, crouch: false, repair: true, scared: 0, atk: 0, cast: 0 });
    drawProp(d, 2, sg.x - 1.5, 0, sg.z + 3, 0.3, 1);
    r.drawChunks(world!.decals, 40, true);
  } else {
    const sp = map.survSpawns[0];
    const ang = (qs.get('yaw') ? Number(qs.get('yaw')) : t * 0.15);
    const camx = sp.x + Math.sin(ang) * 0.1, camz = sp.z + Math.cos(ang) * 0.1;
    eye = [camx, 1.6, camz]; tgt = [camx + Math.sin(ang) * 5, 1.5, camz + Math.cos(ang) * 5];
    pickLights(world!, camx, camz, t, 8, [], lights);
    lights.unshift({ x: eye[0], y: 1.55, z: eye[2], r: 14, c: [1, 0.95, 0.85], i: 1.1, dx: Math.sin(ang), dy: -0.05, dz: Math.cos(ang), cut: 0.82 });
    r.fog = hexRgb(map.theme.fog); r.fogD = map.theme.fogDensity; r.amb = map.theme.ambient;
    r.setLights(lights); r.begin(eye[0], eye[1], eye[2], tgt[0], tgt[1], tgt[2], 1.2, t);
    r.drawChunks(world!.opaque, r.q.draw);
    r.drawChunks(world!.decals, 25, true);
  }
  info.textContent = `${mode} ${r.width}x${r.height} calls=${r.drawCalls}`;
  (window as any).__frames++;
  requestAnimationFrame(frame);
}
function hexRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
requestAnimationFrame(frame);
