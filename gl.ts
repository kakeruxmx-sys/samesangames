// Dependency-free WebGL2 renderer for PROPNIGHT 2 (Three.js was not available in the build environment).
// Features: per-pixel multi-light shading (8 lights incl. spot flashlight), procedural material patterns
// (wood / metal / cloth / tile / wallpaper / stone), exponential fog, glossy specular on floors/metal/glass,
// chunked static batching with distance culling, contact-shadow decals, adjustable resolution scale.
import { MatKind, Part, Shape } from '../../shared/props';

export type M4 = Float32Array;
export const m4 = (): M4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

export function ident(o: M4) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; }
export function mul(o: M4, a: M4, b: M4) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const _t = new Float32Array(16);
export function mulTo(o: M4, a: M4, b: M4) { mul(_t, a, b); o.set(_t); return o; }
export function persp(o: M4, fovY: number, aspect: number, n: number, f: number) {
  const t = 1 / Math.tan(fovY / 2);
  o.fill(0); o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
  return o;
}
export function lookAt(o: M4, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number) {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz;
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = zz, xy = 0, xz = -zx; // up=(0,1,0) x z
  l = Math.hypot(xx, xz) || 1; xx /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * ex + xy * ey + xz * ez); o[13] = -(yx * ex + yy * ey + yz * ez); o[14] = -(zx * ex + zy * ey + zz * ez); o[15] = 1;
  return o;
}
/** M = T * Ry * Rx * Rz * S */
export function trs(o: M4, tx: number, ty: number, tz: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1) {
  const cx = Math.cos(rx), sxn = Math.sin(rx), cy = Math.cos(ry), syn = Math.sin(ry), cz = Math.cos(rz), szn = Math.sin(rz);
  // Rx*Rz
  const a00 = cz, a01 = -szn, a02 = 0;
  const a10 = cx * szn, a11 = cx * cz, a12 = -sxn;
  const a20 = sxn * szn, a21 = sxn * cz, a22 = cx;
  // Ry * (Rx*Rz)
  const r00 = cy * a00 + syn * a20, r01 = cy * a01 + syn * a21, r02 = cy * a02 + syn * a22;
  const r10 = a10, r11 = a11, r12 = a12;
  const r20 = -syn * a00 + cy * a20, r21 = -syn * a01 + cy * a21, r22 = -syn * a02 + cy * a22;
  o[0] = r00 * sx; o[1] = r10 * sx; o[2] = r20 * sx; o[3] = 0;
  o[4] = r01 * sy; o[5] = r11 * sy; o[6] = r21 * sy; o[7] = 0;
  o[8] = r02 * sz; o[9] = r12 * sz; o[10] = r22 * sz; o[11] = 0;
  o[12] = tx; o[13] = ty; o[14] = tz; o[15] = 1;
  return o;
}

// ------------------------------------------------------------------ unit geometry
export interface Geo { pos: number[]; nor: number[]; idx: number[] }

function fixWinding(g: Geo) {
  const { pos, nor, idx } = g;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ax = nor[a] + nor[b] + nor[c], ay = nor[a + 1] + nor[b + 1] + nor[c + 1], az = nor[a + 2] + nor[b + 2] + nor[c + 2];
    if (nx * ax + ny * ay + nz * az < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  return g;
}

export function geoBox(): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const faces: [number[], number[], number[], number[], number[]][] = [
    [[1, 0, 0], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]],
    [[-1, 0, 0], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]],
    [[0, 1, 0], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]],
    [[0, -1, 0], [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]],
    [[0, 0, 1], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
    [[0, 0, -1], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
  ];
  for (const f of faces) {
    const b = pos.length / 3;
    for (let i = 1; i <= 4; i++) { pos.push(...f[i]); nor.push(...f[0]); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return fixWinding({ pos, nor, idx });
}
export function geoCyl(seg: number): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * 0.5, -0.5, s * 0.5, c * 0.5, 0.5, s * 0.5); nor.push(c, 0, s, c, 0, s);
  }
  for (let i = 0; i < seg; i++) { const b = i * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
  for (const [y, ny] of [[0.5, 1], [-0.5, -1]] as [number, number][]) {
    const c0 = pos.length / 3; pos.push(0, y, 0); nor.push(0, ny, 0);
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5); nor.push(0, ny, 0); }
    for (let i = 0; i < seg; i++) idx.push(c0, c0 + 1 + i, c0 + 2 + i);
  }
  return fixWinding({ pos, nor, idx });
}
export function geoSphere(lat: number, lon: number): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= lat; i++) {
    const t = (i / lat) * Math.PI, y = Math.cos(t), r = Math.sin(t);
    for (let j = 0; j <= lon; j++) {
      const p = (j / lon) * Math.PI * 2, x = Math.cos(p) * r, z = Math.sin(p) * r;
      pos.push(x * 0.5, y * 0.5, z * 0.5); nor.push(x, y, z);
    }
  }
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = i * (lon + 1) + j, b = a + lon + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return fixWinding({ pos, nor, idx });
}
export function geoCone(seg: number): Geo {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const k = Math.hypot(1, 0.5);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * 0.5, -0.5, s * 0.5, 0, 0.5, 0); nor.push(c / k, 0.5 / k, s / k, c / k, 0.5 / k, s / k);
  }
  for (let i = 0; i < seg; i++) { const b = i * 2; idx.push(b, b + 1, b + 2); }
  const c0 = pos.length / 3; pos.push(0, -0.5, 0); nor.push(0, -1, 0);
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5); nor.push(0, -1, 0); }
  for (let i = 0; i < seg; i++) idx.push(c0, c0 + 1 + i, c0 + 2 + i);
  return fixWinding({ pos, nor, idx });
}

