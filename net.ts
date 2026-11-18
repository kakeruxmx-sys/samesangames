// WebSocket client: hello/token handshake, ping/RTT, automatic reconnect (the server keeps the seat for 60 s).
import { PROTOCOL_VERSION } from '../../shared/constants';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

type Handler = (m: any) => void;

/** `?profile=a` keeps a separate guest profile in this browser (for testing several tabs on one machine). */
export const PROFILE_SUFFIX = (() => { try { const v = (new URLSearchParams(location.search).get('profile') ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8); return v ? '_' + v : ''; } catch { return ''; } })();
export const TOKEN_KEY = 'pn2_token' + PROFILE_SUFFIX;

export class Net {
  ws: WebSocket | null = null;
  handlers = new Map<string, Handler[]>();
  status: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' = 'idle';
  rtt = 0;
  token = '';
  name = '';
  private pingTimer: number | null = null;
  private retry = 0;
  private wantOpen = false;
  onStatus: (s: Net['status'], info?: string) => void = () => {};
  fatal: string | null = null;

  constructor() {
    try { this.token = localStorage.getItem(TOKEN_KEY) ?? ''; } catch { /* storage blocked */ }
  }

  url(): string {
    const q = new URLSearchParams(location.search);
    const override = q.get('server');
    if (override) return override;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  on(type: string, fn: Handler) { const a = this.handlers.get(type) ?? []; a.push(fn); this.handlers.set(type, a); return () => { this.handlers.set(type, (this.handlers.get(type) ?? []).filter((x) => x !== fn)); }; }

  connect(name: string): Promise<void> {
    this.name = name; this.wantOpen = true; this.fatal = null;
    return new Promise((resolve, reject) => {
      const open = () => {
        this.status = this.retry ? 'reconnecting' : 'connecting'; this.onStatus(this.status);
        let ws: WebSocket;
        try { ws = new WebSocket(this.url()); } catch (e) { reject(e); return; }
        this.ws = ws;
        let welcomed = false;
        ws.onopen = () => { this.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.token || undefined, name: this.name }); };
        ws.onmessage = (ev) => {
          let m: ServerMsg;
          try { m = JSON.parse(ev.data as string); } catch { return; }
          if (m.t === 'welcome') {
            this.token = m.token;
            try { localStorage.setItem(TOKEN_KEY, m.token); } catch { /* ignore */ }
            welcomed = true; this.retry = 0; this.status = 'open'; this.onStatus('open');
            this.startPing(); resolve();
          } else if (m.t === 'pong') { this.rtt = Math.round(performance.now() - m.c); }
          else if (m.t === 'err' && ['version', 'flood', 'rate', 'hello_timeout'].includes(m.code)) { this.fatal = m.msg; }
          for (const h of this.handlers.get(m.t) ?? []) h(m);
          for (const h of this.handlers.get('*') ?? []) h(m);
        };
        ws.onclose = (ev) => {
          this.stopPing();
          if (!this.wantOpen || this.fatal || ev.code === 4001) { this.status = 'closed'; this.onStatus('closed', this.fatal ?? (ev.code === 4001 ? '別の場所からログインされました' : undefined)); if (!welcomed) reject(new Error('closed')); return; }
          this.retry++;
          this.status = 'reconnecting'; this.onStatus('reconnecting');
          if (this.retry > 40) { this.status = 'closed'; this.onStatus('closed', '再接続できませんでした'); if (!welcomed) reject(new Error('closed')); return; }
          setTimeout(open, Math.min(4000, 400 * this.retry));
        };
        ws.onerror = () => { /* onclose follows */ };
      };
      open();
    });
  }

  send(m: ClientMsg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.wantOpen = false; this.stopPing(); const w = this.ws; this.ws = null; if (w) { w.onclose = null; w.onmessage = null; try { w.close(); } catch { /* */ } } this.status = 'closed'; }
  private startPing() { this.stopPing(); this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: Math.floor(performance.now()) }), 2000); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}
