// 3D backdrops for the menu / lobby / killer-select / collection screens (rendered on the same canvas as the game).
import { SURVIVOR_LOOKS } from '../../shared/constants';
import { KILLER_IDS, KILLERS, KillerId } from '../../shared/killers';
import { PROPS } from '../../shared/props';
import { Light, Renderer, Rgb } from './gl';
import { Draw, drawKiller, drawProp, drawSurvivor } from './models';

export type SceneMode = 'title' | 'killers' | 'survivors' | 'props' | 'lobby';
const hexRgb = (h: string): Rgb => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export class MenuScene {
  mode: SceneMode = 'title';
  sel = 0; pos = 0;
  lobby: number[] = []; // character index per slot, -1 = empty
  t = 0;
  private d: Draw;
  constructor(private r: Renderer) { this.d = new Draw(r); }
  set(mode: SceneMode, sel = 0) { if (this.mode !== mode) this.pos = sel; this.mode = mode; this.sel = sel; }

  frame(dt: number) {
    const r = this.r, d = this.d; this.t += dt; const t = this.t;
    this.pos += (this.sel - this.pos) * Math.min(1, dt * 7);
    r.fog = [0.02, 0.025, 0.04]; r.fogD = 0.04; r.amb = this.mode === 'title' ? 0.32 : 0.5; r.ambCol = [0.5, 0.58, 0.75]; r.dark = 1;
    const lights: Light[] = [];
    const idle = { t, phase: t * 1.2, speed: 0, run: false, crouch: false, repair: false, scared: 0, atk: 0, cast: 0, moving: false };
    const aspect = r.width / Math.max(1, r.height);
    const portrait = aspect < 1;
    if (this.mode === 'title') {
      lights.push({ x: Math.sin(t * 0.3) * 4, y: 3.2, z: 3, r: 22, c: [0.45, 0.6, 1], i: 1.1 }, { x: 0, y: 2, z: -6, r: 18, c: [1, 0.25, 0.2], i: 1.3 });
      r.setLights(lights); r.begin(Math.sin(t * 0.12) * 1.2, 1.7, 8.5, 0, 1.5, 0, 0.95, t);
      KILLER_IDS.forEach((k, i) => drawKiller(d, k, (i - 2) * 3.4, 0, -7 - Math.abs(i - 2) * 1.8, Math.sin(t * 0.3 + i) * 0.1, idle));
    } else if (this.mode === 'killers') {
      const id = KILLER_IDS[this.sel] ?? KILLER_IDS[0];
      const c = hexRgb(KILLERS[id].color);
      const cx = portrait ? 0 : -2.0;
      lights.push({ x: cx + 1, y: 3.6, z: 5.5, r: 30, c: [1, 0.95, 0.9], i: 2.4 }, { x: cx - 3, y: 2.4, z: 1.5, r: 20, c, i: 2.4 }, { x: cx + 3.5, y: 2.0, z: -1, r: 18, c: [0.4, 0.55, 1], i: 1.6 });
      r.setLights(lights); r.begin(0, 1.75, portrait ? 13 : 6.6, 0, portrait ? -3.4 : 1.35, 0, portrait ? 1.1 : 0.95, t); // portrait: aim lower so the figure sits in the upper half, above the info panel
      KILLER_IDS.forEach((k, i) => {
        const off = i - this.pos;
        const near = Math.max(0, 1 - Math.abs(off));
        const x = cx + off * 3.1, z = -Math.abs(off) * 1.0 - (1 - near) * 0.6;
        drawKiller(d, k, x, 0, z, Math.sin(t * 0.6) * 0.45 * near + (1 - near) * (off > 0 ? -0.5 : 0.5), { ...idle, phase: t * 0.9 });
      });
    } else if (this.mode === 'survivors') {
      lights.push({ x: 0, y: 3.2, z: 5, r: 26, c: [1, 0.95, 0.9], i: 1.5 }, { x: -4, y: 2.5, z: 1, r: 18, c: [0.5, 0.65, 1], i: 1.1 }, { x: 4, y: 2.2, z: 1, r: 16, c: [1, 0.6, 0.45], i: 0.9 });
      r.setLights(lights); r.begin(0, 1.5, portrait ? 8 : 5.6, 0, portrait ? -1.0 : 1.0, 0, 0.9, t);
      SURVIVOR_LOOKS.forEach((L, i) => {
        const off = i - this.pos; const near = Math.max(0, 1 - Math.abs(off));
        drawSurvivor(d, L, (portrait ? 0 : -1.6) + off * 1.5, 0, -Math.abs(off) * 0.35, Math.sin(t * 0.7) * 0.5 * near, { ...idle, phase: t * 1.1 }, 1 + near * 0.18);
      });
    } else if (this.mode === 'props') {
      lights.push({ x: 0, y: 3.5, z: 4, r: 26, c: [1, 0.95, 0.9], i: 1.5 }, { x: -3, y: 2.2, z: 1, r: 14, c: [0.5, 0.65, 1], i: 1.0 });
      r.setLights(lights); r.begin(0, 1.6, portrait ? 7.5 : 5.6, 0, portrait ? -0.7 : 0.7, 0, 0.9, t);
      PROPS.forEach((p, i) => {
        const off = i - this.pos; const near = Math.max(0, 1 - Math.abs(off));
        if (Math.abs(off) > 4) return;
        drawProp(d, p.id, (portrait ? 0 : -1.6) + off * 1.7, 0, -Math.abs(off) * 0.4, t * 0.7 * near + off * 0.4, 1 + near * 0.35);
      });
    } else {
      // lobby: the chosen characters stand in a loose line
      lights.push({ x: 0, y: 3.4, z: 5, r: 26, c: [1, 0.92, 0.85], i: 1.3 }, { x: -5, y: 2.5, z: 1, r: 18, c: [0.45, 0.6, 1], i: 1.0 }, { x: 5, y: 2.5, z: 1, r: 18, c: [1, 0.5, 0.4], i: 0.9 });
      r.setLights(lights); r.begin(0, 1.45, portrait ? 10 : 6.4, 0, 1.05, 0, 0.9, t);
      this.lobby.forEach((ci, i) => {
        if (ci < 0) return;
        const x = (i - 2) * 1.55;
        drawSurvivor(d, SURVIVOR_LOOKS[ci], x, 0, -Math.abs(i - 2) * 0.3, -x * 0.08 + Math.sin(t * 0.5 + i) * 0.1, { ...idle, phase: t * 1.0 + i });
      });
    }
  }
}
