// Lobbies, matchmaking and the match lifecycle.
// RULE: a match starts ONLY when 5 real human connections are present. There is no code path that adds a bot.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOBBY, MAP_IDS, PLAYERS_PER_MATCH, RULES, XP, xpToLevel, MapId, Phase } from '../../shared/constants';
import { KILLER_IDS, KillerId } from '../../shared/killers';
import type { LobbySlot, RoomInfo, ServerMsg } from '../../shared/protocol';
import type { Conn } from './conn';
import { Match, MatchEnd } from './match';
import type { Profiles } from './profiles';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = () => Array.from({ length: LOBBY.roomCodeLen }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Room {
  phase: Phase = 'waiting';
  members: (Conn | null)[] = new Array(PLAYERS_PER_MATCH).fill(null);
  host: Conn | null = null;
  map: MapId | 'random' = 'random';
  createdAt = Date.now();
  readyAt = 0; // countdown end (ms)
  pickEnd = 0;
  introEnd = 0;
  resultsEnd = 0;
  killerConn: Conn | null = null;
  lastKillerPub = '';
  match: Match | null = null;
  seatOwners = new Map<string, number>(); // pub -> seat id for reconnect during a match
  constructor(public code: string, public kind: 'quick' | 'custom') {}

  count() { return this.members.filter(Boolean).length; }
  humans(): Conn[] { return this.members.filter((c): c is Conn => !!c); }
}

export class Rooms {
  rooms = new Map<string, Room>();
  private timer: NodeJS.Timeout;
  constructor(private profiles: Profiles, private dataDir: string) {
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[rooms] tick error:', e); } }, 500);
  }
  stop() { clearInterval(this.timer); for (const r of this.rooms.values()) r.match?.destroy(); }

  // ---------------------------------------------------------------- membership
  private info(room: Room, me: Conn): RoomInfo {
    const slots: (LobbySlot | null)[] = room.members.map((c, i) => c ? {
      slot: i, name: c.name, pub: c.rec.pub, char: c.char, level: xpToLevel(c.rec.xp), connected: !c.closed, host: room.host === c, isMe: c === me,
    } : null);
    return {
      code: room.code, kind: room.kind, phase: room.phase, map: room.map, slots,
      countdown: room.phase === 'ready' ? Math.max(0, Math.ceil((room.readyAt - Date.now()) / 1000)) : null,
      waitedS: Math.floor((Date.now() - room.createdAt) / 1000),
      killerPickS: room.phase === 'roles' ? Math.max(0, Math.ceil((room.pickEnd - Date.now()) / 1000)) : null,
      youAreKiller: room.phase === 'roles' || room.phase === 'intro' || room.phase === 'playing' ? room.killerConn === me : null,
    };
  }
  broadcast(room: Room) {
    for (const c of room.humans()) c.send({ t: 'room', room: this.info(room, c) });
  }

  private addMember(room: Room, c: Conn): boolean {
    const slot = room.members.findIndex((m) => m === null);
    if (slot < 0) return false;
    room.members[slot] = c;
    c.room = room;
    // unique character: keep chosen if free, else first free
    const taken = new Set(room.humans().filter((o) => o !== c).map((o) => o.char));
    if (taken.has(c.char)) for (let i = 0; i < 8; i++) if (!taken.has(i)) { c.char = i; break; }
    if (!room.host) room.host = c;
    return true;
  }

  quick(c: Conn) {
    if (c.room) return c.send({ t: 'err', code: 'in_room', msg: 'すでにルームに参加しています' });
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.kind !== 'quick' || r.phase !== 'waiting' || r.count() >= PLAYERS_PER_MATCH) continue;
      if (!best || r.count() > best.count()) best = r;
    }
    if (!best) {
      let code = randCode(); while (this.rooms.has(code)) code = randCode();
      best = new Room(code, 'quick'); this.rooms.set(code, best);
    }
    this.addMember(best, c);
    this.afterJoin(best);
  }

  create(c: Conn) {
    if (c.room) return c.send({ t: 'err', code: 'in_room', msg: 'すでにルームに参加しています' });
    let code = randCode(); while (this.rooms.has(code)) code = randCode();
    const r = new Room(code, 'custom'); this.rooms.set(code, r);
    this.addMember(r, c);
    this.broadcast(r);
  }

  join(c: Conn, code: string) {
    if (c.room) return c.send({ t: 'err', code: 'in_room', msg: 'すでにルームに参加しています' });
    const r = this.rooms.get(code);
    if (!r || r.kind !== 'custom') return c.send({ t: 'err', code: 'no_room', msg: 'ルームが見つかりません' });
    if (r.phase !== 'waiting' || r.count() >= PLAYERS_PER_MATCH) return c.send({ t: 'err', code: 'room_full', msg: 'このルームには参加できません（満員または試合中）' });
    this.addMember(r, c);
    this.broadcast(r);
  }

  private afterJoin(r: Room) {
    // quick rooms auto-start the countdown once 5 humans are present; never before.
    if (r.kind === 'quick' && r.count() === PLAYERS_PER_MATCH && r.phase === 'waiting') this.beginReady(r);
    this.broadcast(r);
  }

  private beginReady(r: Room) {
    r.phase = 'ready';
    r.readyAt = Date.now() + LOBBY.countdownS * 1000;
  }

  pick(c: Conn, char: number) {
    const r = c.room;
    if (!r || (r.phase !== 'waiting' && r.phase !== 'ready')) return;
    if (r.humans().some((o) => o !== c && o.char === char)) return c.send({ t: 'err', code: 'char_taken', msg: 'そのキャラクターは使われています' });
    c.char = char;
    this.broadcast(r);
  }

  setMap(c: Conn, map: MapId | 'random') {
    const r = c.room;
    if (!r || r.kind !== 'custom' || r.host !== c || r.phase !== 'waiting') return;
    r.map = map;
    this.broadcast(r);
  }

  startCustom(c: Conn) {
    const r = c.room;
    if (!r || r.kind !== 'custom' || r.host !== c || r.phase !== 'waiting') return;
    if (r.count() !== PLAYERS_PER_MATCH) return c.send({ t: 'err', code: 'need_five', msg: '5人の人間プレイヤーが揃うまで開始できません（AIは追加されません）' });
    this.beginReady(r);
    this.broadcast(r);
  }

  leave(c: Conn, closed = false) {
    const r = c.room;
    if (!r) return;
    if ((r.phase === 'intro' || r.phase === 'playing') && r.match && !r.match.ended) {
      // mid-match: keep the seat for RECONNECT_GRACE_S; the match decides what a permanent leave means.
      if (closed) { r.match.onDisconnect(c); return; }
      // voluntary leave during a match: treat as a disconnect that may be resumed
      r.match.onDisconnect(c); c.room = null; c.send({ t: 'room', room: null });
      return;
    }
    const i = r.members.indexOf(c);
    if (i >= 0) r.members[i] = null;
    c.room = null;
    if (r.host === c) r.host = r.humans()[0] ?? null;
    if (!closed) c.send({ t: 'room', room: null });
    if (r.phase === 'ready' || r.phase === 'roles') { r.phase = 'waiting'; r.killerConn = null; }
    if (r.count() === 0) { r.match?.destroy(); this.rooms.delete(r.code); return; }
    this.broadcast(r);
  }

  /** A player reconnects (same secret token) while their match is still running. */
  resume(c: Conn): boolean {
    for (const r of this.rooms.values()) {
      if (!r.match || r.match.ended) continue;
      if (!(r.phase === 'intro' || r.phase === 'playing')) continue;
      const idx = r.members.findIndex((m) => m && m.rec.pub === c.rec.pub);
      if (idx < 0) continue;
      if (r.match.onReconnect(c, c.rec.pub)) {
        r.members[idx] = c; c.room = r;
        if (r.host && r.host.rec.pub === c.rec.pub) r.host = c;
        if (r.killerConn && r.killerConn.rec.pub === c.rec.pub) r.killerConn = c;
        c.send({ t: 'room', room: this.info(r, c) });
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- killer roles
  chooseKiller(r: Room): Conn {
    const hs = r.humans();
    // fairness: whoever has played killer the least (relative to matches) goes first; never the same person twice in a row
    let pool = hs.filter((c) => c.rec.pub !== r.lastKillerPub);
    if (!pool.length) pool = hs;
    let best = pool[0], bs = Infinity;
    for (const c of pool) {
      const s = this.profiles.killerRatio(c.rec) + Math.random() * 0.05;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }

  killerPick(c: Conn, id: KillerId) {
    const r = c.room;
    if (!r || r.phase !== 'roles' || r.killerConn !== c) return;
    this.launch(r, id);
  }

  private launch(r: Room, killerType: KillerId) {
    const hs = r.humans();
    if (hs.length !== PLAYERS_PER_MATCH || !r.killerConn) { r.phase = 'waiting'; this.broadcast(r); return; }
    const mapId: MapId = r.map === 'random' ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : r.map;
    let seat = 0;
    const seats = r.members.map((c, i) => {
      const conn = c!;
      return { id: seat++, conn, role: (conn === r.killerConn ? 'K' : 'S') as 'K' | 'S', name: conn.name, char: conn.char, pub: conn.rec.pub };
    });
    r.lastKillerPub = r.killerConn.rec.pub;
    r.match = new Match(mapId, killerType, seats, (e) => this.onMatchEnd(r, e));
    r.phase = 'intro';
    r.introEnd = Date.now() + LOBBY.introS * 1000;
    r.match.start();
    this.broadcast(r);
  }

  // ---------------------------------------------------------------- results / rewards
  private onMatchEnd(r: Room, e: MatchEnd) {
    const survWin = e.result === 'survivors';
    const stats = e.seats.map((s) => ({ i: s.id, name: s.name, role: s.role, state: s.state, gens: s.stats.gens, rescues: s.stats.rescues, caps: s.stats.caps }));
    for (const s of e.seats) {
      const rec = this.profiles.find(s.pub);
      if (!rec) continue;
      const lines: string[] = [];
      let xp = 0;
      let won: boolean | null;
      if (e.result === 'aborted') { xp = XP.aborted; lines.push(`試合が中断されました +${XP.aborted}`); won = null; }
      else {
        const isWin = s.role === 'K' ? !survWin : survWin;
        won = isWin;
        xp += isWin ? XP.win : XP.loss; lines.push(isWin ? `勝利 +${XP.win}` : `参加 +${XP.loss}`);
        if (s.role === 'S') {
          if (s.stats.gens) { xp += s.stats.gens * XP.perGen; lines.push(`装置修理 ×${s.stats.gens} +${s.stats.gens * XP.perGen}`); }
          if (s.stats.rescues) { xp += s.stats.rescues * XP.perRescue; lines.push(`救助 ×${s.stats.rescues} +${s.stats.rescues * XP.perRescue}`); }
          if (s.state === 'escaped') { xp += XP.escape; lines.push(`脱出 +${XP.escape}`); }
        } else {
          if (s.stats.caps) { xp += s.stats.caps * XP.perCapture; lines.push(`捕獲 ×${s.stats.caps} +${s.stats.caps * XP.perCapture}`); }
          if (s.stats.elims) { xp += s.stats.elims * XP.perElimination; lines.push(`脱落 ×${s.stats.elims} +${s.stats.elims * XP.perElimination}`); }
        }
      }
      if (s.gone) { xp = 0; lines.length = 0; lines.push('途中退出のため報酬なし'); }
      const res = this.profiles.recordMatch(rec, { killer: s.role === 'K', killerType: e.killer, won: s.gone ? null : won, xp, escaped: s.state === 'escaped' });
      const conn = r.humans().find((c) => c.rec.pub === s.pub);
      conn?.send({ t: 'end', result: e.result, escaped: e.escaped, killer: e.killer, rewards: { xp, level: res.level, levelUp: res.levelUp, lines }, stats });
      conn?.send({ t: 'profile', profile: this.profiles.info(rec) });
    }
    r.phase = 'ended';
    r.resultsEnd = Date.now() + LOBBY.resultsS * 1000;
    this.broadcast(r);
  }

  private closeRoomAfterResults(r: Room) {
    r.match?.destroy(); r.match = null; r.killerConn = null;
    for (let i = 0; i < r.members.length; i++) {
      const c = r.members[i];
      if (c && (c.closed || c.room !== r)) r.members[i] = null;
    }
    if (r.kind === 'quick') {
      for (const c of r.humans()) { c.room = null; c.send({ t: 'room', room: null }); }
      this.rooms.delete(r.code);
    } else {
      r.phase = 'waiting'; r.createdAt = Date.now();
      if (r.host && !r.members.includes(r.host)) r.host = r.humans()[0] ?? null;
      if (r.count() === 0) this.rooms.delete(r.code);
      else this.broadcast(r);
    }
  }

  // ---------------------------------------------------------------- periodic
  private tick() {
    const now = Date.now();
    for (const r of [...this.rooms.values()]) {
      if (r.phase === 'waiting' && now % 2000 < 500) this.broadcast(r);
      if (r.phase === 'ready') {
        if (r.count() !== PLAYERS_PER_MATCH) { r.phase = 'waiting'; this.broadcast(r); continue; }
        if (now >= r.readyAt) {
          r.killerConn = this.chooseKiller(r);
          r.phase = 'roles';
          r.pickEnd = now + LOBBY.killerPickS * 1000;
          r.killerConn.send({ t: 'pickkiller', seconds: LOBBY.killerPickS });
          this.broadcast(r);
        } else this.broadcast(r);
      } else if (r.phase === 'roles') {
        if (!r.killerConn || r.killerConn.closed || r.count() !== PLAYERS_PER_MATCH) { r.phase = 'waiting'; r.killerConn = null; this.broadcast(r); continue; }
        if (now >= r.pickEnd) this.launch(r, KILLER_IDS[Math.floor(Math.random() * KILLER_IDS.length)]); // timed out: random killer type (still a human)
      } else if (r.phase === 'intro') {
        if (now >= r.introEnd) { r.phase = 'playing'; this.broadcast(r); }
      } else if (r.phase === 'ended') {
        if (now >= r.resultsEnd) this.closeRoomAfterResults(r);
      }
      // abandoned matches: nobody connected at all -> end (never kept alive by AI)
      if ((r.phase === 'playing' || r.phase === 'intro') && r.match && !r.match.ended && !r.humans().some((c) => !c.closed && c.room === r)) {
        // the match itself ends via its reconnect grace; nothing to do here
      }
    }
  }

  // ---------------------------------------------------------------- moderation
  report(c: Conn, pub: string, why: string) {
    const now = Date.now();
    if (now - c.lastReport < 10_000 || c.reports >= 10) return c.send({ t: 'err', code: 'rate', msg: '通報が多すぎます。少し待ってください' });
    c.lastReport = now; c.reports++;
    try {
      appendFileSync(join(this.dataDir, 'reports.jsonl'), JSON.stringify({ at: new Date().toISOString(), reporter: c.rec.pub, target: pub, why, room: c.room?.code }) + '\n');
    } catch (e) { console.error('[report] write failed', e); }
    c.send({ t: 'err', code: 'reported', msg: '通報を受け付けました' });
  }

  stats() {
    let players = 0, matches = 0;
    for (const r of this.rooms.values()) { players += r.count(); if (r.match && !r.match.ended) matches++; }
    return { rooms: this.rooms.size, players, matches };
  }
}

export { RULES };
export type { ServerMsg };
