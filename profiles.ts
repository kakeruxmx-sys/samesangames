// Profile storage. Guests only: a random secret token lives in the player's browser; the server stores only its SHA-256.
// Storage is a JSON file (DATA_DIR/profiles.json) written atomically. PostgreSQL is NOT implemented (see README).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { xpToLevel } from '../../shared/constants';
import { KILLER_IDS } from '../../shared/killers';
import type { ProfileInfo } from '../../shared/protocol';

interface Rec {
  pub: string;
  name: string;
  xp: number;
  matches: number;
  wins: number;
  losses: number;
  killerPlays: number;
  killerWins: number;
  killerUse: Record<string, number>;
  survivorEscapes: number;
  survivorPlays: number;
  createdAt: number;
  lastSeen: number;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const ACHIEVEMENTS: { id: string; name: string; test: (r: Rec) => boolean }[] = [
  { id: 'first_night', name: 'FIRST NIGHT（初めての夜）', test: (r) => r.matches >= 1 },
  { id: 'first_win', name: 'SURVIVOR（初勝利）', test: (r) => r.wins >= 1 },
  { id: 'escape_artist', name: 'ESCAPE ARTIST（5回脱出）', test: (r) => r.survivorEscapes >= 5 },
  { id: 'hunter', name: 'HUNTER（キラーで3勝）', test: (r) => r.killerWins >= 3 },
  { id: 'all_five', name: 'FIVE FACES（全キラーを使用）', test: (r) => KILLER_IDS.every((k) => (r.killerUse[k] || 0) > 0) },
  { id: 'veteran', name: 'VETERAN（25試合）', test: (r) => r.matches >= 25 },
];

const TITLES = ['NEWCOMER', 'WANDERER', 'HIDER', 'SURVIVOR', 'WATCHER', 'NIGHTWALKER', 'LEGEND'];

export class Profiles {
  private recs = new Map<string, Rec>(); // tokenHash -> rec
  private byPub = new Map<string, Rec>();
  private file: string;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'profiles.json');
    if (existsSync(this.file)) {
      try {
        const obj = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Rec>;
        for (const [k, v] of Object.entries(obj)) { this.recs.set(k, v); this.byPub.set(v.pub, v); }
      } catch (e) {
        // keep the unreadable file (operators may be able to repair it) instead of overwriting it on the next save
        const bak = `${this.file}.corrupt-${Date.now()}`;
        try { renameSync(this.file, bak); } catch { /* ignore */ }
        console.error(`[profiles] could not read profiles.json (${(e as Error).message}); moved to ${bak} and starting empty`);
      }
    }
  }

  /** Returns [token (only when newly created), record]. */
  open(token: string | undefined, name: string): { token: string; rec: Rec; created: boolean; hash: string } {
    if (token) {
      const h = sha(token);
      const rec = this.recs.get(h);
      if (rec) { rec.lastSeen = Date.now(); rec.name = name; this.touch(); return { token, rec, created: false, hash: h }; }
    }
    const t = randomBytes(24).toString('hex');
    const h = sha(t);
    const rec: Rec = {
      pub: randomBytes(4).toString('hex'), name, xp: 0, matches: 0, wins: 0, losses: 0, killerPlays: 0, killerWins: 0, killerUse: {},
      survivorEscapes: 0, survivorPlays: 0, createdAt: Date.now(), lastSeen: Date.now(),
    };
    this.recs.set(h, rec); this.byPub.set(rec.pub, rec);
    this.touch();
    return { token: t, rec, created: true, hash: h };
  }

  find(pub: string) { return this.byPub.get(pub); }

  info(rec: Rec): ProfileInfo {
    const level = xpToLevel(rec.xp);
    return {
      pub: rec.pub, name: rec.name, xp: rec.xp, level, matches: rec.matches, wins: rec.wins, losses: rec.losses,
      killerPlays: rec.killerPlays, killerUse: rec.killerUse, survivorEscapes: rec.survivorEscapes,
      achievements: ACHIEVEMENTS.filter((a) => a.test(rec)).map((a) => a.name),
      title: TITLES[Math.min(TITLES.length - 1, Math.floor(level / 3))],
    };
  }

  /** Fraction of past matches played as killer; used for fair killer rotation (lower = more due). */
  killerRatio(rec: Rec): number { return rec.killerPlays / (rec.matches + 1); }

  recordMatch(rec: Rec, o: { killer: boolean; killerType?: string; won: boolean | null; xp: number; escaped?: boolean }): { level: number; levelUp: boolean } {
    const before = xpToLevel(rec.xp);
    rec.xp += o.xp;
    if (o.won !== null) { rec.matches++; if (o.won) rec.wins++; else rec.losses++; }
    if (o.killer) {
      rec.killerPlays++;
      if (o.won) rec.killerWins++;
      if (o.killerType) rec.killerUse[o.killerType] = (rec.killerUse[o.killerType] || 0) + 1;
    } else { rec.survivorPlays++; if (o.escaped) rec.survivorEscapes++; }
    this.touch();
    const after = xpToLevel(rec.xp);
    return { level: after, levelUp: after > before };
  }

  private touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 2000);
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const obj: Record<string, Rec> = {};
    for (const [k, v] of this.recs) obj[k] = v;
    const tmp = this.file + '.tmp';
    try { writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, this.file); } catch (e) { console.error('[profiles] save failed', e); }
  }
}

export type ProfileRec = Rec;
