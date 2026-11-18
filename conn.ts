import type WebSocket from 'ws';
import type { ServerMsg } from '../../shared/protocol';
import type { ProfileRec } from './profiles';
import { TokenBucket } from './validation';

/** One connected human. There is no bot/AI connection type anywhere in this codebase. */
export class Conn {
  rec!: ProfileRec;
  token = '';
  name = 'Guest';
  char = 0;
  helloDone = false;
  closed = false;
  room: import('./rooms').Room | null = null;
  bucket = new TokenBucket(120, 160); // messages/s (input is 30/s)
  lastChat = 0;
  lastReport = 0;
  reports = 0;
  constructor(public id: string, public ws: WebSocket, public ip: string) {}

  send(msg: ServerMsg) {
    if (this.closed || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(msg)); } catch { /* socket closing */ }
  }
  kick(code: string, msg: string) {
    this.send({ t: 'err', code, msg });
    this.closed = true;
    try { this.ws.close(4000, code); } catch { /* ignore */ }
  }
}
