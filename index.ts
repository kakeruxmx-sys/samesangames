// PROPNIGHT 2 game server: static client + WebSocket on the same port.
// Run behind a TLS-terminating reverse proxy (see deploy/) or set TLS_CERT/TLS_KEY to serve wss:// directly.
import { createServer as createHttp, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { basename, dirname, join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '../../shared/constants';
import { Conn } from './conn';
import { Profiles } from './profiles';
import { Rooms } from './rooms';
import { guestName, sanitizeName, validateClientMsg } from './validation';

export interface ServerOptions {
  port: number;
  host: string;
  dataDir: string;
  staticDir: string;
  allowedOrigins: string[];
  maxConnPerIp: number;
  maxNewProfilesPerHour: number;
  trustProxy: boolean;
  tlsCert?: string;
  tlsKey?: string;
  docsDir: string;
}

export function loadOptions(env = process.env): ServerOptions {
  // project root: works both from source (server/src/index.ts) and from the bundle (dist/server.js)
  const here = dirname(fileURLToPath(import.meta.url));
  const root = basename(here) === 'dist' ? resolve(here, '..') : resolve(here, '..', '..');
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? join(root, 'data')),
    staticDir: resolve(env.STATIC_DIR ?? join(root, 'dist', 'client')),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    maxConnPerIp: Number(env.MAX_CONN_PER_IP ?? 8),
    maxNewProfilesPerHour: Number(env.MAX_NEW_PROFILES_PER_HOUR ?? 30),
    trustProxy: env.TRUST_PROXY === '1',
    tlsCert: env.TLS_CERT, tlsKey: env.TLS_KEY,
    docsDir: resolve(join(root, 'docs')),
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

export function startServer(opts: ServerOptions) {
  const profiles = new Profiles(opts.dataDir);
  const rooms = new Rooms(profiles, opts.dataDir);
  const conns = new Set<Conn>();
  const byPub = new Map<string, Conn>();
  const perIp = new Map<string, number>();
  const newProfiles = new Map<string, number[]>();
  const startedAt = Date.now();

  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'",
  };

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...securityHeaders });
      return res.end(JSON.stringify({ ok: true, uptimeS: Math.floor((Date.now() - startedAt) / 1000), ...rooms.stats(), connections: conns.size }));
    }
    if (path === '/legal/privacy' || path === '/legal/terms') {
      const f = join(opts.docsDir, path === '/legal/privacy' ? 'PRIVACY.md' : 'TERMS.md');
      const body = existsSync(f) ? readFileSync(f, 'utf8') : 'not available';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders });
      return res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>PROPNIGHT 2</title><body style="background:#0b0d10;color:#cfd6dd;font:15px/1.7 system-ui;max-width:760px;margin:24px auto;padding:0 16px"><pre style="white-space:pre-wrap;font:inherit">${body.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre><p><a style="color:#8ab" href="/">← PROPNIGHT 2</a></p>`);
    }
    let rel = normalize(path).replace(/^([/\\])+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = resolve(join(opts.staticDir, rel));
    if (!file.startsWith(opts.staticDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders });
      return res.end('not found');
    }
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      ...securityHeaders,
    });
    createReadStream(file).pipe(res);
  };

  const server = opts.tlsCert && opts.tlsKey
    ? createHttps({ cert: readFileSync(opts.tlsCert), key: readFileSync(opts.tlsKey) }, handler)
    : createHttp(handler);

  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });

  const clientIp = (req: IncomingMessage) => {
    if (opts.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    // Origin check: same-origin by default; extra origins via ALLOWED_ORIGINS.
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host ?? '';
      let ok = false;
      try { ok = new URL(origin).host === host; } catch { ok = false; }
      if (!ok && !opts.allowedOrigins.includes(origin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    }
    const ip = clientIp(req);
    if ((perIp.get(ip) ?? 0) >= opts.maxConnPerIp) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  wss.on('connection', (ws, _req, ip: string) => {
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const c = new Conn(randomBytes(6).toString('hex'), ws, ip);
    conns.add(c);
    let strikes = 0;
    const helloTimer = setTimeout(() => { if (!c.helloDone) c.kick('hello_timeout', '接続の初期化がタイムアウトしました'); }, 6000);

    ws.on('message', (data, isBinary) => {
      try { onMessage(data, isBinary); }
      catch (e) { console.error('[ws] message handler error:', e); }
    });
    const onMessage = (data: unknown, isBinary: boolean) => {
      if (isBinary || c.closed) return;
      if (!c.bucket.take()) { if (++strikes > 300) c.kick('flood', '送信が多すぎます'); return; }
      let raw: unknown;
      try { raw = JSON.parse(String(data)); } catch { return; }
      const m = validateClientMsg(raw);
      if (!m) return;

      if (m.t === 'hello') {
        if (c.helloDone) return;
        if (m.v !== PROTOCOL_VERSION) return c.kick('version', 'クライアントのバージョンが古いです。ページを再読み込みしてください');
        let name = sanitizeName(m.name);
        let nameRejected = false;
        if (!name) { nameRejected = !!m.name.trim(); name = guestName(m.token ?? c.id); }
        // limit creation of brand-new profiles per IP (abuse / storage protection)
        if (!m.token) {
          const arr = (newProfiles.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
          if (arr.length >= opts.maxNewProfilesPerHour) return c.kick('rate', '新規プロフィールの作成が多すぎます。しばらくしてからお試しください');
          arr.push(Date.now()); newProfiles.set(ip, arr);
        }
        const o = profiles.open(m.token, name);
        c.rec = o.rec; c.token = o.token; c.name = name; c.helloDone = true;
        clearTimeout(helloTimer);
        // the same player reconnecting: drop the stale socket first
        const old = byPub.get(c.rec.pub);
        if (old && old !== c) { old.closed = true; try { old.ws.close(4001, 'replaced'); } catch { /* */ } rooms.leave(old, true); }
        byPub.set(c.rec.pub, c);
        c.send({ t: 'welcome', token: o.token, profile: profiles.info(c.rec), v: PROTOCOL_VERSION, serverTime: Date.now() });
        if (nameRejected) c.send({ t: 'err', code: 'name_rejected', msg: '不適切な名前のため、ゲスト名にしました' });
        if (!rooms.resume(c)) c.send({ t: 'room', room: null });
        return;
      }
      if (!c.helloDone) return;

      switch (m.t) {
        case 'quick': rooms.quick(c); break;
        case 'create': rooms.create(c); break;
        case 'join': rooms.join(c, m.code); break;
        case 'leave': rooms.leave(c); break;
        case 'pick': rooms.pick(c, m.char); break;
        case 'setmap': rooms.setMap(c, m.map); break;
        case 'start': rooms.startCustom(c); break;
        case 'killer': rooms.killerPick(c, m.id); break;
        case 'in': c.room?.match?.input(c, m); break;
        case 'act': c.room?.match?.act(c, m.a, m.d ?? 99); break;
        case 'chat': {
          const now = Date.now();
          if (now - c.lastChat < 1500) break;
          c.lastChat = now;
          c.room?.match?.chat(c, m.id);
          break;
        }
        case 'report': rooms.report(c, m.pub, m.why); break;
        case 'ping': c.send({ t: 'pong', c: m.c, s: Date.now() }); break;
      }
    };

    ws.on('close', () => {
      clearTimeout(helloTimer);
      c.closed = true;
      conns.delete(c);
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
      if (c.helloDone) {
        if (byPub.get(c.rec.pub) === c) byPub.delete(c.rec.pub);
        rooms.leave(c, true);
      }
    });
    ws.on('error', () => { /* handled by close */ });
  });

  return new Promise<{ close: () => Promise<void>; port: number; rooms: Rooms; profiles: Profiles }>((ok) => {
    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      ok({
        port, rooms, profiles,
        close: () => new Promise<void>((done) => {
          rooms.stop(); profiles.flush();
          for (const c of conns) { try { c.ws.terminate(); } catch { /* */ } }
          server.close(() => done());
        }),
      });
    });
  });
}

// Run directly (not when imported by tests)
const isMain = process.argv[1] && /server[\\/](src[\\/])?index\.(ts|js)$|dist[\\/]server\.js$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.env.PN_RUN === '1') {
  const opts = loadOptions();
  startServer(opts).then((s) => {
    const scheme = opts.tlsCert ? 'https' : 'http';
    console.log(`[propnight2] listening on ${scheme}://${opts.host}:${s.port}  (ws path /ws)`);
    console.log(`[propnight2] static: ${opts.staticDir}   data: ${opts.dataDir}`);
    if (!existsSync(join(opts.staticDir, 'index.html'))) console.warn('[propnight2] WARNING: client not built yet. Run "npm run build".');
    if (!opts.tlsCert && opts.host !== '127.0.0.1') console.warn('[propnight2] NOTE: no TLS configured. For public play put a TLS reverse proxy (see deploy/) so browsers use wss://.');
    const stop = async () => { await s.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    // keep serving other players if a single code path throws; the error is logged for the operator
    process.on('uncaughtException', (e) => console.error('[fatal-ish] uncaughtException:', e));
    process.on('unhandledRejection', (e) => console.error('[warn] unhandledRejection:', e));
  });
}
