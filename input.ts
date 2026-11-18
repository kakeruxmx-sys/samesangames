// Unified input: keyboard + mouse (pointer lock) on desktop, multi-touch (floating stick, look pad, buttons) on phones.
// Every action available on PC is reachable by touch (nothing requires a keyboard on mobile).
export type Action = 'transform' | 'attack' | 'ab0' | 'ab1' | 'ab2' | 'chat' | 'menu' | 'spectate';

export interface UiPrefs { scale: number; sens: number; pos: Record<string, { x: number; y: number }>; quality: 'auto' | 'low' | 'medium' | 'high'; volume: number; fov: number; invertY: boolean }
export const DEFAULT_PREFS: UiPrefs = { scale: 1, sens: 1, pos: {}, quality: 'auto', volume: 0.8, fov: 75, invertY: false };

export function loadPrefs(): UiPrefs {
  try { const raw = localStorage.getItem('pn2_prefs'); if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return { ...DEFAULT_PREFS, pos: {} };
}
export function savePrefs(p: UiPrefs) { try { localStorage.setItem('pn2_prefs', JSON.stringify(p)); } catch { /* ignore */ } }

export const isTouchDevice = () => (navigator.maxTouchPoints ?? 0) > 0 && (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

export class Input {
  mx = 0; mz = 0;
  yaw = 0; pitch = 0;
  run = false; crouch = false; use = false;
  role: 'S' | 'K' = 'S';
  prefs: UiPrefs = loadPrefs();
  touch = false;
  enabled = false;
  locked = false;
  private keys = new Set<string>();
  private queue: Action[] = [];
  private stick = { id: -1, cx: 0, cy: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0 };
  private crouchToggle = false;
  private btnHeld = new Set<string>();
  private canvas!: HTMLElement;
  editing = false;
  onLockChange: (l: boolean) => void = () => {};

  attach(canvas: HTMLElement, touchRoot: HTMLElement) {
    this.canvas = canvas;
    this.touch = isTouchDevice();
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.btnHeld.clear(); this.recompute(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (!this.locked) { this.lockPointer(); return; }
      if (e.button === 0) this.queue.push('attack');
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.onLockChange(this.locked); });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      const s = 0.0022 * this.prefs.sens;
      this.yaw -= e.movementX * s; this.pitch += (this.prefs.invertY ? 1 : -1) * e.movementY * s;
      this.clampPitch();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setupTouch(touchRoot);
    this.applyPrefs();
  }

  clampPitch() { this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch)); }
  lockPointer() {
    if (this.touch) return;
    // requestPointerLock() returns a promise in current Chrome and rejects when the browser refuses (e.g. right after Esc): ignore that quietly
    try { const r: unknown = this.canvas?.requestPointerLock?.(); (r as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* ignore */ }
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

  setRole(r: 'S' | 'K') {
    this.role = r;
    document.body.dataset.role = r;
  }
  reset() { this.mx = this.mz = 0; this.run = this.use = false; this.crouch = false; this.crouchToggle = false; this.keys.clear(); this.btnHeld.clear(); this.queue.length = 0; this.stick.id = -1; this.look.id = -1; const k = document.getElementById('stick-knob'); if (k) k.style.transform = ''; document.getElementById('stick-base')?.classList.remove('on'); document.querySelectorAll('#touch .btn.hold').forEach((b) => b.classList.remove('down')); }
  actions(): Action[] { const a = this.queue; this.queue = []; return a; }
  push(a: Action) { this.queue.push(a); }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.enabled) return;
    const k = e.code;
    if (down && e.repeat) { if (['Space', 'Tab'].includes(k)) e.preventDefault(); return; }
    const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
    if (typing) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (down) {
      if (k === 'KeyF') this.queue.push('transform');
      else if (k === 'KeyG' || k === 'KeyT') this.queue.push('chat');
      else if (k === 'Escape') this.queue.push('menu');
      else if (k === 'Tab') this.queue.push('spectate');
      else if (this.role === 'K') {
        if (k === 'KeyQ') this.queue.push('ab0');
        else if (k === 'KeyE') this.queue.push('ab1');
        else if (k === 'KeyR') this.queue.push('ab2');
        else if (k === 'KeyX') this.queue.push('attack');
      }
    }
    this.recompute();
  }

  private recompute() {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    // PC keys; touch stick values are merged below
    const sx = this.stick.id >= 0 ? this.stick.x : 0, sz = this.stick.id >= 0 ? this.stick.y : 0;
    this.mx = Math.abs(sx) > Math.abs(x) ? sx : x;
    this.mz = Math.abs(sz) > Math.abs(z) ? sz : z;
    this.run = k.has('ShiftLeft') || k.has('ShiftRight') || this.btnHeld.has('run');
    this.crouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC') || this.crouchToggle;
    this.use = (this.role === 'S' && k.has('KeyE')) || this.btnHeld.has('use');
  }

  // ---------------------------------------------------------------- touch
  applyPrefs() {
    const r = document.documentElement;
    r.style.setProperty('--ui-scale', String(this.prefs.scale));
    for (const el of document.querySelectorAll<HTMLElement>('#touch .btn')) {
      const p = this.prefs.pos[el.dataset.act ?? ''];
      if (p) { el.style.left = p.x + '%'; el.style.top = p.y + '%'; el.style.right = 'auto'; el.style.bottom = 'auto'; }
    }
  }
  resetLayout() {
    this.prefs.pos = {}; savePrefs(this.prefs);
    for (const el of document.querySelectorAll<HTMLElement>('#touch .btn')) { el.style.left = el.style.top = el.style.right = el.style.bottom = ''; }
  }

  private setupTouch(root: HTMLElement) {
    const stickZone = root.querySelector<HTMLElement>('#stick-zone')!;
    const lookZone = root.querySelector<HTMLElement>('#look-zone')!;
    const base = root.querySelector<HTMLElement>('#stick-base')!, knob = root.querySelector<HTMLElement>('#stick-knob')!;
    const R = () => 56 * this.prefs.scale;
    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stick.id >= 0 || this.editing) return;
      e.preventDefault(); stickZone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: 0, y: 0 };
      base.style.left = e.clientX + 'px'; base.style.top = e.clientY + 'px'; base.classList.add('on'); knob.style.transform = 'translate(-50%,-50%)';
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
      const r = R(), d = Math.hypot(dx, dy);
      if (d > r) { dx = dx / d * r; dy = dy / d * r; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / r, ny = -dy / r, m = Math.hypot(nx, ny);
      const dead = 0.14;
      if (m < dead) { this.stick.x = 0; this.stick.y = 0; }
      else { const s = (m - dead) / (1 - dead) / m; this.stick.x = nx * s; this.stick.y = ny * s; }
      this.recompute();
    });
    const endStick = (e: PointerEvent) => { if (e.pointerId !== this.stick.id) return; this.stick.id = -1; this.stick.x = this.stick.y = 0; base.classList.remove('on'); this.recompute(); };
    stickZone.addEventListener('pointerup', endStick); stickZone.addEventListener('pointercancel', endStick);

    lookZone.addEventListener('pointerdown', (e) => {
      if (this.look.id >= 0 || this.editing) return;
      e.preventDefault(); lookZone.setPointerCapture(e.pointerId); this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.look.id) return;
      const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y; this.look.x = e.clientX; this.look.y = e.clientY;
      const s = 0.0048 * this.prefs.sens;
      this.yaw -= dx * s; this.pitch += (this.prefs.invertY ? 1 : -1) * dy * s; this.clampPitch();
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.look.id) this.look.id = -1; };
    lookZone.addEventListener('pointerup', endLook); lookZone.addEventListener('pointercancel', endLook);

    for (const el of root.querySelectorAll<HTMLElement>('.btn')) {
      const act = el.dataset.act!;
      const hold = el.classList.contains('hold');
      let drag: { id: number; ox: number; oy: number } | null = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
        if (this.editing) { const r = el.getBoundingClientRect(); drag = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top }; return; }
        if (hold) { this.btnHeld.add(act); el.classList.add('down'); this.recompute(); }
        else if (act === 'crouch') { this.crouchToggle = !this.crouchToggle; el.classList.toggle('down', this.crouchToggle); this.recompute(); }
        else { this.queue.push(act as Action); el.classList.add('down'); }
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const x = ((e.clientX - drag.ox) / innerWidth) * 100, y = ((e.clientY - drag.oy) / innerHeight) * 100;
        const px = Math.max(0, Math.min(92, x)), py = Math.max(0, Math.min(88, y));
        el.style.left = px + '%'; el.style.top = py + '%'; el.style.right = 'auto'; el.style.bottom = 'auto';
        this.prefs.pos[act] = { x: px, y: py };
      });
      const up = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.id) { drag = null; savePrefs(this.prefs); return; }
        if (hold) { this.btnHeld.delete(act); el.classList.remove('down'); this.recompute(); }
        else if (act !== 'crouch') el.classList.remove('down');
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    }
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setEditing(on: boolean) { this.editing = on; document.body.classList.toggle('editing', on); }
  setCrouchLatch(v: boolean) { this.crouchToggle = v; document.querySelector('#touch .btn[data-act="crouch"]')?.classList.toggle('down', v); this.recompute(); }
}
