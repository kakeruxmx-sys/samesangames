// Five original killers. Names/designs are original to this project (see docs/DESIGN.md).
// All numbers come from the spec; windup = telegraph time (survivors get a warning event + the killer is slowed).

export type KillerId = 'echo' | 'stitcher' | 'mimic' | 'chronos' | 'lumen';
export const KILLER_IDS: KillerId[] = ['echo', 'stitcher', 'mimic', 'chronos', 'lumen'];

export interface AbilityDef {
  slot: 0 | 1 | 2; // ab1/ab2/ab3
  id: string;
  name: string;
  desc: string;
  cooldown: number; // seconds
  windup: number; // telegraph seconds before the effect applies
  duration: number; // effect seconds (0 = instant)
  range?: number; // aim distance along the killer's facing
  radius?: number;
}

export interface KillerDef {
  id: KillerId;
  index: number;
  name: string;
  jp: string;
  blurb: string;
  strengths: string[];
  weaknesses: string[];
  counters: string[];
  stats: { difficulty: number; mobility: number; detection: number; disruption: number }; // 1..5
  color: string; // UI accent
  abilities: [AbilityDef, AbilityDef, AbilityDef];
}

export const KILLERS: Record<KillerId, KillerDef> = {
  echo: {
    id: 'echo', index: 0, name: 'THE ECHO', jp: '残響の巡礼者',
    blurb: '音を頼りに獲物を探す、異様に長い影。動く者の気配は、壁の向こうでも聞き逃さない。',
    strengths: ['索敵能力が高い', '中距離の追跡が得意'], weaknesses: ['止まっている相手を捉えにくい', '能力の発動音で位置がばれる'],
    counters: ['停止して音の反応を減らす', '発動音を聞いて距離を取る', '狭い場所での追跡を避ける'],
    stats: { difficulty: 2, mobility: 3, detection: 5, disruption: 3 }, color: '#7fd0ff',
    abilities: [
      { slot: 0, id: 'resonance_scan', name: 'RESONANCE SCAN', desc: '音の波を放ち、動いている生存者の位置を一瞬だけ反応として捉える。停止中は映らない。', cooldown: 25, windup: 0.5, duration: 2.5, radius: 26 },
      { slot: 1, id: 'sound_pressure', name: 'SOUND PRESSURE', desc: '前方に音圧を放つ。命中した生存者は視界と音が乱れる。変身中でも効くが位置は特定できない。', cooldown: 30, windup: 0.7, duration: 4, range: 11, radius: 0.6 },
      { slot: 2, id: 'echo_step', name: 'ECHO STEP', desc: '音の波に乗って前方へ高速移動する。発動前に特徴的な音が鳴る。', cooldown: 20, windup: 0.6, duration: 2 },
    ],
  },
  stitcher: {
    id: 'stitcher', index: 1, name: 'THE STITCHER', jp: '縫影の人形師',
    blurb: '糸と紋章で通り道を縫い止める人形。待ち伏せと場所の制圧に長ける。',
    strengths: ['罠による索敵', '待ち伏せ・場所の制圧'], weaknesses: ['紋章は目で見て避けられる', '追跡力は平凡'],
    counters: ['紋章を確認する', '設置物から離れる', '音だけを頼りに行動しない'],
    stats: { difficulty: 3, mobility: 3, detection: 3, disruption: 4 }, color: '#e0a0ff',
    abilities: [
      { slot: 0, id: 'shadow_thread', name: 'SHADOW THREAD', desc: '前方に紋章を設置（最大3）。生存者が通るとキラーに通知される。紋章は目で見える。', cooldown: 20, windup: 0.6, duration: 0, range: 5, radius: 2.2 },
      { slot: 1, id: 'phase_drift', name: 'PHASE DRIFT', desc: '半透明になり移動が速くなる。使用中は攻撃できず、光の粒子の跡が残る。', cooldown: 25, windup: 0.5, duration: 4 },
      { slot: 2, id: 'false_path', name: 'FALSE PATH', desc: '指定地点に偽の足音を鳴らす。位置を直接特定する効果はない。', cooldown: 30, windup: 0.4, duration: 5, range: 14 },
    ],
  },
  mimic: {
    id: 'mimic', index: 2, name: 'THE MIMIC', jp: '模倣する異形',
    blurb: '物にも人にもなりすます、顔のパーツがずれた異形。見つけるのではなく、見抜かれないことが武器。',
    strengths: ['擬態による奇襲', '心理戦'], weaknesses: ['擬態中は動きに違和感が出る', '擬態に時間制限がある'],
    counters: ['擬態中のわずかな違和感を見つける', '仲間同士で位置を確認する', '装置の異常を仲間に知らせる'],
    stats: { difficulty: 5, mobility: 3, detection: 2, disruption: 4 }, color: '#8cff9a',
    abilities: [
      { slot: 0, id: 'object_mimic', name: 'OBJECT MIMIC', desc: '近くの物の姿になる（最大12秒）。移動すると輪郭がわずかに揺らぐ。攻撃すると解除。', cooldown: 25, windup: 0.8, duration: 12, range: 4 },
      { slot: 1, id: 'false_survivor', name: 'FALSE SURVIVOR', desc: '生存者の姿を10秒間まねる。完全ではなく、名前表示と動きに違和感が残る。', cooldown: 35, windup: 0.8, duration: 10 },
      { slot: 2, id: 'machine_distortion', name: 'MACHINE DISTORTION', desc: '近くの発電機に異常を起こし、修理速度を8秒間低下させる（停止はしない）。', cooldown: 35, windup: 0.7, duration: 8, range: 26 },
    ],
  },
  chronos: {
    id: 'chronos', index: 3, name: 'THE CHRONOS', jp: '時層の監視者',
    blurb: '時間の流れを歪める監視者。追うよりも、試合全体のテンポを乱すことを得意とする。',
    strengths: ['進行妨害', 'エリア管理'], weaknesses: ['直接の追跡力は低い', '領域は見て避けられる'],
    counters: ['時間領域から離れる', '残像の動作や影を確認する', '移動経路を変更する'],
    stats: { difficulty: 4, mobility: 2, detection: 3, disruption: 5 }, color: '#ffd36b',
    abilities: [
      { slot: 0, id: 'time_field', name: 'TIME FIELD', desc: '指定場所に時間の遅い領域を作る。中の生存者は移動・作業が遅くなる（停止はしない）。', cooldown: 35, windup: 0.7, duration: 5, range: 10, radius: 5 },
      { slot: 1, id: 'afterimage', name: 'AFTERIMAGE', desc: '自分の残像を別方向へ走らせる。残像は攻撃も捕獲もできない。', cooldown: 30, windup: 0.5, duration: 5 },
      { slot: 2, id: 'time_trace', name: 'TIME TRACE', desc: '直近8秒の大きな移動の痕跡を3秒だけ表示する。現在地は示さない。', cooldown: 40, windup: 0.6, duration: 3 },
    ],
  },
  lumen: {
    id: 'lumen', index: 4, name: 'THE LUMEN', jp: '光を喰らう者',
    blurb: '光を吸い、闇を広げる影。照明と視界を支配して追い詰める。',
    strengths: ['暗闇の利用', '視界妨害'], weaknesses: ['明るい場所では効果が薄い', '暗い領域は外から見える'],
    counters: ['明るい場所へ移動する', '光の痕跡が残らない経路を選ぶ', '暗い領域に長く留まらない'],
    stats: { difficulty: 3, mobility: 3, detection: 3, disruption: 4 }, color: '#b36bff',
    abilities: [
      { slot: 0, id: 'blackout', name: 'BLACKOUT', desc: '範囲内の照明を6秒間弱める。完全な暗闇にはならず、周囲は見える。', cooldown: 35, windup: 0.7, duration: 6, range: 6, radius: 12 },
      { slot: 1, id: 'lumen_trace', name: 'LUMEN TRACE', desc: '光の粒子を放つ。触れた生存者は通過した場所に光の痕跡を残す（現在地ではない）。', cooldown: 30, windup: 0.5, duration: 5, radius: 7 },
      { slot: 2, id: 'dark_zone', name: 'DARK ZONE', desc: '指定場所に暗い領域を作る。中の生存者は視界が狭まる。領域は外からも見える。', cooldown: 40, windup: 0.8, duration: 8, range: 10, radius: 4 },
    ],
  },
};

export function abilityOf(k: KillerId, slot: number): AbilityDef | undefined {
  return KILLERS[k]?.abilities[slot];
}
