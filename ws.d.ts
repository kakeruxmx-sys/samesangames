// Minimal typings for the subset of "ws" used by this project (kept local so the project type-checks
// even where @types/ws is unavailable). Runtime is the real "ws" package.
declare module 'ws' {
  import { IncomingMessage, Server as HttpServer } from 'node:http';
  import { Duplex } from 'node:stream';
  import { EventEmitter } from 'node:events';

  type RawData = Buffer | ArrayBuffer | Buffer[];

  class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    constructor(url: string, opts?: { headers?: Record<string, string>; origin?: string });
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(ev: 'message', cb: (data: RawData, isBinary: boolean) => void): this;
    on(ev: 'open', cb: () => void): this;
    on(ev: 'close', cb: (code: number, reason: Buffer) => void): this;
    on(ev: 'error', cb: (err: Error) => void): this;
    on(ev: string, cb: (...a: any[]) => void): this;
  }

  class WebSocketServer extends EventEmitter {
    constructor(opts: { noServer?: boolean; server?: HttpServer; maxPayload?: number; perMessageDeflate?: boolean });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void;
    on(ev: 'connection', cb: (ws: WebSocket, req: IncomingMessage, ip: string) => void): this;
    on(ev: string, cb: (...a: any[]) => void): this;
    close(cb?: () => void): void;
  }

  export { WebSocket, WebSocketServer, RawData };
  export default WebSocket;
}
