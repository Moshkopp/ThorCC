import { Component, onMount, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { DimensionAnnotation, DimensionTarget, DrawObject, Sketch, SketchConstraint } from '../api/client';

interface ViewportProps {
  mode: 'Sketch' | 'Nesting' | 'CAM' | 'Simulation';
  activeTool: string | null;
  sketch: Sketch | null;
  annotations: DimensionAnnotation[];
  onObjectAdded: (obj: DrawObject) => void;
  onDimensionAdded: (target: DimensionTarget, value: number, offset?: [number, number]) => void;
  onConstraintAdded: (constraint: SketchConstraint) => void;
  onFeedback: (message: string) => void;
}

type SelectableKind = 'line' | 'circle';
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
  let selectionBox: HTMLDivElement | null = null;
  let dimensionDraft: DimensionDraft | null = null;
  let valueInput: HTMLInputElement | null = null;
  let animationFrame = 0;
  let syncFrame = 0;
  const dimensions: DimensionAnnotation[] = [];
  const selectables: THREE.Object3D[] = [];
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

    const grid = new THREE.GridHelper(400, 40, 0x00aaff, 0x222222);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    grid.rotateX(Math.PI / 2);
    scene.add(grid);

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
        selected.forEach((object) => setObjectColor(object, 0x00aaff));
        selected = [];
    };

    const clearDimensions = () => {
        while (dimensions.length) {
            const dimension = dimensions.pop()!;
            scene.remove(dimension.object);
        }
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
          new THREE.LineBasicMaterial({ color: 0x00aaff })
        );
        addSelectable(line, {
          entityId: id,
          kind: 'line',
          label,
          length: start.distanceTo(end),
          start: start.clone(),
          end: end.clone(),
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

    const lineDimensionGeometry = (meta: SelectableMeta, offsetPoint: THREE.Vector3, color = 0xffcc00) => {
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
        ];
        const group = new THREE.Group();
        group.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
        ));
        return group;
    };

    const circleDimensionGeometry = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: 'radius' | 'diameter', color = 0xffcc00) => {
        const center = meta.center!;
        const radius = meta.radius ?? 0;
        const direction = offsetPoint.clone().sub(center);
        if (direction.length() <= 1e-6) direction.set(1, 0, 0);
        const unit = direction.normalize();
        const edge = center.clone().add(unit.clone().multiplyScalar(radius));
        const group = new THREE.Group();

        if (mode === 'radius') {
            group.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([center, edge, offsetPoint]),
              new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
            ));
        } else {
            const opposite = center.clone().sub(unit.clone().multiplyScalar(radius));
            group.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([opposite, edge, offsetPoint]),
              new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
            ));
        }

        group.add(new THREE.Mesh(
          new THREE.RingGeometry(1.8, 2.5, 20),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
        ));
        group.children[group.children.length - 1].position.copy(edge);
        return group;
    };

    const makeDimensionLabel = (value: number, position: THREE.Vector3) => {
        const canvas = document.createElement('canvas');
        canvas.width = 220;
        canvas.height = 66;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(6, 8, 9, 0.78)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.82)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
        ctx.fillStyle = 'rgba(255, 218, 64, 0.95)';
        ctx.font = '700 28px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(value.toFixed(2), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        sprite.position.copy(position);
        sprite.scale.set(34, 10.2, 1);
        sprite.renderOrder = 20;
        return sprite;
    };

    const makeConstraintBadge = (text: string, position: THREE.Vector3, color = '#ffcc00') => {
        const canvas = document.createElement('canvas');
        canvas.width = 72;
        canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(4, 7, 8, 0.72)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
        ctx.fillStyle = color;
        ctx.font = '700 28px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        sprite.position.copy(position);
        sprite.scale.set(10.5, 7, 1);
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
            if (meta?.kind === 'line') makeConstraintBadge(label, lineBadgePosition(meta, nextSlot(meta.entityId)), color);
        };

        for (const constraint of constraints as any[]) {
            if ('Horizontal' in constraint) {
                renderLineMarker(constraint.Horizontal, 'H', 'rgba(125, 235, 190, 0.95)');
            } else if ('Vertical' in constraint) {
                renderLineMarker(constraint.Vertical, 'V', 'rgba(125, 235, 190, 0.95)');
            } else if ('Parallel' in constraint) {
                for (const id of constraint.Parallel as string[]) {
                    renderLineMarker(id, '//', 'rgba(120, 205, 255, 0.95)');
                }
            } else if ('Perpendicular' in constraint) {
                for (const id of constraint.Perpendicular as string[]) {
                    renderLineMarker(id, 'L', 'rgba(120, 205, 255, 0.95)');
                }
            } else if ('EqualLength' in constraint) {
                for (const id of constraint.EqualLength as string[]) {
                    renderLineMarker(id, '=', 'rgba(255, 218, 64, 0.95)');
                }
            } else if ('Angle' in constraint) {
                for (const id of [constraint.Angle[0], constraint.Angle[1]]) {
                    renderLineMarker(id, 'A', 'rgba(255, 218, 64, 0.95)');
                }
            } else if ('LineAngle' in constraint) {
                renderLineMarker(constraint.LineAngle.line, 'A', 'rgba(255, 218, 64, 0.95)');
            }
        }
    };

    const dimensionGeometry = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: DimensionMode) => {
        if (mode === 'line') return lineDimensionGeometry(meta, offsetPoint);
        return circleDimensionGeometry(meta, offsetPoint, mode);
    };

    const dimensionAnnotationObject = (meta: SelectableMeta, offsetPoint: THREE.Vector3, mode: DimensionMode, value: number) => {
        const group = new THREE.Group();
        group.add(dimensionGeometry(meta, offsetPoint, mode));
        group.add(makeDimensionLabel(value, offsetPoint));
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
        input.focus();
        input.select();

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
                if (start && end) makeLine(start, end, entity.Line.id, entity.Line.id);
            }
            if ('Circle' in entity) {
                const center = points.get(entity.Circle.center);
                if (!center) continue;
                const mesh = new THREE.Mesh(
                  new THREE.RingGeometry(entity.Circle.radius - 0.5, entity.Circle.radius + 0.5, 64),
                  new THREE.MeshBasicMaterial({ color: 0x00aaff })
                );
                mesh.position.set(center.x, center.y, 0);
                addSelectable(mesh, {
                  entityId: entity.Circle.id,
                  kind: 'circle',
                  label: entity.Circle.id,
                  radius: entity.Circle.radius,
                  center: center.clone(),
                });
            }
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
        for (const annotation of annotations) {
            const resolved = metaForAnnotation(annotation);
            if (!resolved) continue;
            const offsetPoint = new THREE.Vector3(annotation.offset[0], annotation.offset[1], 0);
            const object = dimensionAnnotationObject(resolved.meta, offsetPoint, resolved.mode, annotation.value);
            scene.add(object);
            dimensions.push({
                meta: { ...resolved.meta },
                mode: resolved.mode,
                offsetPoint,
                value: annotation.value,
                object,
            });
        }
    };

    const nearestSelectable = (e: MouseEvent) => {
        const rect = containerRef!.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        return raycaster.intersectObjects(selectables, false)[0]?.object;
    };

    const handleSelect = (e: MouseEvent) => {
        const object = nearestSelectable(e);
        if (!object) {
            clearSelection();
            props.onFeedback('SELECT: nothing selected');
            return;
        }
        clearSelection();
        selectObject(object);
        props.onFeedback(`SELECT: ${metaOf(object).label}`);
    };

    const selectObject = (object: THREE.Object3D) => {
        if (!selected.includes(object)) selected.push(object);
        setObjectColor(object, 0xffcc00);
    };

    const metaOf = (object: THREE.Object3D): SelectableMeta => object.userData.meta;

    const askNumber = (label: string, initial: number) => {
        const value = window.prompt(label, Number.isFinite(initial) ? initial.toFixed(2) : '');
        if (value === null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const handleConstraintSelection = (tool: string, e: MouseEvent) => {
        const object = nearestSelectable(e);
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
            clearSelection();
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

    const handleMouseDown = (e: MouseEvent) => {
        if (!props.activeTool) return;
        const point = getIntersectPoint(e);

        if (props.activeTool === 'select') {
            if (e.button !== 0) return;
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

        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true });
        
        if (props.activeTool === 'polyline' || props.activeTool === 'spline') {
            const previewPoints = [...polyPoints, point.clone()];
            if (previewPoints.length > 1) {
                const geo = new THREE.BufferGeometry().setFromPoints(previewPoints);
                tempObject = props.activeTool === 'spline' 
                    ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(previewPoints).getPoints(50)), new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true }))
                    : new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true }));
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
            tempObject = new THREE.Line(new THREE.BufferGeometry().setFromPoints([startPoint.clone(), point.clone()]), new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true }));
        } else if (props.activeTool === 'rect') {
            const w = point.x - startPoint.x;
            const h = point.y - startPoint.y;
            tempObject = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
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
        if (props.activeTool !== 'select' || !selectionDrag) return;
        selectionDrag.current = mouseToLocal(e);
        const usedBoxSelection = finishSelectionBox();
        controls.enabled = true;
        if (!usedBoxSelection) handleSelect(e);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelActiveAction();
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
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
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
