// 35 transformable prop types. Each is built from simple primitives so server (collision radius, mobility)
// and client (geometry) share one definition. Units: metres, y up, origin at floor centre.

export type Shape = 'b' | 'c' | 's' | 'k'; // box, cylinder, sphere, cone
export type MatKind = 'wood' | 'metal' | 'cloth' | 'plastic' | 'glass' | 'stone' | 'foliage' | 'paper';

export interface Part {
  s: Shape;
  p: [number, number, number]; // centre
  z: [number, number, number]; // size (box w,h,d | cyl dx,h,dz | sphere dx,dy,dz | cone base dx,h,dz)
  c: string;
  m: MatKind;
  e?: number; // emissive 0..1
  ry?: number; // rotation about y (radians)
  rz?: number;
}

export interface PropDef {
  id: number;
  key: string;
  name: string;
  jp: string;
  r: number; // collision / standing radius
  h: number; // height (for camera framing/limits)
  mob: number; // mobility 0..1 multiplier on disguised walk speed (big = slow)
  parts: Part[];
}

const B = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, m: MatKind = 'wood', e = 0, ry = 0): Part => ({ s: 'b', p: [x, y, z], z: [w, h, d], c, m, e, ry });
const C = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, m: MatKind = 'metal', e = 0): Part => ({ s: 'c', p: [x, y, z], z: [w, h, d], c, m, e });
const S = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, m: MatKind = 'plastic', e = 0): Part => ({ s: 's', p: [x, y, z], z: [w, h, d], c, m, e });
const K = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, m: MatKind = 'plastic', e = 0): Part => ({ s: 'k', p: [x, y, z], z: [w, h, d], c, m, e });

const legs4 = (w: number, d: number, h: number, t: number, c: string, m: MatKind = 'wood'): Part[] => [
  B(-w / 2 + t / 2, h / 2, -d / 2 + t / 2, t, h, t, c, m), B(w / 2 - t / 2, h / 2, -d / 2 + t / 2, t, h, t, c, m),
  B(-w / 2 + t / 2, h / 2, d / 2 - t / 2, t, h, t, c, m), B(w / 2 - t / 2, h / 2, d / 2 - t / 2, t, h, t, c, m),
];

let _id = 0;
const def = (key: string, name: string, jp: string, r: number, h: number, mob: number, parts: Part[]): PropDef => ({ id: _id++, key, name, jp, r, h, mob, parts });

