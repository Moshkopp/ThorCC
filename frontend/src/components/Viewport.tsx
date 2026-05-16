import { Component, createEffect, onMount, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { DimensionAnnotation, DimensionTarget, DrawObject, Sketch, SketchConstraint } from '../api/client';

interface ViewportProps {
  mode: 'Sketch' | 'Nesting' | 'CAM' | 'Simulation';
  activeTool: string | null;
  toolActionVersion: number;
  sketch: Sketch | null;
  annotations: DimensionAnnotation[];
  onObjectAdded: (obj: DrawObject) => void;
  onDimensionAdded: (target: DimensionTarget, value: number, offset?: [number, number]) => void;
  onDimensionChanged: (index: number, value: number) => void;
  onDimensionMoved: (index: number, offset: [number, number]) => void;
  onConstraintAdded: (constraint: SketchConstraint) => void;
  onPointsMoved: (points: { id: string; x: number; y: number }[]) => void;
  onSelectionDeleted: (entities: string[], dimensions: number[]) => void;
  onSelectTool: () => void;
  onFeedback: (message: string) => void;
}

type SelectableKind = 'line' | 'circle' | 'point' | 'dimension';
type DimensionMode = 'line' | 'radius' | 'diameter';

interface SelectableMeta {
  entityId: string;
  kind: SelectableKind;
  label: string;
  length?: number;
  radius?: number;
  start?: THREE.Vector3;
  end?: THREE.Vector3;
  center?: THREE.Vector3;
  pointId?: string;
  pos?: THREE.Vector3;
  p1?: string;
  p2?: string;
  centerPoint?: string;
  annotationIndex?: number;
}

interface DimensionDraft {
  meta: SelectableMeta;
  mode: DimensionMode;
  offsetPoint: THREE.Vector3;
  preview: THREE.Object3D;
}

interface DimensionAnnotation {
  meta: SelectableMeta;
  mode: DimensionMode;
  offsetPoint: THREE.Vector3;
  value: number;
  object: THREE.Object3D;
}

interface DragState {
  object: THREE.Object3D;
  startWorld: THREE.Vector3;
  updates: Map<string, THREE.Vector3>;
  originals: Map<string, THREE.Vector3>;
  dimensionOffsets: Map<number, THREE.Vector3>;
  moved: boolean;
}

interface DimensionDragState {
  index: number;
  startWorld: THREE.Vector3;
  originalOffset: THREE.Vector3;
  moved: boolean;
}

const CAD_COLORS = {
  sketch: 0x38b8c8,
  sketchMuted: 0x287f8f,
  selected: 0xd99a38,
  preview: 0xc9d1d4,
  dimension: 0xc9a24f,
  dimensionText: '#d8c48a',
  constraint: '#aeb7ba',
  grid: 0x263238,
  gridCenter: 0x506068,
  axisX: 0x7b5f55,
  axisY: 0x566b62,
};

const Viewport: Component<ViewportProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.OrthographicCamera;
  let controls: OrbitControls;
  let raycaster = new THREE.Raycaster();
  let mouse = new THREE.Vector2();
  let gridPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  
  let tempObject: THREE.Object3D | null = null;
  let isDrawing = false;
  let startPoint: THREE.Vector3 | null = null;
  let polyPoints: THREE.Vector3[] = [];
  let selected: THREE.Object3D[] = [];
  let selectionDrag: { start: { x: number; y: number }; current: { x: number; y: number }; active: boolean } | null = null;
  let dragState: DragState | null = null;
  let dimensionDragState: DimensionDragState | null = null;
  let selectionBox: HTMLDivElement | null = null;
  let dimensionDraft: DimensionDraft | null = null;
  let valueInput: HTMLInputElement | null = null;
  let animationFrame = 0;
  let syncFrame = 0;
  const dimensions: DimensionAnnotation[] = [];
  const selectables: THREE.Object3D[] = [];
  const dimensionSelectables: THREE.Object3D[] = [];
  const sketchObjects: THREE.Object3D[] = [];
  const geometryTools = new Set(['line', 'circle', 'rect', 'triangle', 'polyline', 'hexagon', 'octagon', 'spline']);
  const constraintTools = new Set(['horiz', 'vert', 'parallel', 'coincident', 'equal', 'dimension', 'radius', 'diameter', 'angle']);

  onMount(() => {
    if (!containerRef) return;

    scene = new THREE.Scene();
    const aspect = containerRef.clientWidth / containerRef.clientHeight;
    const viewHeight = 400;
    const viewWidth = viewHeight * aspect;
    camera = new THREE.OrthographicCamera(
      -viewWidth / 2,
      viewWidth / 2,
      viewHeight / 2,
      -viewHeight / 2,
      0.1,
      2000
    );
    camera.position.set(0, 0, 200);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    containerRef.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    raycaster.params.Line!.threshold = 4;

    const grid = new THREE.GridHelper(400, 40, CAD_COLORS.gridCenter, CAD_COLORS.grid);
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    grid.rotateX(Math.PI / 2);
    scene.add(grid);

    const axisMaterial = (color: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    const axes = new THREE.Group();
    axes.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, 0, 0.01), new THREE.Vector3(200, 0, 0.01)]),
      axisMaterial(CAD_COLORS.axisX)
    ));
    axes.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -200, 0.01), new THREE.Vector3(0, 200, 0.01)]),
      axisMaterial(CAD_COLORS.axisY)
    ));
    scene.add(axes);

    const worldUnitsPerPixel = () => (camera.top - camera.bottom) / (containerRef!.clientHeight * camera.zoom);

    const updateScreenStableSprites = () => {
        const worldPixel = worldUnitsPerPixel();
        scene.traverse((object) => {
            const screenSize = object.userData.screenSize as { width: number; height: number } | undefined;
            if (screenSize && object instanceof THREE.Sprite) {
                object.scale.set(screenSize.width * worldPixel, screenSize.height * worldPixel, 1);
            }
        });
    };

    const handleResize = () => {
      if (!containerRef) return;
      const aspect = containerRef.clientWidth / containerRef.clientHeight;
      const height = camera.top - camera.bottom;
      const width = height * aspect;
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    };

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      controls.update();
      updateScreenStableSprites();
      renderer.render(scene, camera);
    };
    animate();

    const getIntersectPoint = (e: MouseEvent) => {
        const rect = containerRef!.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(gridPlane, intersectPoint);
        intersectPoint.x = Math.round(intersectPoint.x / 5) * 5;
        intersectPoint.y = Math.round(intersectPoint.y / 5) * 5;
        return intersectPoint;
    };

    const cancelActiveAction = () => {
        if (tempObject) {
            scene.remove(tempObject);
            tempObject = null;
        }
        if (selectionBox) {
            selectionBox.remove();
            selectionBox = null;
        }
        selectionDrag = null;
        dragState = null;
        dimensionDragState = null;
        if (dimensionDraft) {
            scene.remove(dimensionDraft.preview);
            dimensionDraft = null;
        }
        if (valueInput) {
            valueInput.remove();
            valueInput = null;
        }
        isDrawing = false;
        startPoint = null;
        polyPoints = [];
        clearSelection();
        controls.enabled = true;
    };

    const setObjectColor = (object: THREE.Object3D, color: number) => {
        const material = (object as any).material;
        if (material?.color) material.color.set(color);
    };

    const clearSelection = () => {
        selected.forEach((object) => {
            const meta = object.userData.meta as SelectableMeta | undefined;
            setObjectColor(object, meta?.kind === 'dimension' ? 0xffffff : CAD_COLORS.sketch);
        });
        selected = [];
    };

    const pointSpriteMaterial = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d')!;
        ctx.strokeStyle = 'rgba(215, 220, 221, 0.88)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(20, 20, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(56, 184, 200, 0.34)';
        ctx.beginPath();
        ctx.arc(20, 20, 6, 0, Math.PI * 2);
        ctx.fill();
        const texture = new THREE.CanvasTexture(canvas);
        return new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    };

    const clearDimensions = () => {
        for (const dimension of dimensions) {
            if (dimension) scene.remove(dimension.object);
        }
        dimensions.length = 0;
        while (dimensionSelectables.length) dimensionSelectables.pop();
    };

    const clearSketchObjects = () => {
        clearSelection();
        while (selectables.length) selectables.pop();
        while (sketchObjects.length) {
            const object = sketchObjects.pop()!;
            scene.remove(object);
        }
    };

    const addSelectable = (object: THREE.Object3D, meta: SelectableMeta) => {
        object.userData.selectable = true;
        object.userData.meta = meta;
        selectables.push(object);
        sketchObjects.push(object);
        scene.add(object);
    };

    const makeLine = (start: THREE.Vector3, end: THREE.Vector3, id: string, label: string) => {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]),
          new THREE.LineBasicMaterial({ color: CAD_COLORS.sketch, transparent: true, opacity: 0.86 })
        );
        addSelectable(line, {
          entityId: id,
          kind: 'line',
          label,
          length: start.distanceTo(end),
          start: start.clone(),
          end: end.clone(),
          p1: '',
          p2: '',
        });
    };

    const makeSketchLine = (start: THREE.Vector3, end: THREE.Vector3, id: string, label: string, p1: string, p2: string) => {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]),
          new THREE.LineBasicMaterial({ color: CAD_COLORS.sketch, transparent: true, opacity: 0.86 })
        );
        addSelectable(line, {
          entityId: id,
          kind: 'line',
          label,
          length: start.distanceTo(end),
          start: start.clone(),
          end: end.clone(),
          p1,
          p2,
        });
    };

    const makePointHandle = (id: string, position: THREE.Vector3) => {
        const sprite = new THREE.Sprite(pointSpriteMaterial());
        sprite.position.copy(position);
        sprite.userData.screenSize = { width: 16, height: 16 };
        sprite.renderOrder = 40;
        addSelectable(sprite, {
          entityId: id,
          kind: 'point',
          label: id,
          pointId: id,
          pos: position.clone(),
        });
    };

    const worldToScreen = (point: THREE.Vector3) => {
        const projected = point.clone().project(camera);
        return {
          x: (projected.x * 0.5 + 0.5) * containerRef!.clientWidth,
          y: (-projected.y * 0.5 + 0.5) * containerRef!.clientHeight,
        };
    };

    const mouseToLocal = (e: MouseEvent) => {
        const rect = containerRef!.getBoundingClientRect();
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
    };

    const makeScreenBox = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        left: Math.min(a.x, b.x),
        right: Math.max(a.x, b.x),
        top: Math.min(a.y, b.y),
        bottom: Math.max(a.y, b.y),
    });

    const pointInBox = (point: { x: number; y: number }, box: { left: number; right: number; top: number; bottom: number }) =>
        point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

    const boxesIntersect = (
      a: { left: number; right: number; top: number; bottom: number },
      b: { left: number; right: number; top: number; bottom: number }
    ) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

    const segmentIntersectsBox = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      box: { left: number; right: number; top: number; bottom: number }
    ) => {
        if (pointInBox(a, box) || pointInBox(b, box)) return true;
        const ccw = (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) =>
            (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
        const intersects = (
          p1: { x: number; y: number },
          p2: { x: number; y: number },
          p3: { x: number; y: number },
          p4: { x: number; y: number }
        ) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
        const corners = [
          { x: box.left, y: box.top },
          { x: box.right, y: box.top },
          { x: box.right, y: box.bottom },
          { x: box.left, y: box.bottom },
        ];
        return corners.some((corner, index) => intersects(a, b, corner, corners[(index + 1) % corners.length]));
    };

    const distanceToSegment = (
      point: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq <= 1e-6) return Math.hypot(point.x - a.x, point.y - a.y);
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
        return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    };

    const screenHitDistance = (object: THREE.Object3D, point: { x: number; y: number }) => {
        const meta = metaOf(object);
        if (meta.kind === 'line' && meta.start && meta.end) {
            return distanceToSegment(point, worldToScreen(meta.start), worldToScreen(meta.end));
        }
        if (meta.kind === 'circle' && meta.center && meta.radius !== undefined) {
            const center = worldToScreen(meta.center);
            const edge = worldToScreen(meta.center.clone().add(new THREE.Vector3(meta.radius, 0, 0)));
            const radius = Math.abs(edge.x - center.x);
            return Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius);
        }
        if (meta.kind === 'point' && meta.pos) {
            const center = worldToScreen(meta.pos);
            return Math.hypot(point.x - center.x, point.y - center.y);
        }
        return Number.POSITIVE_INFINITY;
    };

    const selectableScreenBox = (object: THREE.Object3D) => {
        const meta = metaOf(object);
        if (meta.kind === 'line' && meta.start && meta.end) {
            const a = worldToScreen(meta.start);
            const b = worldToScreen(meta.end);
            return {
              left: Math.min(a.x, b.x),
              right: Math.max(a.x, b.x),
              top: Math.min(a.y, b.y),
              bottom: Math.max(a.y, b.y),
              line: { a, b },
            };
        }
        if (meta.kind === 'circle' && meta.center && meta.radius !== undefined) {
            const center = worldToScreen(meta.center);
            const edge = worldToScreen(meta.center.clone().add(new THREE.Vector3(meta.radius, 0, 0)));
            const radius = Math.abs(edge.x - center.x);
            return {
              left: center.x - radius,
              right: center.x + radius,
              top: center.y - radius,
              bottom: center.y + radius,
            };
        }
        if (meta.kind === 'point' && meta.pos) {
            const center = worldToScreen(meta.pos);
            const radius = 8;
            return {
              left: center.x - radius,
              right: center.x + radius,
              top: center.y - radius,
              bottom: center.y + radius,
            };
        }
        return null;
    };

    const objectFullyInsideBox = (object: THREE.Object3D, box: { left: number; right: number; top: number; bottom: number }) => {
        const objectBox = selectableScreenBox(object);
        if (!objectBox) return false;
        return objectBox.left >= box.left && objectBox.right <= box.right && objectBox.top >= box.top && objectBox.bottom <= box.bottom;
    };

    const objectCrossesBox = (object: THREE.Object3D, box: { left: number; right: number; top: number; bottom: number }) => {
        const objectBox = selectableScreenBox(object);
        if (!objectBox) return false;
        if (!boxesIntersect(objectBox, box)) return false;
        if ('line' in objectBox) return segmentIntersectsBox(objectBox.line.a, objectBox.line.b, box);
        return true;
    };

    const updateSelectionBox = () => {
        if (!selectionDrag) return;
        const box = makeScreenBox(selectionDrag.start, selectionDrag.current);
        const isWindowSelect = selectionDrag.current.x >= selectionDrag.start.x;
        if (!selectionBox) {
            selectionBox = document.createElement('div');
            selectionBox.className = 'thor-selection-box';
            containerRef!.appendChild(selectionBox);
        }
        selectionBox.style.left = `${box.left}px`;
        selectionBox.style.top = `${box.top}px`;
        selectionBox.style.width = `${box.right - box.left}px`;
        selectionBox.style.height = `${box.bottom - box.top}px`;
        selectionBox.dataset.mode = isWindowSelect ? 'window' : 'crossing';
    };

    const finishSelectionBox = () => {
        if (!selectionDrag) return false;
        const distance = Math.hypot(selectionDrag.current.x - selectionDrag.start.x, selectionDrag.current.y - selectionDrag.start.y);
        if (selectionBox) {
            selectionBox.remove();
            selectionBox = null;
        }
        if (distance < 4) {
            selectionDrag = null;
            return false;
        }
        const box = makeScreenBox(selectionDrag.start, selectionDrag.current);
        const isWindowSelect = selectionDrag.current.x >= selectionDrag.start.x;
        clearSelection();
        selectables
          .filter((object) => isWindowSelect ? objectFullyInsideBox(object, box) : objectCrossesBox(object, box))
          .forEach(selectObject);
        props.onFeedback(`SELECT: ${selected.length} selected (${isWindowSelect ? 'window' : 'crossing'})`);
        selectionDrag = null;
        return true;
    };

    const tickSegment = (point: THREE.Vector3, unit: THREE.Vector3, normal: THREE.Vector3, size = 4) => ([
        point.clone().sub(unit.clone().multiplyScalar(size * 0.55)).sub(normal.clone().multiplyScalar(size * 0.55)),
        point.clone().add(unit.clone().multiplyScalar(size * 0.55)).add(normal.clone().multiplyScalar(size * 0.55)),
    ]);

    const lineDimensionGeometry = (meta: SelectableMeta, offsetPoint: THREE.Vector3, color = CAD_COLORS.dimension) => {
        const start = meta.start!;
        const end = meta.end!;
        const direction = end.clone().sub(start);
        const length = direction.length();
        if (length <= 1e-6) return new THREE.Group();

        const unit = direction.clone().normalize();
        const normal = new THREE.Vector3(-unit.y, unit.x, 0);
        const rawOffset = offsetPoint.clone().sub(start).dot(normal);
        const offset = Math.abs(rawOffset) < 8 ? (rawOffset < 0 ? -8 : 8) : rawOffset;
        const a = start.clone().add(normal.clone().multiplyScalar(offset));
        const b = end.clone().add(normal.clone().multiplyScalar(offset));
        const points = [
          start, a,
          a, b,
          end, b,
          ...tickSegment(a, unit, normal),
          ...tickSegment(b, unit, normal),
        ];
        const group = new THREE.Group();
        group.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 })
        ));
        return group;
    };

    const circleDimensionGeometry = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: 'radius' | 'diameter', color = CAD_COLORS.dimension) => {
        const center = meta.center!;
        const radius = meta.radius ?? 0;
        const direction = offsetPoint.clone().sub(center);
        if (direction.length() <= 1e-6) direction.set(1, 0, 0);
        const unit = direction.normalize();
        const edge = center.clone().add(unit.clone().multiplyScalar(radius));
        const group = new THREE.Group();

        if (mode === 'radius') {
            group.add(new THREE.LineSegments(
              new THREE.BufferGeometry().setFromPoints([center, edge, edge, offsetPoint]),
              new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 })
            ));
        } else {
            const opposite = center.clone().sub(unit.clone().multiplyScalar(radius));
            group.add(new THREE.LineSegments(
              new THREE.BufferGeometry().setFromPoints([opposite, edge, edge, offsetPoint]),
              new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 })
            ));
        }

        group.add(new THREE.Mesh(
          new THREE.RingGeometry(1.2, 1.8, 20),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 })
        ));
        group.children[group.children.length - 1].position.copy(edge);
        return group;
    };

    const makeDimensionLabel = (value: number, position: THREE.Vector3, annotationIndex?: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 180;
        canvas.height = 44;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(12, 16, 17, 0.76)';
        ctx.fillRect(10, 4, canvas.width - 20, canvas.height - 8);
        ctx.fillStyle = CAD_COLORS.dimensionText;
        ctx.font = '700 24px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(value.toFixed(2), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        sprite.position.copy(position);
        sprite.userData.screenSize = { width: 104, height: 28 };
        if (annotationIndex !== undefined) {
            sprite.userData.selectable = true;
            sprite.userData.meta = {
                entityId: `dimension_${annotationIndex}`,
                kind: 'dimension',
                label: `dimension ${annotationIndex + 1}`,
                annotationIndex,
                pos: position.clone(),
            } satisfies SelectableMeta;
            dimensionSelectables.push(sprite);
        }
        sprite.renderOrder = 20;
        return sprite;
    };

    const makeConstraintGlyph = (text: string, position: THREE.Vector3, color = CAD_COLORS.constraint) => {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.font = '700 30px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        sprite.position.copy(position);
        sprite.userData.screenSize = { width: 24, height: 24 };
        sprite.renderOrder = 30;
        sketchObjects.push(sprite);
        scene.add(sprite);
        return sprite;
    };

    const lineBadgePosition = (meta: SelectableMeta, slot = 0) => {
        const start = meta.start!;
        const end = meta.end!;
        const direction = end.clone().sub(start);
        const length = direction.length();
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        if (length <= 1e-6) return midpoint;
        const unit = direction.normalize();
        const normal = new THREE.Vector3(-unit.y, unit.x, 0);
        return midpoint.add(normal.multiplyScalar(8 + slot * 5));
    };

    const findSelectableMeta = (entityId: string) => {
        const object = selectables.find((item) => metaOf(item).entityId === entityId);
        return object ? metaOf(object) : null;
    };

    const renderConstraintMarkers = (constraints: Sketch['constraints']) => {
        const slotByEntity = new Map<string, number>();
        const rendered = new Set<string>();
        const nextSlot = (entityId: string) => {
            const slot = slotByEntity.get(entityId) ?? 0;
            slotByEntity.set(entityId, slot + 1);
            return slot;
        };
        const renderLineMarker = (entityId: string, label: string, color: string) => {
            const key = `${entityId}:${label}`;
            if (rendered.has(key)) return;
            rendered.add(key);
            const meta = findSelectableMeta(entityId);
            if (meta?.kind === 'line') makeConstraintGlyph(label, lineBadgePosition(meta, nextSlot(meta.entityId)), color);
        };

        for (const constraint of constraints as any[]) {
            if ('Horizontal' in constraint) {
                renderLineMarker(constraint.Horizontal, 'H', CAD_COLORS.constraint);
            } else if ('Vertical' in constraint) {
                renderLineMarker(constraint.Vertical, 'V', CAD_COLORS.constraint);
            } else if ('Parallel' in constraint) {
                for (const id of constraint.Parallel as string[]) {
                    renderLineMarker(id, '∥', CAD_COLORS.constraint);
                }
            } else if ('Perpendicular' in constraint) {
                for (const id of constraint.Perpendicular as string[]) {
                    renderLineMarker(id, '⊥', CAD_COLORS.constraint);
                }
            } else if ('EqualLength' in constraint) {
                for (const id of constraint.EqualLength as string[]) {
                    renderLineMarker(id, '=', CAD_COLORS.constraint);
                }
            } else if ('Angle' in constraint) {
                for (const id of [constraint.Angle[0], constraint.Angle[1]]) {
                    renderLineMarker(id, '∠', CAD_COLORS.constraint);
                }
            } else if ('LineAngle' in constraint) {
                renderLineMarker(constraint.LineAngle.line, '∠', CAD_COLORS.constraint);
            }
        }
    };

    const dimensionGeometry = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: DimensionMode) => {
        if (mode === 'line') return lineDimensionGeometry(meta, offsetPoint);
        return circleDimensionGeometry(meta, offsetPoint, mode);
    };

    const dimensionAnnotationObject = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: DimensionMode, value: number, annotationIndex?: number) => {
        const group = new THREE.Group();
        group.add(dimensionGeometry(meta, offsetPoint, mode));
        group.add(makeDimensionLabel(value, offsetPoint, annotationIndex));
        return group;
    };

    const updateDimensionPreview = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: DimensionMode) => {
        if (dimensionDraft) scene.remove(dimensionDraft.preview);
        const preview = dimensionGeometry(meta, offsetPoint, mode);
        scene.add(preview);
        dimensionDraft = { meta, mode, offsetPoint: offsetPoint.clone(), preview };
    };

    const showDimensionInput = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: DimensionMode) => {
        if (valueInput) valueInput.remove();
        const screen = worldToScreen(offsetPoint);
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.1';
        input.value = mode === 'line'
          ? (meta.length ?? 0).toFixed(2)
          : (mode === 'radius' ? meta.radius ?? 0 : (meta.radius ?? 0) * 2).toFixed(2);
        input.className = 'thor-dimension-input';
        input.style.left = `${screen.x}px`;
        input.style.top = `${screen.y}px`;
        containerRef!.appendChild(input);
        valueInput = input;
        requestAnimationFrame(() => {
            input.focus({ preventScroll: true });
            input.select();
        });
        setTimeout(() => {
            if (valueInput === input) {
                input.focus({ preventScroll: true });
                input.select();
            }
        }, 0);

        const commit = () => {
            const value = Number(input.value);
            input.remove();
            valueInput = null;
            if (Number.isFinite(value)) {
                if (mode === 'line') {
                    props.onDimensionAdded({ LineLength: { line: meta.entityId } }, value, [offsetPoint.x, offsetPoint.y]);
                } else if (mode === 'radius') {
                    props.onDimensionAdded({ CircleRadius: { circle: meta.entityId } }, value, [offsetPoint.x, offsetPoint.y]);
                } else {
                    props.onDimensionAdded({ CircleDiameter: { circle: meta.entityId } }, value, [offsetPoint.x, offsetPoint.y]);
                }
                props.onFeedback(`${mode.toUpperCase()} applied to ${meta.label}`);
            }
            clearSelection();
            if (dimensionDraft) {
                scene.remove(dimensionDraft.preview);
                dimensionDraft = null;
            }
        };

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') cancelActiveAction();
        });
    };

    const showDimensionEditInput = (index: number) => {
        const dimension = dimensions[index];
        if (!dimension) return;
        if (valueInput) valueInput.remove();
        const screen = worldToScreen(dimension.offsetPoint);
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.1';
        input.value = dimension.value.toFixed(2);
        input.className = 'thor-dimension-input';
        input.style.left = `${screen.x}px`;
        input.style.top = `${screen.y}px`;
        containerRef!.appendChild(input);
        valueInput = input;
        requestAnimationFrame(() => {
            input.focus({ preventScroll: true });
            input.select();
        });
        setTimeout(() => {
            if (valueInput === input) {
                input.focus({ preventScroll: true });
                input.select();
            }
        }, 0);

        const commit = () => {
            const value = Number(input.value);
            input.remove();
            valueInput = null;
            if (Number.isFinite(value)) {
                props.onDimensionChanged(index, value);
                props.onFeedback(`DIM: value changed to ${value.toFixed(2)}`);
            }
            clearSelection();
        };

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') cancelActiveAction();
        });
    };

    const pointToVector = (pos: { x: number; y: number } | [number, number]) => {
        if (Array.isArray(pos)) return new THREE.Vector3(pos[0], pos[1], 0);
        return new THREE.Vector3(pos.x, pos.y, 0);
    };

    const renderSketch = (sketch: Sketch) => {
        clearSketchObjects();
        const points = new Map<string, THREE.Vector3>();
        for (const entity of sketch.entities) {
            if ('Point' in entity) {
                points.set(entity.Point.id, pointToVector(entity.Point.pos));
            }
        }

        for (const entity of sketch.entities) {
            if ('Line' in entity) {
                const start = points.get(entity.Line.p1);
                const end = points.get(entity.Line.p2);
                if (start && end) makeSketchLine(start, end, entity.Line.id, entity.Line.id, entity.Line.p1, entity.Line.p2);
            }
            if ('Circle' in entity) {
                const center = points.get(entity.Circle.center);
                if (!center) continue;
                const mesh = new THREE.Mesh(
                  new THREE.RingGeometry(entity.Circle.radius - 0.5, entity.Circle.radius + 0.5, 64),
                  new THREE.MeshBasicMaterial({ color: CAD_COLORS.sketch, transparent: true, opacity: 0.86 })
                );
                mesh.position.set(center.x, center.y, 0);
                addSelectable(mesh, {
                  entityId: entity.Circle.id,
                  kind: 'circle',
                  label: entity.Circle.id,
                  radius: entity.Circle.radius,
                  center: center.clone(),
                  centerPoint: entity.Circle.center,
                });
            }
        }
        for (const [id, position] of points) {
            makePointHandle(id, position);
        }
        renderConstraintMarkers(sketch.constraints);
    };

    let lastSketch: Sketch | null = null;
    let lastAnnotations: DimensionAnnotation[] | null = null;

    const metaForAnnotation = (annotation: DimensionAnnotation): { meta: SelectableMeta; mode: DimensionMode } | null => {
        const target = annotation.target;
        if ('LineLength' in target) {
            const object = selectables.find((item) => metaOf(item).entityId === target.LineLength.line);
            return object ? { meta: metaOf(object), mode: 'line' } : null;
        }
        if ('CircleRadius' in target) {
            const object = selectables.find((item) => metaOf(item).entityId === target.CircleRadius.circle);
            return object ? { meta: metaOf(object), mode: 'radius' } : null;
        }
        if ('CircleDiameter' in target) {
            const object = selectables.find((item) => metaOf(item).entityId === target.CircleDiameter.circle);
            return object ? { meta: metaOf(object), mode: 'diameter' } : null;
        }
        return null;
    };

    const renderAnnotations = (annotations: DimensionAnnotation[]) => {
        clearDimensions();
        for (const [index, annotation] of annotations.entries()) {
            const resolved = metaForAnnotation(annotation);
            if (!resolved) continue;
            const offsetPoint = new THREE.Vector3(annotation.offset[0], annotation.offset[1], 0);
            const object = dimensionAnnotationObject(resolved.meta, offsetPoint, resolved.mode, annotation.value, index);
            scene.add(object);
            dimensions[index] = {
                meta: { ...resolved.meta },
                mode: resolved.mode,
                offsetPoint,
                value: annotation.value,
                object,
            };
        }
    };

    const redrawDimension = (index: number, offsetPoint: THREE.Vector3) => {
        const dimension = dimensions[index];
        if (!dimension) return;
        const annotation = props.annotations[index];
        const resolved = annotation ? metaForAnnotation(annotation) : null;
        const meta = resolved?.meta ?? dimension.meta;
        const mode = resolved?.mode ?? dimension.mode;
        scene.remove(dimension.object);
        for (let i = dimensionSelectables.length - 1; i >= 0; i -= 1) {
            const meta = dimensionSelectables[i].userData.meta as SelectableMeta | undefined;
            if (meta?.annotationIndex === index) dimensionSelectables.splice(i, 1);
        }
        const object = dimensionAnnotationObject(meta, offsetPoint, mode, dimension.value, index);
        scene.add(object);
        dimension.object = object;
        dimension.meta = { ...meta };
        dimension.mode = mode;
        dimension.offsetPoint = offsetPoint.clone();
    };

    const nearestSelectable = (e: MouseEvent, tolerancePx = 12) => {
        const rect = containerRef!.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const labelHit = raycaster.intersectObjects(dimensionSelectables, false)[0]?.object;
        if (labelHit) return labelHit;

        const point = mouseToLocal(e);
        let best: { object: THREE.Object3D; distance: number } | null = null;
        for (const object of selectables) {
            const distance = screenHitDistance(object, point);
            if (distance <= tolerancePx && (!best || distance < best.distance)) {
                best = { object, distance };
            }
        }
        return best?.object;
    };

    const handleSelect = (e: MouseEvent) => {
        const object = nearestSelectable(e);
        if (!object) {
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) clearSelection();
            props.onFeedback('SELECT: nothing selected');
            return;
        }
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            toggleSelection(object);
        } else {
            clearSelection();
            selectObject(object);
        }
        props.onFeedback(`SELECT: ${selected.length} selected`);
    };

    const selectObject = (object: THREE.Object3D) => {
        if (!selected.includes(object)) selected.push(object);
        setObjectColor(object, CAD_COLORS.selected);
    };

    const unselectObject = (object: THREE.Object3D) => {
        selected = selected.filter((item) => item !== object);
        const meta = object.userData.meta as SelectableMeta | undefined;
        setObjectColor(object, meta?.kind === 'dimension' ? 0xffffff : CAD_COLORS.sketch);
    };

    const toggleSelection = (object: THREE.Object3D) => {
        if (selected.includes(object)) {
            unselectObject(object);
        } else {
            selectObject(object);
        }
    };

    const metaOf = (object: THREE.Object3D): SelectableMeta => object.userData.meta;

    const deleteSelected = () => {
        const entities = new Set<string>();
        const dimensionsToDelete = new Set<number>();
        for (const object of selected) {
            const meta = metaOf(object);
            if (meta.kind === 'dimension' && meta.annotationIndex !== undefined) {
                dimensionsToDelete.add(meta.annotationIndex);
            } else if (meta.kind === 'line' || meta.kind === 'circle') {
                entities.add(meta.entityId);
            }
        }
        if (entities.size === 0 && dimensionsToDelete.size === 0) {
            props.onFeedback('DELETE: nothing selected');
            return;
        }
        props.onSelectionDeleted([...entities], [...dimensionsToDelete]);
        props.onFeedback('DELETE: selection removed');
        clearSelection();
    };

    const draggablePointIds = (meta: SelectableMeta) => {
        if (meta.kind === 'point' && meta.pointId) return [meta.pointId];
        if (meta.kind === 'line' && meta.p1 && meta.p2) return [meta.p1, meta.p2];
        return [];
    };

    const dragOriginals = (meta: SelectableMeta) => {
        const originals = new Map<string, THREE.Vector3>();
        if (meta.kind === 'point' && meta.pointId && meta.pos) {
            originals.set(meta.pointId, meta.pos.clone());
        }
        if (meta.kind === 'line' && meta.p1 && meta.p2 && meta.start && meta.end) {
            originals.set(meta.p1, meta.start.clone());
            originals.set(meta.p2, meta.end.clone());
        }
        return originals;
    };

    const dimensionOriginalOffsets = () => {
        const offsets = new Map<number, THREE.Vector3>();
        for (const [index, dimension] of dimensions.entries()) {
            if (dimension) offsets.set(index, dimension.offsetPoint.clone());
        }
        return offsets;
    };

    const pointIdsForDimension = (annotation: DimensionAnnotation) => {
        const target = annotation.target;
        if ('HorizontalDistance' in target) {
            return [target.HorizontalDistance.first, target.HorizontalDistance.second].filter(Boolean) as string[];
        }
        if ('VerticalDistance' in target) {
            return [target.VerticalDistance.first, target.VerticalDistance.second].filter(Boolean) as string[];
        }
        if ('PointDistance' in target) return [target.PointDistance.first, target.PointDistance.second];
        if ('LineLength' in target) {
            const meta = findSelectableMeta(target.LineLength.line);
            return meta?.p1 && meta.p2 ? [meta.p1, meta.p2] : [];
        }
        if ('LineAngle' in target) {
            const meta = findSelectableMeta(target.LineAngle.line);
            return meta?.p1 && meta.p2 ? [meta.p1, meta.p2] : [];
        }
        if ('LineToLineAngle' in target) {
            const first = findSelectableMeta(target.LineToLineAngle.first);
            const second = findSelectableMeta(target.LineToLineAngle.second);
            return [first?.p1, first?.p2, second?.p1, second?.p2].filter(Boolean) as string[];
        }
        if ('CircleRadius' in target) {
            const meta = findSelectableMeta(target.CircleRadius.circle);
            return meta?.centerPoint ? [meta.centerPoint] : [];
        }
        if ('CircleDiameter' in target) {
            const meta = findSelectableMeta(target.CircleDiameter.circle);
            return meta?.centerPoint ? [meta.centerPoint] : [];
        }
        return [];
    };

    const updateLineGeometry = (object: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3) => {
        const geometry = (object as THREE.Line).geometry as THREE.BufferGeometry | undefined;
        geometry?.setFromPoints([start, end]);
        geometry?.computeBoundingSphere();
    };

    const applyDragPreview = (updates: Map<string, THREE.Vector3>) => {
        for (const object of selectables) {
            const meta = metaOf(object);
            if (meta.kind === 'point' && meta.pointId) {
                const point = updates.get(meta.pointId);
                if (!point) continue;
                object.position.copy(point);
                meta.pos = point.clone();
            } else if (meta.kind === 'line' && meta.p1 && meta.p2 && meta.start && meta.end) {
                const start = updates.get(meta.p1) ?? meta.start;
                const end = updates.get(meta.p2) ?? meta.end;
                if (!updates.has(meta.p1) && !updates.has(meta.p2)) continue;
                updateLineGeometry(object, start, end);
                meta.start = start.clone();
                meta.end = end.clone();
                meta.length = start.distanceTo(end);
            } else if (meta.kind === 'circle' && meta.centerPoint && meta.center) {
                const center = updates.get(meta.centerPoint);
                if (!center) continue;
                object.position.copy(center);
                meta.center = center.clone();
            }
        }
    };

    const beginDrag = (object: THREE.Object3D, startWorld: THREE.Vector3) => {
        const meta = metaOf(object);
        if (meta.kind === 'dimension') return beginDimensionDrag(meta, startWorld);
        const originals = dragOriginals(meta);
        if (originals.size === 0) return false;
        if (!selected.includes(object)) {
            clearSelection();
            selectObject(object);
        }
        dragState = {
            object,
            startWorld: startWorld.clone(),
            originals,
            updates: new Map(originals),
            dimensionOffsets: dimensionOriginalOffsets(),
            moved: false,
        };
        controls.enabled = false;
        props.onFeedback(`${meta.kind.toUpperCase()}: drag to move`);
        return true;
    };

    const beginDimensionDrag = (meta: SelectableMeta, startWorld: THREE.Vector3) => {
        if (meta.annotationIndex === undefined) return false;
        const dimension = dimensions[meta.annotationIndex];
        if (!dimension) return false;
        clearSelection();
        const object = dimensionSelectables.find((item) => (item.userData.meta as SelectableMeta | undefined)?.annotationIndex === meta.annotationIndex);
        if (object) selectObject(object);
        dimensionDragState = {
            index: meta.annotationIndex,
            startWorld: startWorld.clone(),
            originalOffset: dimension.offsetPoint.clone(),
            moved: false,
        };
        controls.enabled = false;
        props.onFeedback('DIM: drag label to reposition');
        return true;
    };

    const updateDrag = (point: THREE.Vector3) => {
        if (!dragState) return;
        const delta = point.clone().sub(dragState.startWorld);
        dragState.moved = dragState.moved || delta.length() >= 0.5;
        const updates = new Map<string, THREE.Vector3>();
        for (const [id, original] of dragState.originals) {
            updates.set(id, original.clone().add(delta));
        }
        dragState.updates = updates;
        applyDragPreview(updates);
        applyDimensionMovePreview(dragState);
    };

    const applyDimensionMovePreview = (state: DragState) => {
        for (const [index, annotation] of props.annotations.entries()) {
            const originalOffset = state.dimensionOffsets.get(index);
            if (!originalOffset) continue;
            const deltas = pointIdsForDimension(annotation)
                .filter((id) => state.originals.has(id) && state.updates.has(id))
                .map((id) => state.updates.get(id)!.clone().sub(state.originals.get(id)!));
            if (deltas.length === 0) continue;

            const average = deltas
                .reduce((sum, delta) => sum.add(delta), new THREE.Vector3())
                .multiplyScalar(1 / deltas.length);
            redrawDimension(index, originalOffset.clone().add(average));
        }
    };

    const updateDimensionDrag = (point: THREE.Vector3) => {
        if (!dimensionDragState) return;
        const delta = point.clone().sub(dimensionDragState.startWorld);
        dimensionDragState.moved = dimensionDragState.moved || delta.length() >= 0.5;
        redrawDimension(dimensionDragState.index, dimensionDragState.originalOffset.clone().add(delta));
    };

    const finishDrag = () => {
        if (!dragState) return false;
        const current = dragState;
        dragState = null;
        controls.enabled = true;
        if (!current.moved) {
            clearSelection();
            selectObject(current.object);
            props.onFeedback(`SELECT: ${metaOf(current.object).label}`);
            return true;
        }
        props.onPointsMoved([...current.updates].map(([id, point]) => ({ id, x: point.x, y: point.y })));
        props.onFeedback(`MOVE: ${current.updates.size} point${current.updates.size === 1 ? '' : 's'}`);
        return true;
    };

    const finishDimensionDrag = () => {
        if (!dimensionDragState) return false;
        const current = dimensionDragState;
        dimensionDragState = null;
        controls.enabled = true;
        const dimension = dimensions[current.index];
        if (!dimension) return true;
        if (!current.moved) {
            props.onFeedback(`SELECT: dimension ${current.index + 1}`);
            return true;
        }
        props.onDimensionMoved(current.index, [dimension.offsetPoint.x, dimension.offsetPoint.y]);
        props.onFeedback('DIM: position updated');
        return true;
    };

    const askNumber = (label: string, initial: number) => {
        const value = window.prompt(label, Number.isFinite(initial) ? initial.toFixed(2) : '');
        if (value === null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const selectedLineMetas = () => selected.map(metaOf).filter((meta) => meta.kind === 'line');

    const applyConstraintToSelection = (tool: string) => {
        const lines = selectedLineMetas();
        if (tool === 'horiz' || tool === 'vert') {
            if (lines.length === 0) return false;
            for (const line of lines) {
                props.onConstraintAdded(tool === 'horiz' ? { Horizontal: line.entityId } : { Vertical: line.entityId });
            }
            props.onFeedback(`${tool.toUpperCase()}: applied to ${lines.length} line${lines.length === 1 ? '' : 's'}`);
            return true;
        }

        if (tool === 'parallel' || tool === 'equal') {
            if (lines.length < 2) return false;
            for (let index = 0; index < lines.length - 1; index += 1) {
                const first = lines[index];
                const second = lines[index + 1];
                props.onConstraintAdded(tool === 'parallel'
                  ? { Parallel: [first.entityId, second.entityId] }
                  : { EqualLength: [first.entityId, second.entityId] });
            }
            props.onFeedback(`${tool.toUpperCase()}: applied to ${lines.length} lines`);
            return true;
        }

        return false;
    };

    const handleConstraintSelection = (tool: string, e: MouseEvent) => {
        if (['horiz', 'vert', 'parallel', 'equal'].includes(tool) && selectedLineMetas().length > 0) {
            if (applyConstraintToSelection(tool)) return;
        }

        const object = nearestSelectable(e, ['dimension', 'radius', 'diameter', 'angle'].includes(tool) ? 20 : 14);
        if (!object) {
            props.onFeedback(`${tool.toUpperCase()}: select a line or circle`);
            return;
        }

        const meta = metaOf(object);

        if (tool === 'horiz' || tool === 'vert') {
            if (meta.kind !== 'line') {
                props.onFeedback(`${tool.toUpperCase()}: select a line`);
                return;
            }
            selectObject(object);
            props.onConstraintAdded(tool === 'horiz' ? { Horizontal: meta.entityId } : { Vertical: meta.entityId });
            props.onFeedback(`${tool.toUpperCase()} applied to ${meta.label}`);
            return;
        }

        if (tool === 'dimension') {
            if (meta.kind === 'line') {
                selectObject(object);
                updateDimensionPreview(meta, getIntersectPoint(e), 'line');
                props.onFeedback(`DIM: drag dimension line, click to place value`);
            } else if (meta.kind === 'circle') {
                selectObject(object);
                updateDimensionPreview(meta, getIntersectPoint(e), 'diameter');
                props.onFeedback(`DIM: drag diameter label, click to place value`);
            }
            return;
        }

        if (tool === 'radius' || tool === 'diameter') {
            if (meta.kind !== 'circle') {
                props.onFeedback(`${tool.toUpperCase()}: select a circle`);
                return;
            }
            selectObject(object);
            updateDimensionPreview(meta, getIntersectPoint(e), tool === 'radius' ? 'radius' : 'diameter');
            props.onFeedback(`${tool.toUpperCase()}: drag dimension label, click to place value`);
            return;
        }

        if (['angle', 'parallel', 'equal'].includes(tool)) {
            if (meta.kind !== 'line') {
                props.onFeedback(`${tool.toUpperCase()}: select lines`);
                return;
            }
            selectObject(object);
            if (selected.length < 2) {
                props.onFeedback(`${tool.toUpperCase()}: select second line`);
                return;
            }

            const [first, second] = selected.map(metaOf);
            if (tool === 'angle') {
                const value = askNumber(`Angle from ${first.label} to ${second.label} in degrees`, 90);
                if (value !== null) props.onDimensionAdded({ LineToLineAngle: { first: first.entityId, second: second.entityId } }, value * Math.PI / 180);
            } else if (tool === 'parallel') {
                props.onConstraintAdded({ Parallel: [first.entityId, second.entityId] });
            } else {
                props.onConstraintAdded({ EqualLength: [first.entityId, second.entityId] });
            }
            props.onFeedback(`${tool.toUpperCase()} applied`);
            clearSelection();
            return;
        }

        props.onFeedback(`${tool.toUpperCase()}: point selection is not implemented yet`);
    };

    createEffect(() => {
        props.toolActionVersion;
        const tool = props.activeTool;
        if (!tool || !['horiz', 'vert', 'parallel', 'equal'].includes(tool)) return;
        applyConstraintToSelection(tool);
    });

    const handleMouseDown = (e: MouseEvent) => {
        if (!props.activeTool) return;
        if (e.button === 2) {
            cancelActiveAction();
            props.onSelectTool();
            props.onFeedback('SELECT: ready');
            return;
        }
        const point = getIntersectPoint(e);

        if (props.activeTool === 'select') {
            if (e.button !== 0) return;
            const object = nearestSelectable(e, 14);
            if (object && e.detail >= 2) {
                const meta = metaOf(object);
                if (meta.kind === 'dimension' && meta.annotationIndex !== undefined) {
                    showDimensionEditInput(meta.annotationIndex);
                    return;
                }
            }
            if ((e.ctrlKey || e.metaKey || e.shiftKey) && object) {
                toggleSelection(object);
                props.onFeedback(`SELECT: ${selected.length} selected`);
                return;
            }
            if (object && beginDrag(object, point)) return;
            controls.enabled = false;
            const start = mouseToLocal(e);
            selectionDrag = { start, current: start, active: false };
            return;
        }

        if (dimensionDraft && ['dimension', 'radius', 'diameter'].includes(props.activeTool)) {
            updateDimensionPreview(dimensionDraft.meta, point, dimensionDraft.mode);
            showDimensionInput(dimensionDraft.meta, point, dimensionDraft.mode);
            return;
        }

        if (constraintTools.has(props.activeTool)) {
            handleConstraintSelection(props.activeTool, e);
            return;
        }

        controls.enabled = false;

        if (props.activeTool === 'polyline' || props.activeTool === 'spline') {
            isDrawing = true;
            polyPoints.push(point.clone());
            
            if (e.button === 2 || e.detail === 2) { // Right click or double click to finish
                if (polyPoints.length > 1) {
                    props.onObjectAdded({ type: props.activeTool.toUpperCase() as 'POLYLINE' | 'SPLINE', points: polyPoints.map(p => [p.x, p.y]) });
                }
                polyPoints = [];
                isDrawing = false;
                if (tempObject) scene.remove(tempObject);
                tempObject = null;
                controls.enabled = true;
            }
            return;
        }

        if (!isDrawing) {
            isDrawing = true;
            startPoint = point.clone();
        } else {
            if (startPoint) {
                if (props.activeTool === 'circle') {
                    const radius = startPoint.distanceTo(point);
                    props.onObjectAdded({ type: 'Circle', center: [startPoint.x, startPoint.y], radius });
                } else if (props.activeTool === 'line') {
                    props.onObjectAdded({ type: 'Line', p1: [startPoint.x, startPoint.y], p2: [point.x, point.y] });
                } else if (props.activeTool === 'rect') {
                    const w = point.x - startPoint.x;
                    const h = point.y - startPoint.y;
                    props.onObjectAdded({ type: 'Rect', x: startPoint.x, y: startPoint.y, w, h });
                } else if (['hexagon', 'octagon', 'triangle'].includes(props.activeTool)) {
                    const radius = startPoint.distanceTo(point);
                    props.onObjectAdded({ type: props.activeTool.toUpperCase() as 'TRIANGLE' | 'HEXAGON' | 'OCTAGON', center: [startPoint.x, startPoint.y], radius });
                }
            }
            
            if (tempObject) scene.remove(tempObject);
            isDrawing = false;
            startPoint = null;
            controls.enabled = true;
        }
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (dimensionDragState) {
            updateDimensionDrag(getIntersectPoint(e));
            return;
        }
        if (dragState) {
            updateDrag(getIntersectPoint(e));
            return;
        }
        if (props.activeTool === 'select' && selectionDrag) {
            selectionDrag.current = mouseToLocal(e);
            const distance = Math.hypot(selectionDrag.current.x - selectionDrag.start.x, selectionDrag.current.y - selectionDrag.start.y);
            if (distance >= 4) {
                selectionDrag.active = true;
                updateSelectionBox();
            }
            return;
        }
        if (dimensionDraft && !valueInput && props.activeTool && ['dimension', 'radius', 'diameter'].includes(props.activeTool)) {
            updateDimensionPreview(dimensionDraft.meta, getIntersectPoint(e), dimensionDraft.mode);
            return;
        }
        if (!isDrawing || !props.activeTool || !geometryTools.has(props.activeTool)) return;
        const point = getIntersectPoint(e);
        if (tempObject) scene.remove(tempObject);

        const mat = new THREE.MeshBasicMaterial({ color: CAD_COLORS.preview, opacity: 0.46, transparent: true });
        
        if (props.activeTool === 'polyline' || props.activeTool === 'spline') {
            const previewPoints = [...polyPoints, point.clone()];
            if (previewPoints.length > 1) {
                const geo = new THREE.BufferGeometry().setFromPoints(previewPoints);
                tempObject = props.activeTool === 'spline' 
                    ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(previewPoints).getPoints(50)), new THREE.LineBasicMaterial({ color: CAD_COLORS.preview, opacity: 0.46, transparent: true }))
                    : new THREE.Line(geo, new THREE.LineBasicMaterial({ color: CAD_COLORS.preview, opacity: 0.46, transparent: true }));
                scene.add(tempObject);
            }
            return;
        }

        if (!startPoint) return;

        if (props.activeTool === 'circle') {
            const radius = startPoint.distanceTo(point);
            tempObject = new THREE.Mesh(new THREE.RingGeometry(radius - 0.2, radius + 0.2, 64), mat);
            tempObject.position.set(startPoint.x, startPoint.y, 0);
        } else if (props.activeTool === 'line') {
            tempObject = new THREE.Line(new THREE.BufferGeometry().setFromPoints([startPoint.clone(), point.clone()]), new THREE.LineBasicMaterial({ color: CAD_COLORS.preview, opacity: 0.46, transparent: true }));
        } else if (props.activeTool === 'rect') {
            const w = point.x - startPoint.x;
            const h = point.y - startPoint.y;
            tempObject = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: CAD_COLORS.preview, transparent: true, opacity: 0.46 }));
            tempObject.position.set(startPoint.x + w/2, startPoint.y + h/2, 0);
        } else if (['hexagon', 'octagon', 'triangle'].includes(props.activeTool!)) {
            const sides = props.activeTool === 'hexagon' ? 6 : props.activeTool === 'octagon' ? 8 : 3;
            const radius = startPoint.distanceTo(point);
            tempObject = new THREE.Mesh(new THREE.RingGeometry(radius - 0.2, radius + 0.2, sides), mat);
            tempObject.position.set(startPoint.x, startPoint.y, 0);
            tempObject.rotation.z = Math.PI / sides;
        }
        
        if (tempObject) scene.add(tempObject);
    };

    const handleMouseUp = (e: MouseEvent) => {
        if (dimensionDragState) {
            finishDimensionDrag();
            return;
        }
        if (dragState) {
            finishDrag();
            return;
        }
        if (props.activeTool !== 'select' || !selectionDrag) return;
        selectionDrag.current = mouseToLocal(e);
        const usedBoxSelection = finishSelectionBox();
        controls.enabled = true;
        if (!usedBoxSelection) handleSelect(e);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelActiveAction();
      if ((e.key === 'Delete' || e.key === 'Backspace') && !valueInput) deleteSelected();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const syncFromProps = () => {
      if (props.sketch && props.sketch !== lastSketch) {
        renderSketch(props.sketch);
        renderAnnotations(props.annotations);
        lastSketch = props.sketch;
        lastAnnotations = props.annotations;
      } else if (props.annotations !== lastAnnotations) {
        renderAnnotations(props.annotations);
        lastAnnotations = props.annotations;
      }
      syncFrame = requestAnimationFrame(syncFromProps);
    };
    syncFromProps();

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(syncFrame);
      clearSketchObjects();
      clearDimensions();
      renderer.dispose();
      controls.dispose();
    });
  });

  return (
    <div ref={containerRef} class="w-full h-full absolute inset-0" />
  );
};

export default Viewport;
