export type DrawObject =
  | { type: 'Line'; p1: [number, number]; p2: [number, number] }
  | { type: 'Circle'; center: [number, number]; radius: number }
  | { type: 'Rect'; x: number; y: number; w: number; h: number }
  | { type: 'TRIANGLE' | 'HEXAGON' | 'OCTAGON'; center: [number, number]; radius: number }
  | { type: 'POLYLINE' | 'SPLINE'; points: [number, number][] };

export type ClientMessage =
  | { type: 'AddObject'; object: DrawObject }
  | { type: 'UpdatePoint'; id: string; x: number; y: number }
  | { type: 'ExportGCode' };

export type ServerMessage =
  | { type: 'GCode'; content: string }
  | { type: 'UpdateHistory'; items: string[] }
  | { type: 'Error'; message: string };

export class ThorClient {
  private ws: WebSocket | null = null;
  private onMessageCallback: (msg: ServerMessage) => void = () => {};

  constructor(url: string) {
    // In dev mode, we might want to override the URL to point to the Rust server
    const socketUrl = window.location.port === '5173' 
        ? `ws://127.0.0.1:3000/ws` 
        : url;
        
    this.ws = new WebSocket(socketUrl);
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.onMessageCallback(msg);
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    };
  }

  onMessage(callback: (msg: ServerMessage) => void) {
    this.onMessageCallback = callback;
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  updatePoint(id: string, x: number, y: number) {
    this.send({ type: 'UpdatePoint', id, x, y });
  }

  generateToolpath() {
    this.send({ type: 'ExportGCode' });
  }
}