// ------------------------------------------------------------------ materials
export interface Mat { k: number; shine: number; spec: number }
// k: 0 plain, 1 wood, 2 metal, 3 cloth, 4 plastic, 5 glass, 6 stone/concrete, 7 tile, 8 wallpaper, 9 foliage, 10 paper, 11 floorboard
export const MATS: Record<MatKind, Mat> = {
  wood: { k: 1, shine: 18, spec: 0.18 }, metal: { k: 2, shine: 60, spec: 0.7 }, cloth: { k: 3, shine: 4, spec: 0.02 },
  plastic: { k: 4, shine: 40, spec: 0.35 }, glass: { k: 5, shine: 120, spec: 1.0 }, stone: { k: 6, shine: 10, spec: 0.1 },
  foliage: { k: 9, shine: 6, spec: 0.05 }, paper: { k: 10, shine: 4, spec: 0.03 },
};
export const MAT_FLOOR_WOOD: Mat = { k: 11, shine: 50, spec: 0.35 };
export const MAT_FLOOR_TILE: Mat = { k: 7, shine: 90, spec: 0.6 };
export const MAT_FLOOR_CONC: Mat = { k: 6, shine: 45, spec: 0.3 };
export const MAT_WALL_PAPER: Mat = { k: 8, shine: 6, spec: 0.03 };
export const MAT_WALL_CONC: Mat = { k: 6, shine: 8, spec: 0.05 };
export const MAT_CEIL: Mat = { k: 6, shine: 4, spec: 0.02 };

export function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ------------------------------------------------------------------ shaders
const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol; layout(location=3) in vec4 aMat;
uniform mat4 uVP; uniform mat4 uModel; uniform vec4 uMat; uniform float uOv; uniform float uPat;
out vec3 vW; out vec3 vN; out vec3 vC; out vec4 vM; out vec3 vL;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vW = w.xyz; vN = mat3(uModel) * aNor; vC = aCol; vM = uOv > 0.5 ? uMat : aMat; vL = aPos * uPat;
  gl_Position = uVP * w;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in vec4 vM; in vec3 vL;
