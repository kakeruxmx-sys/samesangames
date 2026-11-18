// PROPNIGHT 2 - shared constants. Used by BOTH server (authoritative) and client (prediction/UI).
// Any value that changes gameplay lives here so the two sides can never disagree.

export const GAME_TITLE = 'PROPNIGHT 2';
export const GAME_SUBTITLE = 'THE NIGHTMARE RETURNS';
export const PROTOCOL_VERSION = 1;

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAP_EVERY = 2; // snapshot every N ticks => 15 Hz
export const CELL = 2; // metres per map cell
export const WALL_H = 3.2;

export const PLAYERS_PER_MATCH = 5; // 1 killer + 4 survivors, ALL human
export const SURVIVOR_COUNT = 4;
export const MATCH_SECONDS = 15 * 60;
export const RECONNECT_GRACE_S = 60;
export const NAME_MAX = 16;

export const LOBBY = {
  countdownS: 5, // after 5 humans are present
  killerPickS: 20, // killer chooses their killer type
  introS: 4,
  resultsS: 15,
  roomCodeLen: 4,
};

export const RULES = {
  playerRadius: 0.35,
  killerRadius: 0.42,
  eyeHeight: 1.6,
  eyeHeightCrouch: 1.1,

  survivorWalk: 3.4,
  survivorRun: 4.9,
  survivorCrouch: 1.8,
  killerSpeed: 4.7,
  disguisedBase: 2.4, // multiplied by the prop's mobility

  staminaMax: 100,
  runDrain: 20, // per second
  regenWalk: 10,
  regenIdle: 22,
  exhaustRecover: 25, // exhausted until stamina reaches this

  // transformation
  transformInS: 0.5,
  transformOutS: 0.4,
  transformCooldownS: 3,
  transformRange: 3.2,
  transformArcRad: 0.9,

  // generators / gate
  genCount: 5,
  genRequired: 4,
  genRepairS: 28, // single survivor, uninterrupted
  genSecondRepairerBonus: 0.5,
  genRange: 1.7,
  gateOpenS: 6,
  gateRange: 2.4,
  exitRange: 2.2,

  // capture / seal / rescue
  sealTimeoutS: 45,
  rescueS: 4,
  rescueRange: 1.9,
  protectedS: 6,
  maxCaptures: 2, // 0 captures = stage 1 (normal), 1 = stage 2 (danger), 2 = eliminated (stage 3)

  // killer base attack (shared by all five killers)
  attackWindupS: 0.25,
  attackRange: 2.3,
  attackArcRad: 0.95, // half-angle (~54 deg)
  attackRecoverHitS: 0.7,
  attackRecoverMissS: 1.4,
  attackRecoverSpeedMul: 0.4,
  castingSpeedMul: 0.5, // slowed while winding up an ability (telegraph)

  // fairness for disguise: killer "senses" a disguised survivor this close (no direction)
  senseRadius: 5,

  // visibility culling (anti wall-hack): entities beyond LOS+range are NOT sent at all
  viewRange: 42,
  closeRange: 4,
  terrorRadius: 22,

  // hearing radii for footsteps
  hearWalk: 10,
  hearRun: 20,
  hearKiller: 26,
  hearDisguisedMove: 6,

  // survivors win if at least this many escape
  survivorsNeededToWin: 2,
};

export const XP = {
  win: 100,
  loss: 40,
  perGen: 15,
  perRescue: 30,
  escape: 60,
  perCapture: 25,
  perElimination: 40,
  aborted: 20,
};

export type Role = 'S' | 'K';
export type SurvState = 'alive' | 'sealed' | 'eliminated' | 'escaped';
export type Phase = 'waiting' | 'ready' | 'roles' | 'intro' | 'playing' | 'ended';
export type MapId = 'school' | 'hotel' | 'factory' | 'mall';
export const MAP_IDS: MapId[] = ['school', 'hotel', 'factory', 'mall'];

