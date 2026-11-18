// Movement simulation shared by the authoritative server and the client's prediction.
// The server NEVER trusts a client position: it only consumes (mx, mz, yaw, flags) per fixed tick.
import { DT, RULES, Role } from './constants';
import { GameMap, moveCircle, Vec } from './maps';
import { PROPS } from './props';

export interface InputCmd {
  seq: number;
  mx: number; // strafe: +right
  mz: number; // forward: +forward
  yaw: number;
  pitch: number;
  run: boolean;
  crouch: boolean;
  use: boolean; // interact held (repair / rescue / gate)
}

export interface SpeedCtx {
  role: Role;
  run: boolean;
  crouch: boolean;
  canRun: boolean; // stamina available
  disguise: number; // prop type id or -1
  mul: number; // server-side modifiers (slows, dashes, recovery)
}

// forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)  (right-handed, y up)
export const fwd = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];
export const rgt = (yaw: number): [number, number] => [-Math.cos(yaw), Math.sin(yaw)];

export function baseSpeed(c: SpeedCtx): number {
  let s: number;
  if (c.role === 'K') s = RULES.killerSpeed;
  else if (c.disguise >= 0) s = RULES.disguisedBase * PROPS[c.disguise].mob;
  else if (c.crouch) s = RULES.survivorCrouch;
  else if (c.run && c.canRun) s = RULES.survivorRun;
  else s = RULES.survivorWalk;
  return s * c.mul;
}

export function bodyRadius(role: Role, disguise: number): number {
  if (role === 'K') return RULES.killerRadius;
  if (disguise >= 0) return Math.max(0.3, Math.min(0.6, PROPS[disguise].r));
  return RULES.playerRadius;
}

export function stepMove(map: GameMap, x: number, z: number, inp: Pick<InputCmd, 'mx' | 'mz' | 'yaw'>, speed: number, radius: number): Vec {
  let mx = inp.mx, mz = inp.mz;
  const len = Math.hypot(mx, mz);
  if (len < 0.01) return { x, z };
  if (len > 1) { mx /= len; mz /= len; }
  const f = fwd(inp.yaw), r = rgt(inp.yaw);
  const dx = (f[0] * mz + r[0] * mx) * speed * DT;
  const dz = (f[1] * mz + r[1] * mx) * speed * DT;
  return moveCircle(map, x, z, dx, dz, radius, true);
}