uniform vec3 uCam; uniform vec4 uTint; uniform float uEmis; uniform float uUnlit; uniform float uTime;
uniform vec3 uFog; uniform float uFogD; uniform float uAmb; uniform vec3 uAmbCol;
uniform int uLn; uniform vec4 uLp[8]; uniform vec4 uLc[8]; uniform vec4 uLd[8];
uniform float uGrain; uniform float uDark;
out vec4 o;
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float vn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
  vec3 N = normalize(vN);
  if(!gl_FrontFacing) N = -N;
  float k = vM.x; vec3 a = vC * uTint.rgb; float shine = vM.y; float spec = vM.z; float emis = vM.w + uEmis;
  vec3 p = vL;
  float n1 = vn(p*7.0), n2 = vn(p*23.0);
  if(k > 0.5 && k < 1.5){ float g = vn(vec3(p.x*3.0, p.y*40.0, p.z*3.0)); a *= 0.8 + 0.35*g + 0.1*n2; }
  else if(k > 10.5){ float b = step(0.5, fract(p.x*1.0)); float g = vn(vec3(p.x*40.0, p.y, p.z*5.0)); float seam = smoothstep(0.0,0.03,abs(fract(p.z*2.0)-0.5)); a *= (0.8+0.3*g) * (0.55+0.45*seam); }
  else if(k > 1.5 && k < 2.5){ float s = vn(vec3(p.x*60.0, p.y*2.0, p.z*60.0)); a *= 0.8 + 0.3*s; }
  else if(k > 2.5 && k < 3.5){ a *= 0.85 + 0.25*vn(p*80.0); }
  else if(k > 5.5 && k < 6.5){ a *= 0.7 + 0.5*n1*n2 + 0.15*n2; }
  else if(k > 6.5 && k < 7.5){ vec2 t = abs(fract(vec2(p.x+p.z, p.z - p.x*0.0)*1.0 + vec2(0.0,p.y*0.0))-0.5); vec2 q = abs(fract(vL.xz*0.9)-0.5); float line = smoothstep(0.46,0.5,max(q.x,q.y)); a *= (1.0-0.5*line) * (0.9+0.2*n2); }
  else if(k > 7.5 && k < 8.5){ float st = 0.5+0.5*sin((p.x+p.z)*55.0); a *= 0.8 + 0.22*st + 0.1*n2; }
  else if(k > 8.5 && k < 9.5){ a *= 0.7 + 0.6*n2; }
  else if(k > 9.5 && k < 10.5){ a *= 0.9 + 0.2*n2; }
  vec3 V = normalize(uCam - vW);
  float dist = length(uCam - vW);
  vec3 col;
  if(uUnlit > 0.5){ col = a * (0.4 + emis); }
  else {
    vec3 amb = uAmbCol * uAmb * (0.55 + 0.45*(N.y*0.5+0.5));
    vec3 diff = amb, sp = vec3(0.0);
    for(int i=0;i<8;i++){
      if(i>=uLn) break;
      vec3 L = uLp[i].xyz - vW; float d = length(L); float r = uLp[i].w;
      if(d > r) continue;
      L /= d;
      float att = 1.0 - d/r; att *= att;
      float sf = 1.0;
      if(uLd[i].w > 0.0){ float c = dot(-L, uLd[i].xyz); sf = smoothstep(uLd[i].w, uLd[i].w+0.12, c); }
      float ndl = max(dot(N,L),0.0);
      vec3 lc = uLc[i].rgb * att * sf;
      diff += lc * ndl;
      vec3 H = normalize(L+V);
      sp += lc * pow(max(dot(N,H),0.0), shine) * spec;
    }
    col = a * diff + sp + a * emis;
  }
  float fd = 1.0 - exp(-pow(dist*uFogD, 2.0));
  col = mix(col, uFog, clamp(fd,0.0,1.0));
  col *= uDark;
  col += (h31(vec3(gl_FragCoord.xy, uTime*60.0)) - 0.5) * uGrain;
  o = vec4(col, uTint.a);
}`;

export interface MeshGPU { vao: WebGLVertexArrayObject; count: number }
export interface Chunk { vao: WebGLVertexArrayObject; count: number; cx: number; cz: number; rad: number }
export interface Light { x: number; y: number; z: number; r: number; c: [number, number, number]; i: number; dx?: number; dy?: number; dz?: number; cut?: number }
export type Rgb = [number, number, number];

export interface Quality {
  name: 'low' | 'medium' | 'high';
  scale: number; // render resolution scale (<=1)
  draw: number; // draw distance (m) for static chunks / dynamic props
  seg: number; // curve segments (LOD)
  lights: number; // max lights
  decals: boolean;
  grain: number;
}
export const QUALITY: Record<Quality['name'], Quality> = {
  low: { name: 'low', scale: 0.6, draw: 30, seg: 8, lights: 4, decals: false, grain: 0 },
  medium: { name: 'medium', scale: 0.85, draw: 42, seg: 12, lights: 6, decals: true, grain: 0.02 },
  high: { name: 'high', scale: 1.0, draw: 60, seg: 18, lights: 8, decals: true, grain: 0.035 },
};

export class Renderer {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  U: Record<string, WebGLUniformLocation | null> = {};
  box!: MeshGPU; cyl!: MeshGPU; sph!: MeshGPU; con!: MeshGPU;
  cylLow!: MeshGPU; sphLow!: MeshGPU;
  vp = m4(); view = m4(); proj = m4(); tmp = m4(); model = m4();
  cam = { x: 0, y: 1.6, z: 0 };
  q: Quality = QUALITY.medium;
  width = 1; height = 1;
  fog: Rgb = [0.02, 0.03, 0.03]; fogD = 0.05; amb = 0.2; ambCol: Rgb = [0.5, 0.55, 0.6];
  time = 0; dark = 1;
  lightsU = { p: new Float32Array(32), c: new Float32Array(32), d: new Float32Array(32) };
  nLights = 0;
  drawCalls = 0;
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.prog = this.link(VS, FS);
    for (const n of ['uVP', 'uModel', 'uMat', 'uOv', 'uPat', 'uCam', 'uTint', 'uEmis', 'uUnlit', 'uTime', 'uFog', 'uFogD', 'uAmb', 'uAmbCol', 'uLn', 'uLp', 'uLc', 'uLd', 'uGrain', 'uDark']) this.U[n] = gl.getUniformLocation(this.prog, n);
    this.buildPrims();
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  }
  private link(vs: string, fs: string) {
    const gl = this.gl;
    const mk = (t: number, s: string) => { const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram()!; gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  /** interleaved: pos3 nor3 col3 mat4 */
  upload(data: Float32Array, idx: Uint32Array): MeshGPU {
    const gl = this.gl;
    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const ib = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const S = 13 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, 36);
    gl.bindVertexArray(null);
    return { vao, count: idx.length };
  }
  private geoToMesh(g: Geo): MeshGPU {
    const n = g.pos.length / 3; const d = new Float32Array(n * 13);
    for (let i = 0; i < n; i++) { d.set([g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], g.nor[i * 3], g.nor[i * 3 + 1], g.nor[i * 3 + 2], 1, 1, 1, 0, 20, 0.2, 0], i * 13); }
    return this.upload(d, new Uint32Array(g.idx));
  }
  private buildPrims() {
    this.box = this.geoToMesh(geoBox());
    this.cyl = this.geoToMesh(geoCyl(16)); this.cylLow = this.geoToMesh(geoCyl(8));
    this.sph = this.geoToMesh(geoSphere(10, 16)); this.sphLow = this.geoToMesh(geoSphere(6, 8));
    this.con = this.geoToMesh(geoCone(14));
  }
  setQuality(q: Quality) { this.q = q; this.resize(); }
  resize() {
    // cap the pixel ratio per preset: phones report 3x, which would make a 'low' preset more expensive than CSS resolution
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.name === 'low' ? 1.25 : this.q.name === 'medium' ? 1.5 : 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr * this.q.scale)), h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr * this.q.scale));
    if (w !== this.canvas.width || h !== this.canvas.height) { this.canvas.width = w; this.canvas.height = h; }
    this.width = this.canvas.width; this.height = this.canvas.height;
  }

  begin(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, fov: number, time: number) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(this.fog[0], this.fog[1], this.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    persp(this.proj, fov, this.width / this.height, 0.08, 140);
    lookAt(this.view, ex, ey, ez, tx, ty, tz);
    mul(this.vp, this.proj, this.view);
    this.cam.x = ex; this.cam.y = ey; this.cam.z = ez; this.time = time;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.U.uVP, false, this.vp);
    gl.uniform3f(this.U.uCam, ex, ey, ez);
    gl.uniform1f(this.U.uTime, time % 100);
    gl.uniform3fv(this.U.uFog, this.fog); gl.uniform1f(this.U.uFogD, this.fogD);
    gl.uniform1f(this.U.uAmb, this.amb); gl.uniform3fv(this.U.uAmbCol, this.ambCol);
    gl.uniform1f(this.U.uGrain, this.q.grain); gl.uniform1f(this.U.uDark, this.dark);
    gl.uniform1i(this.U.uLn, this.nLights);
    gl.uniform4fv(this.U.uLp, this.lightsU.p); gl.uniform4fv(this.U.uLc, this.lightsU.c); gl.uniform4fv(this.U.uLd, this.lightsU.d);
    this.drawCalls = 0;
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
  }

  setLights(ls: Light[]) {
    const n = Math.min(8, this.q.lights, ls.length); this.nLights = n;
    const { p, c, d } = this.lightsU;
    for (let i = 0; i < n; i++) {
      const l = ls[i];
      p[i * 4] = l.x; p[i * 4 + 1] = l.y; p[i * 4 + 2] = l.z; p[i * 4 + 3] = l.r;
      c[i * 4] = l.c[0] * l.i; c[i * 4 + 1] = l.c[1] * l.i; c[i * 4 + 2] = l.c[2] * l.i; c[i * 4 + 3] = 1;
      d[i * 4] = l.dx ?? 0; d[i * 4 + 1] = l.dy ?? 0; d[i * 4 + 2] = l.dz ?? 0; d[i * 4 + 3] = l.cut ?? 0;
    }
  }

  // ---- state helpers
  private ovMode(on: boolean, k = 0, shine = 20, spec = 0.2, emis = 0) {
    const gl = this.gl;
    gl.uniform1f(this.U.uOv, on ? 1 : 0);
    if (on) { gl.uniform4f(this.U.uMat, k, shine, spec, emis); gl.uniform1f(this.U.uPat, 6); } else gl.uniform1f(this.U.uPat, 1);
  }
  /** draw a baked static chunk list */
  drawChunks(chunks: Chunk[], maxD: number, blend = false) {
    const gl = this.gl;
    this.ovMode(false);
    gl.uniformMatrix4fv(this.U.uModel, false, IDENT);
    gl.uniform4f(this.U.uTint, 1, 1, 1, blend ? 0.4 : 1); gl.uniform1f(this.U.uEmis, 0); gl.uniform1f(this.U.uUnlit, blend ? 1 : 0);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1); }
    for (const c of chunks) {
      const d = Math.hypot(c.cx - this.cam.x, c.cz - this.cam.z);
      if (d - c.rad > maxD) continue;
      gl.bindVertexArray(c.vao); gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0); this.drawCalls++;
    }
    if (blend) { gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.POLYGON_OFFSET_FILL); }
    gl.bindVertexArray(null);
  }

  /** draw one primitive with a model matrix. */
  prim(shape: Shape, m: M4, c: Rgb, o: { mat?: Mat; emis?: number; alpha?: number; unlit?: boolean; low?: boolean; noDepth?: boolean } = {}) {
    const gl = this.gl;
    const mat = o.mat ?? MATS.plastic;
    this.ovMode(true, mat.k, mat.shine, mat.spec, 0);
    gl.uniformMatrix4fv(this.U.uModel, false, m);
    gl.uniform4f(this.U.uTint, c[0], c[1], c[2], o.alpha ?? 1);
    gl.uniform1f(this.U.uEmis, o.emis ?? 0);
    gl.uniform1f(this.U.uUnlit, o.unlit ? 1 : 0);
    const alpha = (o.alpha ?? 1) < 1;
    if (alpha) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    if (o.noDepth) gl.disable(gl.DEPTH_TEST);
    const lowLod = o.low ?? false;
    const mesh = shape === 'b' ? this.box : shape === 'c' ? (lowLod ? this.cylLow : this.cyl) : shape === 's' ? (lowLod ? this.sphLow : this.sph) : this.con;
    gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0); this.drawCalls++;
    if (alpha) { gl.disable(gl.BLEND); gl.depthMask(true); }
    if (o.noDepth) gl.enable(gl.DEPTH_TEST);
  }
  /** unlit additive glow (particles, zones) */
  glow(shape: Shape, m: M4, c: Rgb, a: number, noDepth = false) {
    const gl = this.gl;
    this.ovMode(true, 0, 1, 0, 0);
    gl.uniformMatrix4fv(this.U.uModel, false, m);
    gl.uniform4f(this.U.uTint, c[0], c[1], c[2], a); gl.uniform1f(this.U.uEmis, 1); gl.uniform1f(this.U.uUnlit, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    if (noDepth) gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const mesh = shape === 'b' ? this.box : shape === 'c' ? this.cylLow : shape === 's' ? this.sphLow : this.con;
    gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0); this.drawCalls++;
    gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
    if (noDepth) gl.enable(gl.DEPTH_TEST);
  }
  project(x: number, y: number, z: number): { x: number; y: number; w: number } {
    const v = this.vp;
    const cx = v[0] * x + v[4] * y + v[8] * z + v[12], cy = v[1] * x + v[5] * y + v[9] * z + v[13], cw = v[3] * x + v[7] * y + v[11] * z + v[15];
    return { x: (cx / cw * 0.5 + 0.5), y: (1 - (cy / cw * 0.5 + 0.5)), w: cw };
  }
}
const IDENT = m4();

// ------------------------------------------------------------------ static batch builder (bakes shapes into chunks)
export class Batch {
  chunks = new Map<number, { d: number[]; i: number[]; sx: number; sz: number; n: number }>();
  constructor(public chunkSize = 16) {}
  private geoCache = new Map<string, Geo>();
  private geo(shape: Shape, seg: number): Geo {
    const key = shape + seg;
    let g = this.geoCache.get(key);
    if (!g) { g = shape === 'b' ? geoBox() : shape === 'c' ? geoCyl(seg) : shape === 's' ? geoSphere(Math.max(5, Math.round(seg * 0.7)), seg) : geoCone(seg); this.geoCache.set(key, g); }
    return g;
  }
  private chunk(x: number, z: number) {
    const cx = Math.floor(x / this.chunkSize), cz = Math.floor(z / this.chunkSize), key = cx * 4096 + cz;
    let c = this.chunks.get(key);
    if (!c) { c = { d: [], i: [], sx: 0, sz: 0, n: 0 }; this.chunks.set(key, c); }
    return c;
  }
  /** add a shape: centre p, size z, rotations ry/rz, colour, material */
  shape(s: Shape, p: [number, number, number], z: [number, number, number], ry: number, rz: number, color: Rgb, mat: Mat, emis = 0, seg = 12, scale = 1, wx = 0, wz = 0, wy = 0) {
    const g = this.geo(s, seg);
    // part transform (local -> instance) then instance rotation/translation (wx,wz,wy yaw)
    const ch = this.chunk(wx, wz);
    const base = ch.n;
    const m = trs(new Float32Array(16), p[0] * scale, p[1] * scale, p[2] * scale, 0, ry, rz, z[0] * scale, z[1] * scale, z[2] * scale);
    const cy = Math.cos(wy), sy = Math.sin(wy);
    const nv = g.pos.length / 3;
    for (let i = 0; i < nv; i++) {
      const px = g.pos[i * 3], py = g.pos[i * 3 + 1], pz = g.pos[i * 3 + 2];
      let x = m[0] * px + m[4] * py + m[8] * pz + m[12], y = m[1] * px + m[5] * py + m[9] * pz + m[13], zz = m[2] * px + m[6] * py + m[10] * pz + m[14];
      const nx = g.nor[i * 3], ny = g.nor[i * 3 + 1], nz = g.nor[i * 3 + 2];
      let rx = m[0] * nx / (z[0] || 1) + m[4] * ny / (z[1] || 1) + m[8] * nz / (z[2] || 1), ry2 = m[1] * nx / (z[0] || 1) + m[5] * ny / (z[1] || 1) + m[9] * nz / (z[2] || 1), rz2 = m[2] * nx / (z[0] || 1) + m[6] * ny / (z[1] || 1) + m[10] * nz / (z[2] || 1);
      const nl = Math.hypot(rx, ry2, rz2) || 1; rx /= nl; ry2 /= nl; rz2 /= nl;
      // instance yaw + translation
      const X = x * cy + zz * sy + wx, Z = -x * sy + zz * cy + wz;
      const RX = rx * cy + rz2 * sy, RZ = -rx * sy + rz2 * cy;
      ch.d.push(X, y + wy * 0 + 0, Z, RX, ry2, RZ, color[0], color[1], color[2], mat.k, mat.shine, mat.spec, emis);
    }
    for (let i = 0; i < g.idx.length; i++) ch.i.push(base + g.idx[i]);
    ch.n += nv;
  }
  /** a world-space quad (a,b,c,d in CCW order seen from the normal side) */
  quad(a: number[], b: number[], c: number[], d: number[], color: Rgb, mat: Mat, emis = 0, uvScale = 1) {
    void uvScale;
    const ch = this.chunk((a[0] + c[0]) / 2, (a[2] + c[2]) / 2);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = ch.n;
    for (const p of [a, b, c, d]) ch.d.push(p[0], p[1], p[2], nx, ny, nz, color[0], color[1], color[2], mat.k, mat.shine, mat.spec, emis);
    ch.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    ch.n += 4;
  }
  build(r: Renderer): Chunk[] {
    const out: Chunk[] = [];
    for (const [key, c] of this.chunks) {
      if (!c.n) continue;
      const cx = Math.floor(key / 4096), cz = key % 4096;
      const mesh = r.upload(new Float32Array(c.d), new Uint32Array(c.i));
      out.push({ vao: mesh.vao, count: mesh.count, cx: (cx + 0.5) * this.chunkSize, cz: (cz + 0.5) * this.chunkSize, rad: this.chunkSize * 0.75 });
    }
    return out;
  }
}

export function partMat(p: Part): Mat { return MATS[p.m]; }
