// Wire protocol (JSON over WebSocket). Server is authoritative; clients send intent only.
import type { MapId, Phase, SurvState } from './constants';
import type { KillerId } from './killers';

// ---------------- client -> server
export type ClientMsg =
  | { t: 'hello'; v: number; token?: string; name: string }
  | { t: 'quick' }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'pick'; char: number }
  | { t: 'setmap'; map: MapId | 'random' }
  | { t: 'start' }
  | { t: 'killer'; id: KillerId }
  | { t: 'in'; seq: number; mx: number; mz: number; yaw: number; pitch: number; run: boolean; crouch: boolean; use: boolean }
  | { t: 'act'; a: 'transform' | 'untransform' | 'attack' | 'ab0' | 'ab1' | 'ab2'; d?: number }
  | { t: 'chat'; id: number }
  | { t: 'report'; pub: string; why: string }
  | { t: 'ping'; c: number };

// ---------------- server -> client
export interface LobbySlot {
  slot: number;
  name: string;
  pub: string;
  char: number;
  level: number;
  connected: boolean;
  host: boolean;
  isMe: boolean;
}

export interface RoomInfo {
  code: string;
  kind: 'quick' | 'custom';
  phase: Phase;
  map: MapId | 'random';
  slots: (LobbySlot | null)[]; // always 5 entries; null = empty (a human is required)
  countdown: number | null;
  waitedS: number;
  killerPickS: number | null;
  youAreKiller: boolean | null;
}

export interface ProfileInfo {
  pub: string;
  name: string;
  xp: number;
  level: number;
  matches: number;
  wins: number;
  losses: number;
  killerPlays: number;
  killerUse: Record<string, number>;
  survivorEscapes: number;
  achievements: string[];
  title: string;
}

export interface InitMsg {
  t: 'init';
  map: MapId;
  you: number; // player id 0..4
  role: 'S' | 'K';
  killer: KillerId;
  players: { id: number; name: string; role: 'S' | 'K'; char: number; pub: string }[];
  matchSeconds: number;
  resume: boolean;
}

export interface SnapPlayer {
  i: number;
  x: number;
  z: number;
  y: number; // yaw
  m: number; // moving 0/1
  r: number; // running 0/1
  c: number; // crouch 0/1
  s: SurvState | 'K';
  d: number; // disguise prop type, -1 none
  ds: number; // disguise scale
  da: number; // disguise anim: 0 none, 1 transforming in, 2 transforming out (progress in dp)
  dp: number;
  pr: number; // protected 0/1
  rp: number; // repairing 0/1
  st: number; // capture stage 1..3
  // killer-only visuals
  ph?: number; // phase drift (translucent)
  kd?: { t: 'prop'; id: number; sc: number } | { t: 'surv'; char: number }; // mimic disguise
  at?: number; // attack anim progress 0..1 (0 = not attacking)
  cs?: number; // casting ability slot+1 (windup) 0 none
  dz?: number; // distort 0/1 (self only)
}

export interface SnapSelf {
  x: number; z: number; ack: number;
  sm: number; // server speed multiplier (for prediction)
  fz: number; // frozen
  cr: number; // can run
  stam: number;
  dis: number; // distort seconds left
  dark: number; // in dark zone
  slow: number; // in time field
  tfcd: number; // transform cooldown left
  seal: number; // sealed seconds left (0 = n/a)
  cd?: number[]; // killer cooldowns (seconds left)
  sense?: number; // killer: nearest disguised survivor distance (<= senseRadius) or -1
  mk?: number; // survivor: seconds left of being light-marked (Lumen Trace)
  // own state (the player's own avatar is never in `p`, so the client needs these for prediction and HUD)
  d: number; ds: number; s: SurvState | 'K'; pr: number; st: number; da: number; dp: number; rp: number;
  mmv: number; // killer: mimic disguise active (self HUD)
}

export interface Zone { id: number; k: 'time' | 'dark' | 'blackout'; x: number; z: number; r: number; left: number }
export interface Sigil { id: number; x: number; z: number }
export interface Decoy { id: number; x: number; z: number; y: number }
export interface GenState { p: number; dist: number; act: number; done: number }

export interface SnapMsg {
  t: 'snap';
  tk: number;
  left: number; // seconds left
  me: SnapSelf;
  p: SnapPlayer[]; // visible others (+ self entry for convenience)
  g: GenState[];
  gate: 0 | 1 | 2 | 3; // 0 locked,1 powered,2 opening(progress in gp),3 open
  gp: number;
  seals: { occ: number; prog: number }[]; // occupant id or -1; rescue progress 0..1
  fx: { zones: Zone[]; sigils: Sigil[]; decoys: Decoy[] };
  ev: GameEvent[];
  team: { i: number; s: SurvState; st: number; rp: number }[];
  terror: number; // 0..1 proximity of killer for survivors (heartbeat)
  // killer-private info
  pings?: { x: number; z: number; l: number }[];
  trace?: { pts: { x: number; z: number }[] }[];
  marks?: { x: number; z: number; l: number }[];
}

export type GameEvent =
  | { k: 'snd'; s: string; x: number; z: number; v?: number } // positional sound
  | { k: 'ab'; i: number; slot: number; n: string; x: number; z: number; ph: 'start' | 'fire' }
  | { k: 'hit'; i: number }
  | { k: 'cap'; i: number; by: number; stage: number }
  | { k: 'rescue'; i: number; by: number }
  | { k: 'out'; i: number }
  | { k: 'esc'; i: number }
  | { k: 'gen'; n: number; done: number }
  | { k: 'gate'; s: number }
  | { k: 'msg'; s: string }
  | { k: 'chat'; i: number; id: number }
  | { k: 'uncanny'; on: number };

export type ServerMsg =
  | { t: 'welcome'; token: string; profile: ProfileInfo; v: number; serverTime: number }
  | { t: 'err'; code: string; msg: string }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'pickkiller'; seconds: number }
  | InitMsg
  | SnapMsg
  | { t: 'end'; result: 'survivors' | 'killer' | 'aborted'; escaped: number; rewards: { xp: number; level: number; levelUp: boolean; lines: string[] }; stats: { i: number; name: string; role: 'S' | 'K'; state: string; gens: number; rescues: number; caps: number }[]; killer: KillerId }
  | { t: 'pong'; c: number; s: number }
  | { t: 'profile'; profile: ProfileInfo };
