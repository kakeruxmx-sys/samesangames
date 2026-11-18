// Never trust the client: every inbound message is validated and clamped here before it touches game state.
import { BANNED_WORDS, NAME_MAX, MAP_IDS, CHAT_PRESETS } from '../../shared/constants';
import { KILLER_IDS } from '../../shared/killers';
import type { ClientMsg } from '../../shared/protocol';

const num = (v: unknown, lo: number, hi: number, dflt = 0): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, v));
};

function normalizeForFilter(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s_\-.0]/g, '').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's');
}

/** Returns a safe display name, or null if it must be rejected. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '');
  s = s.replace(/[^\p{L}\p{N} _\-]/gu, '').replace(/\s+/g, ' ').trim();
  if (s.length === 0) return null;
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).trim();
  const n = normalizeForFilter(s);
  for (const w of BANNED_WORDS) if (n.includes(normalizeForFilter(w))) return null;
  return s;
}

export function guestName(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 'Guest' + String(1000 + (h % 9000));
}

export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private burst: number) { this.tokens = burst; }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;

export function validateClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      const token = typeof m.token === 'string' && /^[a-f0-9]{48}$/.test(m.token) ? m.token : undefined;
      return { t: 'hello', v: num(m.v, 0, 1000, 0), token, name: typeof m.name === 'string' ? m.name.slice(0, 64) : '' };
    }
    case 'quick': return { t: 'quick' };
    case 'create': return { t: 'create' };
    case 'join': {
      const code = typeof m.code === 'string' ? m.code.toUpperCase().trim() : '';
      return ROOM_CODE_RE.test(code) ? { t: 'join', code } : null;
    }
    case 'leave': return { t: 'leave' };
    case 'pick': return { t: 'pick', char: Math.floor(num(m.char, 0, 7, 0)) };
    case 'setmap': return m.map === 'random' || (MAP_IDS as string[]).includes(m.map as string) ? { t: 'setmap', map: m.map as any } : null;
    case 'start': return { t: 'start' };
    case 'killer': return (KILLER_IDS as string[]).includes(m.id as string) ? { t: 'killer', id: m.id as any } : null;
    case 'in': {
      const seq = Math.floor(num(m.seq, 0, 2 ** 31 - 1, -1));
      if (seq < 0) return null;
      return {
        t: 'in', seq,
        mx: num(m.mx, -1, 1), mz: num(m.mz, -1, 1),
        yaw: num(m.yaw, -1000, 1000), pitch: num(m.pitch, -1.45, 1.45),
        run: m.run === true, crouch: m.crouch === true, use: m.use === true,
      };
    }
    case 'act': {
      const ok = ['transform', 'untransform', 'attack', 'ab0', 'ab1', 'ab2'];
      if (typeof m.a !== 'string' || !ok.includes(m.a)) return null;
      return { t: 'act', a: m.a as any, d: num(m.d, 0, 40, 99) };
    }
    case 'chat': {
      const id = Math.floor(num(m.id, 0, CHAT_PRESETS.length - 1, -1));
      return id >= 0 ? { t: 'chat', id } : null;
    }
    case 'report': {
      if (typeof m.pub !== 'string' || !/^[a-f0-9]{8}$/.test(m.pub)) return null;
      return { t: 'report', pub: m.pub, why: typeof m.why === 'string' ? m.why.slice(0, 120).replace(/[\u0000-\u001f]/g, ' ') : '' };
    }
    case 'ping': return { t: 'ping', c: Math.floor(num(m.c, 0, 2 ** 31 - 1)) };
    default: return null;
  }
}

export function normYaw(y: number): number {
  const t = Math.PI * 2;
  y = y % t;
  if (y > Math.PI) y -= t; else if (y < -Math.PI) y += t;
  return y;
}
