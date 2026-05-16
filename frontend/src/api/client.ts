export type DrawObject =
  | { type: 'Line'; p1: [number, number]; p2: [number, number] }
  | { type: 'Circle'; center: [number, number]; radius: number }
  | { type: 'Rect'; x: number; y: number; w: number; h: number }
  | { type: 'TRIANGLE' | 'PENTAGON' | 'HEXAGON' | 'OCTAGON'; center: [number, number]; radius: number }
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

export type SavedProject = {
  name: string;
  sketch: Sketch;
  annotations: DimensionAnnotation[];
};

export type ProjectVersionEntry = {
  version: number;
  saved_at: number;
  comment?: string | null;
  project: SavedProject;
};

export type ProjectEntry = {
  id: string;
  name: string;
  versions: number;
  current_version: number;
  updated_at: number;
  version_entries: ProjectVersionEntry[];
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
  | { type: 'UpdateDimensionValue'; index: number; value: number }
  | { type: 'UpdateDimensionOffset'; index: number; offset: [number, number] }
  | { type: 'DeleteSelection'; entities: string[]; dimensions: number[] }
  | { type: 'SketchUndo' }
  | { type: 'SketchRedo' }
  | { type: 'ListProjects' }
  | { type: 'QuickSaveProject' }
  | { type: 'SaveProject'; name: string; comment?: string | null }
  | { type: 'LoadProject'; id: string; version?: number | null }
  | { type: 'DeleteProject'; id: string }
  | { type: 'ExportProject'; id?: string | null; version?: number | null }
  | { type: 'ImportProject'; name?: string | null; content: string }
  | { type: 'UpdatePoint'; id: string; x: number; y: number }
  | { type: 'UpdatePoints'; points: { id: string; x: number; y: number }[] }
  | { type: 'UpdateCircleRadius'; id: string; radius: number }
  | { type: 'ExportGCode' };

export type ServerMessage =
  | { type: 'GCode'; content: string }
  | { type: 'Sketch'; name?: string; sketch: Sketch; annotations?: DimensionAnnotation[] }
  | { type: 'ProjectList'; projects: ProjectEntry[] }
  | { type: 'ProjectExport'; filename: string; content: string }
  | { type: 'UpdateHistory'; items: string[] }
  | { type: 'Error'; message: string };

export class ThorClient {
  private ws: WebSocket | null = null;
  private onMessageCallback: (msg: ServerMessage) => void = () => {};
  private onOpenCallback: () => void = () => {};

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
    this.ws.onopen = () => this.onOpenCallback();
  }

  onMessage(callback: (msg: ServerMessage) => void) {
    this.onMessageCallback = callback;
  }

  onOpen(callback: () => void) {
    this.onOpenCallback = callback;
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  updatePoint(id: string, x: number, y: number) {
    this.send({ type: 'UpdatePoint', id, x, y });
  }

  updatePoints(points: { id: string; x: number; y: number }[]) {
    this.send({ type: 'UpdatePoints', points });
  }

  generateToolpath() {
    this.send({ type: 'ExportGCode' });
  }
}
