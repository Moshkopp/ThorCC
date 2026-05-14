export type DrawObject =
  | { type: 'Line'; p1: [number, number]; p2: [number, number] }
  | { type: 'Circle'; center: [number, number]; radius: number }
  | { type: 'Rect'; x: number; y: number; w: number; h: number }
  | { type: 'TRIANGLE' | 'HEXAGON' | 'OCTAGON'; center: [number, number]; radius: number }
  | { type: 'POLYLINE' | 'SPLINE'; points: [number, number][] };

export type SketchPoint = { x: number; y: number } | [number, number];

export type SketchEntity =
  | { Point: { id: string; pos: SketchPoint } }
  | { Line: { id: string; p1: string; p2: string } }
  | { Circle: { id: string; center: string; radius: number } }
  | { Arc: { id: string; center: string; start: string; end: string } };

export type Sketch = {
  entities: SketchEntity[];
  constraints: unknown[];
};

export type DimensionTarget =
  | { HorizontalDistance: { first: string; second?: string | null } }
  | { VerticalDistance: { first: string; second?: string | null } }
  | { PointDistance: { first: string; second: string } }
  | { LineLength: { line: string } }
  | { CircleRadius: { circle: string } }
  | { CircleDiameter: { circle: string } }
  | { LineAngle: { line: string } }
  | { LineToLineAngle: { first: string; second: string } };

export type DimensionAnnotation = {
  target: DimensionTarget;
  value: number;
  offset: [number, number];
};

export type SketchConstraint =
  | { Horizontal: string }
  | { Vertical: string }
  | { Parallel: [string, string] }
  | { Perpendicular: [string, string] }
  | { EqualLength: [string, string] };

export type ClientMessage =
  | { type: 'AddObject'; object: DrawObject }
  | { type: 'AddConstraint'; constraint: SketchConstraint }
  | { type: 'AddDimension'; target: DimensionTarget; value: number; offset?: [number, number] }
  | { type: 'UpdatePoint'; id: string; x: number; y: number }
  | { type: 'ExportGCode' };

export type ServerMessage =
  | { type: 'GCode'; content: string }
  | { type: 'Sketch'; sketch: Sketch; annotations?: DimensionAnnotation[] }
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