export const PROPS: PropDef[] = [
  def('chair', 'Chair', '椅子', 0.3, 0.95, 0.95, [B(0, 0.45, 0, 0.45, 0.05, 0.45, '#8a5a34'), B(0, 0.75, -0.2, 0.45, 0.5, 0.05, '#7a4a28'), ...legs4(0.45, 0.45, 0.43, 0.05, '#6a4020')]),
  def('desk', 'School Desk', '机', 0.45, 0.78, 0.85, [B(0, 0.74, 0, 0.7, 0.04, 0.5, '#b08a5c'), B(0, 0.3, 0, 0.6, 0.03, 0.4, '#8a8f95', 'metal'), ...legs4(0.66, 0.46, 0.72, 0.035, '#777c82', 'metal')]),
  def('sofa', 'Sofa', 'ソファ', 0.9, 0.9, 0.35, [B(0, 0.25, 0, 1.9, 0.4, 0.85, '#6b3b3b', 'cloth'), B(0, 0.68, -0.34, 1.9, 0.5, 0.2, '#7a4545', 'cloth'), B(-0.92, 0.45, 0, 0.2, 0.35, 0.85, '#7a4545', 'cloth'), B(0.92, 0.45, 0, 0.2, 0.35, 0.85, '#7a4545', 'cloth'), B(-0.45, 0.5, 0.05, 0.85, 0.12, 0.65, '#8a5252', 'cloth'), B(0.45, 0.5, 0.05, 0.85, 0.12, 0.65, '#8a5252', 'cloth')]),
  def('cardboard', 'Cardboard Box', '段ボール', 0.42, 0.6, 0.75, [B(0, 0.3, 0, 0.7, 0.6, 0.6, '#b9915a', 'paper'), B(0, 0.61, 0, 0.7, 0.02, 0.1, '#d8c79a', 'paper'), B(0, 0.3, 0.301, 0.1, 0.6, 0.004, '#d8c79a', 'paper')]),
  def('trashcan', 'Trash Can', 'ゴミ箱', 0.28, 0.75, 0.9, [C(0, 0.35, 0, 0.5, 0.7, 0.5, '#5d6770'), C(0, 0.72, 0, 0.54, 0.06, 0.54, '#4a525a'), C(0, 0.35, 0, 0.52, 0.05, 0.52, '#3f464d')]),
  def('books', 'Book Stack', '本', 0.22, 0.22, 1.0, [B(0, 0.04, 0, 0.32, 0.07, 0.24, '#8a2a2a', 'paper'), B(0.02, 0.105, 0, 0.3, 0.06, 0.22, '#2a4a7a', 'paper'), B(-0.01, 0.165, 0, 0.28, 0.05, 0.21, '#c9a64a', 'paper')]),
  def('vase', 'Vase', '花瓶', 0.22, 0.75, 0.9, [S(0, 0.3, 0, 0.42, 0.5, 0.42, '#3a6a8a', 'glass'), C(0, 0.58, 0, 0.14, 0.2, 0.14, '#3a6a8a', 'glass'), C(0, 0.7, 0, 0.22, 0.06, 0.22, '#3a6a8a', 'glass'), C(0.03, 0.86, 0, 0.02, 0.35, 0.02, '#3a6b2a', 'foliage'), S(0.03, 1.05, 0, 0.14, 0.12, 0.14, '#c95a6a', 'cloth')]),
  def('lamp', 'Floor Lamp', 'ランプ', 0.22, 1.6, 0.85, [C(0, 0.03, 0, 0.35, 0.06, 0.35, '#2a2a2a'), C(0, 0.8, 0, 0.04, 1.5, 0.04, '#3a3a3a'), K(0, 1.5, 0, 0.5, 0.35, 0.5, '#e8d29a', 'cloth', 0.6)]),
  def('table', 'Table', 'テーブル', 0.7, 0.78, 0.5, [B(0, 0.75, 0, 1.4, 0.05, 0.8, '#7a5a3a'), ...legs4(1.34, 0.74, 0.73, 0.07, '#5e4228')]),
  def('clock', 'Grandfather Clock', '時計', 0.3, 2.0, 0.4, [B(0, 0.95, 0, 0.5, 1.9, 0.35, '#4a2f1e'), C(0, 1.55, 0.18, 0.34, 0.03, 0.34, '#e8e2c8', 'metal', 0.15), B(0, 0.7, 0.18, 0.3, 0.7, 0.02, '#2a1a10', 'glass'), C(0, 0.55, 0.19, 0.12, 0.02, 0.12, '#c9a64a', 'metal')]),
  def('plant', 'Potted Plant', '観葉植物', 0.35, 1.25, 0.8, [C(0, 0.18, 0, 0.36, 0.36, 0.36, '#8a4a30', 'stone'), S(0, 0.7, 0, 0.6, 0.6, 0.6, '#2f6a35', 'foliage'), S(0.12, 1.0, 0.05, 0.4, 0.4, 0.4, '#3a7a3a', 'foliage'), S(-0.12, 0.95, -0.08, 0.35, 0.35, 0.35, '#2a5a2a', 'foliage')]),
  def('locker', 'Locker', 'ロッカー', 0.32, 1.85, 0.4, [B(0, 0.92, 0, 0.5, 1.84, 0.5, '#5a6a7a', 'metal'), B(0, 1.45, 0.251, 0.36, 0.02, 0.01, '#2a2f35', 'metal'), B(0, 1.35, 0.251, 0.36, 0.02, 0.01, '#2a2f35', 'metal'), B(0.15, 1.0, 0.255, 0.05, 0.12, 0.02, '#c8c8c8', 'metal'), B(0, 0.35, 0.251, 0.4, 0.5, 0.005, '#4a5a6a', 'metal')]),
  def('tv', 'Television', 'テレビ', 0.5, 1.15, 0.45, [B(0, 0.25, 0, 0.9, 0.5, 0.4, '#3a2a20'), B(0, 0.82, 0, 0.9, 0.55, 0.12, '#151515', 'plastic'), B(0, 0.82, 0.062, 0.8, 0.46, 0.01, '#1a2a30', 'glass', 0.15)]),
  def('teddy', 'Teddy Bear', 'おもちゃ', 0.26, 0.6, 1.0, [S(0, 0.25, 0, 0.4, 0.45, 0.35, '#9a6a3a', 'cloth'), S(0, 0.55, 0, 0.3, 0.28, 0.28, '#9a6a3a', 'cloth'), S(-0.12, 0.7, 0, 0.12, 0.12, 0.1, '#9a6a3a', 'cloth'), S(0.12, 0.7, 0, 0.12, 0.12, 0.1, '#9a6a3a', 'cloth'), S(-0.24, 0.3, 0.05, 0.14, 0.26, 0.14, '#9a6a3a', 'cloth'), S(0.24, 0.3, 0.05, 0.14, 0.26, 0.14, '#9a6a3a', 'cloth'), S(0, 0.52, 0.12, 0.1, 0.08, 0.08, '#d8b88a', 'cloth')]),
  def('screen', 'Folding Screen', 'カーテン', 0.6, 1.7, 0.5, [B(-0.4, 0.85, 0.05, 0.4, 1.6, 0.04, '#7a2f4a', 'cloth', 0, 0.35), B(0, 0.85, -0.05, 0.42, 1.6, 0.04, '#8a3a56', 'cloth', 0, -0.35), B(0.4, 0.85, 0.05, 0.4, 1.6, 0.04, '#7a2f4a', 'cloth', 0, 0.35), B(0, 1.68, 0, 1.3, 0.04, 0.06, '#3a2a1a')]),
  def('umbrella', 'Umbrella Stand', '傘立て', 0.22, 0.95, 0.9, [C(0, 0.25, 0, 0.3, 0.5, 0.3, '#4a4f55'), C(-0.05, 0.7, 0.02, 0.04, 0.9, 0.04, '#1f3a6a', 'cloth'), C(0.06, 0.65, -0.03, 0.04, 0.8, 0.04, '#6a1f2a', 'cloth'), K(0, 0.2, 0, 0.1, 0.1, 0.1, '#222', 'plastic')]),
  def('bucket', 'Bucket', 'バケツ', 0.25, 0.4, 1.0, [K(0, 0.2, 0, 0.5, 0.4, 0.5, '#3a6aa5', 'metal'), C(0, 0.38, 0, 0.5, 0.04, 0.5, '#2f5585', 'metal')]),
  def('shelf', 'Bookshelf', '棚', 0.7, 1.95, 0.25, [B(0, 0.97, 0, 1.2, 1.94, 0.35, '#6a4a2e'), B(0, 0.5, 0.01, 1.1, 0.03, 0.32, '#4a321e'), B(0, 1.0, 0.01, 1.1, 0.03, 0.32, '#4a321e'), B(0, 1.5, 0.01, 1.1, 0.03, 0.32, '#4a321e'), B(-0.3, 0.7, 0.04, 0.4, 0.3, 0.2, '#7a2a2a', 'paper'), B(0.25, 1.25, 0.04, 0.5, 0.3, 0.2, '#2a4a6a', 'paper'), B(-0.2, 1.75, 0.04, 0.6, 0.3, 0.2, '#6a6a2a', 'paper')]),
  def('crate', 'Wooden Crate', '箱', 0.5, 0.8, 0.6, [B(0, 0.4, 0, 0.8, 0.8, 0.8, '#9a7a4a'), B(0, 0.4, 0.402, 0.8, 0.08, 0.01, '#6a4f2a'), B(0, 0.12, 0.402, 0.8, 0.08, 0.01, '#6a4f2a'), B(0, 0.68, 0.402, 0.8, 0.08, 0.01, '#6a4f2a')]),
  def('statue', 'Ornament Statue', '置物', 0.3, 1.2, 0.6, [C(0, 0.3, 0, 0.5, 0.6, 0.5, '#b8b4aa', 'stone'), K(0, 0.9, 0, 0.4, 0.6, 0.3, '#d8d4c8', 'stone'), S(0, 1.2, 0, 0.26, 0.28, 0.26, '#d8d4c8', 'stone')]),
  def('cushion', 'Floor Cushion', 'クッション', 0.3, 0.14, 1.0, [C(0, 0.07, 0, 0.55, 0.14, 0.55, '#a5445a', 'cloth'), S(0, 0.15, 0, 0.1, 0.04, 0.1, '#8a3248', 'cloth')]),
  def('suitcase', 'Suitcase', 'スーツケース', 0.38, 0.95, 0.65, [B(0, 0.38, 0, 0.6, 0.76, 0.26, '#3a4a6a', 'plastic'), B(0, 0.85, 0, 0.3, 0.12, 0.04, '#222222', 'metal'), B(0, 0.38, 0.131, 0.5, 0.02, 0.01, '#222', 'metal'), C(-0.2, 0.02, 0.1, 0.06, 0.04, 0.06, '#111'), C(0.2, 0.02, 0.1, 0.06, 0.04, 0.06, '#111')]),
  def('chest', 'Storage Chest', '小型収納箱', 0.5, 0.55, 0.6, [B(0, 0.22, 0, 0.9, 0.44, 0.5, '#7a5a3a'), B(0, 0.5, 0, 0.92, 0.12, 0.52, '#6a4a2a'), B(0, 0.36, 0.26, 0.12, 0.1, 0.02, '#c9a64a', 'metal')]),
  def('candle', 'Candle Stand', '室内装飾品', 0.2, 1.0, 0.95, [C(0, 0.04, 0, 0.3, 0.08, 0.3, '#3a3a3a'), C(0, 0.45, 0, 0.05, 0.8, 0.05, '#3a3a3a'), C(0, 0.9, 0, 0.14, 0.1, 0.14, '#8a6a2a'), C(0, 0.98, 0, 0.05, 0.12, 0.05, '#e8e0c8', 'paper'), S(0, 1.07, 0, 0.05, 0.08, 0.05, '#ffcf70', 'plastic', 1)]),
  def('stool', 'Piano Stool', '丸椅子', 0.25, 0.55, 1.0, [C(0, 0.5, 0, 0.42, 0.08, 0.42, '#6a2f2f', 'cloth'), C(0, 0.25, 0, 0.06, 0.45, 0.06, '#2a2a2a'), C(0, 0.02, 0, 0.36, 0.04, 0.36, '#2a2a2a')]),
  def('barrel', 'Barrel', '樽', 0.37, 0.9, 0.55, [C(0, 0.45, 0, 0.7, 0.9, 0.7, '#6a4a2a'), C(0, 0.15, 0, 0.74, 0.04, 0.74, '#3a3a3a', 'metal'), C(0, 0.75, 0, 0.74, 0.04, 0.74, '#3a3a3a', 'metal')]),
  def('cabinet', 'Filing Cabinet', '書類棚', 0.38, 1.3, 0.45, [B(0, 0.65, 0, 0.45, 1.3, 0.6, '#7d838a', 'metal'), B(0, 0.25, 0.301, 0.38, 0.02, 0.005, '#222', 'metal'), B(0, 0.65, 0.301, 0.38, 0.02, 0.005, '#222', 'metal'), B(0, 1.05, 0.301, 0.38, 0.02, 0.005, '#222', 'metal'), B(0, 0.45, 0.31, 0.1, 0.03, 0.02, '#ccc', 'metal'), B(0, 0.85, 0.31, 0.1, 0.03, 0.02, '#ccc', 'metal')]),
  def('globe', 'Globe', '地球儀', 0.3, 0.9, 0.9, [C(0, 0.03, 0, 0.35, 0.06, 0.35, '#3a2a1a'), C(0, 0.35, 0, 0.04, 0.6, 0.04, '#3a2a1a'), S(0, 0.65, 0, 0.5, 0.5, 0.5, '#3a6a9a', 'plastic'), S(0.05, 0.68, 0.1, 0.28, 0.2, 0.2, '#4a8a4a', 'plastic')]),
  def('extinguisher', 'Fire Extinguisher', '消火器', 0.2, 0.6, 1.0, [C(0, 0.25, 0, 0.16, 0.5, 0.16, '#b5271f'), C(0, 0.52, 0, 0.06, 0.08, 0.06, '#222'), B(0.06, 0.55, 0, 0.1, 0.03, 0.03, '#222', 'metal')]),
  def('mannequin', 'Mannequin', 'マネキン', 0.28, 1.75, 0.5, [C(0, 0.04, 0, 0.4, 0.08, 0.4, '#2a2a2a'), C(0, 0.45, 0, 0.14, 0.8, 0.14, '#cfc9bd', 'plastic'), S(0, 1.1, 0, 0.44, 0.6, 0.26, '#d8d2c6', 'plastic'), S(0, 1.55, 0, 0.2, 0.26, 0.2, '#d8d2c6', 'plastic'), C(-0.28, 1.05, 0, 0.09, 0.6, 0.09, '#d8d2c6', 'plastic'), C(0.28, 1.05, 0, 0.09, 0.6, 0.09, '#d8d2c6', 'plastic')]),
  def('blocks', 'Toy Blocks', 'つみき', 0.3, 0.5, 1.0, [B(-0.1, 0.1, 0, 0.2, 0.2, 0.2, '#d9443a', 'plastic'), B(0.12, 0.1, 0.04, 0.2, 0.2, 0.2, '#3a74d9', 'plastic'), B(0, 0.3, 0.02, 0.2, 0.2, 0.2, '#e6c93a', 'plastic'), K(0, 0.5, 0.02, 0.2, 0.18, 0.2, '#3ab35a', 'plastic')]),
  def('horse', 'Rocking Horse', '木馬', 0.42, 1.0, 0.55, [B(0, 0.55, 0, 0.3, 0.3, 0.8, '#a5734a'), B(0, 0.8, 0.4, 0.2, 0.4, 0.22, '#a5734a'), B(0, 0.98, 0.5, 0.14, 0.14, 0.3, '#a5734a'), B(0, 0.1, -0.1, 0.1, 0.06, 1.0, '#6a4528'), B(-0.1, 0.28, 0, 0.04, 0.4, 0.04, '#6a4528'), B(0.1, 0.28, 0, 0.04, 0.4, 0.04, '#6a4528')]),
  def('cooler', 'Water Cooler', '給水機', 0.3, 1.5, 0.55, [B(0, 0.45, 0, 0.35, 0.9, 0.35, '#d8dde0', 'plastic'), C(0, 1.2, 0, 0.3, 0.45, 0.3, '#6aa5d9', 'glass'), B(0, 0.7, 0.18, 0.1, 0.05, 0.04, '#3a74d9', 'plastic')]),
  def('cone', 'Traffic Cone', 'コーン', 0.22, 0.7, 1.0, [B(0, 0.02, 0, 0.4, 0.04, 0.4, '#d85a1a', 'plastic'), K(0, 0.36, 0, 0.32, 0.64, 0.32, '#e8651e', 'plastic'), C(0, 0.4, 0, 0.19, 0.08, 0.19, '#eeeeee', 'plastic')]),
  def('beanbag', 'Bean Bag', 'ビーズクッション', 0.45, 0.6, 0.7, [S(0, 0.28, 0, 0.9, 0.58, 0.85, '#3a8a7a', 'cloth'), S(0.1, 0.45, -0.1, 0.5, 0.3, 0.45, '#3a8a7a', 'cloth')]),
];

export const PROP_COUNT = PROPS.length;
export function propByKey(key: string): PropDef {
  const p = PROPS.find((x) => x.key === key);
  if (!p) throw new Error('unknown prop ' + key);
  return p;
}
export const K_ = (k: string) => propByKey(k).id;
