export class ThorClient {
  private ws: WebSocket | null = null;
  private onMessageCallback: (msg: any) => void = () => {};

  constructor(url: string) {
    // In dev mode, we might want to override the URL to point to the Rust server
    const socketUrl = window.location.port === '5173' 
        ? `ws://127.0.0.1:3000/ws` 
        : url;
        
    this.ws = new WebSocket(socketUrl);
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.onMessageCallback(msg);
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    };
  }

  onMessage(callback: (msg: any) => void) {
    this.onMessageCallback = callback;
  }

  send(msg: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  updatePoint(id: string, x: number, y: number) {
    this.send({ type: 'UpdatePoint', id, x, y });
  }

  generateToolpath() {
    this.send({ type: 'GenerateToolpath' });
  }
}