/** 8 original survivor appearances (face/hair/outfit/build all differ). */
export interface SurvivorLook {
  id: number;
  name: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'bald' | 'curly' | 'ponytail' | 'beanie';
  shirt: string;
  pants: string;
  shoes: string;
  height: number; // multiplier
  width: number; // multiplier
  faceW: number; // head width multiplier
  eyeSpacing: number;
  eyeColor: string;
  accessory: 'none' | 'glasses' | 'backpack' | 'scarf' | 'headband';
}

export const SURVIVOR_LOOKS: SurvivorLook[] = [
  { id: 0, name: 'MIO', skin: '#f1c9a5', hair: '#2a1a14', hairStyle: 'ponytail', shirt: '#c9433a', pants: '#2c3a52', shoes: '#eeeeee', height: 0.96, width: 0.94, faceW: 0.95, eyeSpacing: 0.9, eyeColor: '#3a2418', accessory: 'headband' },
  { id: 1, name: 'KAI', skin: '#d9a679', hair: '#121212', hairStyle: 'short', shirt: '#3a6ea5', pants: '#4a4a4a', shoes: '#222222', height: 1.06, width: 1.05, faceW: 1.05, eyeSpacing: 1.0, eyeColor: '#201810', accessory: 'backpack' },
  { id: 2, name: 'RIN', skin: '#f6d9c2', hair: '#7a3b2e', hairStyle: 'long', shirt: '#4d8f6a', pants: '#e8e2d4', shoes: '#8a5a3c', height: 0.99, width: 0.92, faceW: 0.9, eyeSpacing: 1.1, eyeColor: '#2d5b3a', accessory: 'scarf' },
  { id: 3, name: 'TAKU', skin: '#b98560', hair: '#1a1410', hairStyle: 'curly', shirt: '#e0b43a', pants: '#2a2a35', shoes: '#c8c8c8', height: 1.1, width: 1.12, faceW: 1.12, eyeSpacing: 1.05, eyeColor: '#1a120c', accessory: 'none' },
  { id: 4, name: 'YUI', skin: '#efc3a0', hair: '#d8c08a', hairStyle: 'bun', shirt: '#8b5fb5', pants: '#1f2a38', shoes: '#444444', height: 0.93, width: 0.9, faceW: 0.88, eyeSpacing: 0.95, eyeColor: '#4a6aa0', accessory: 'glasses' },
  { id: 5, name: 'SORA', skin: '#e2b48c', hair: '#3b2f2a', hairStyle: 'cap', shirt: '#2d2d2d', pants: '#5a6a3a', shoes: '#7a4a2a', height: 1.02, width: 1.0, faceW: 1.0, eyeSpacing: 1.0, eyeColor: '#2a1c12', accessory: 'none' },
  { id: 6, name: 'HARU', skin: '#c99a74', hair: '#8a8a8a', hairStyle: 'bald', shirt: '#a35d3a', pants: '#3a3a3a', shoes: '#2a2a2a', height: 1.04, width: 1.18, faceW: 1.15, eyeSpacing: 0.98, eyeColor: '#2a2a20', accessory: 'glasses' },
  { id: 7, name: 'NANA', skin: '#f3d0b8', hair: '#101820', hairStyle: 'beanie', shirt: '#d97a9a', pants: '#455a7a', shoes: '#f0f0f0', height: 0.9, width: 0.88, faceW: 0.92, eyeSpacing: 1.08, eyeColor: '#1a2a3a', accessory: 'scarf' },
];

export const CHAT_PRESETS = [
  'ここにいる！',
  'キラーが近い！',
  '発電機を直すよ',
  '助けに行く！',
  'ありがとう',
  '逃げろ！',
];

export const BANNED_WORDS = ['fuck', 'shit', 'nigg', 'nazi', 'hitler', 'rape', 'sex', 'porn', 'kill yourself', 'しね', '死ね', 'ころす', '殺す', 'ちんこ', 'まんこ', 'ばか', 'あほ'];

export function xpToLevel(xp: number): number {
  return 1 + Math.floor(Math.sqrt(xp / 60));
}
export function levelStartXp(level: number): number {
  return Math.round((level - 1) * (level - 1) * 60);
}
