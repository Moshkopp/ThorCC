import { Component, onMount, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

interface ViewportProps {
  mode: 'Sketch' | 'Nesting' | 'CAM' | 'Simulation';
  activeTool: string | null;
  onObjectAdded: (obj: any) => void;
}

const Viewport: Component<ViewportProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let raycaster = new THREE.Raycaster();
  let mouse = new THREE.Vector2();
  let gridPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  
  let tempObject: THREE.Object3D | null = null;
  let isDrawing = false;
  let startPoint: THREE.Vector3 | null = null;
  let polyPoints: THREE.Vector3[] = [];

  onMount(() => {
    if (!containerRef) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, containerRef.clientWidth / containerRef.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, 200);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(containerRef.clientWidth, containerRef.clientHeight);
    containerRef.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;

    const grid = new THREE.GridHelper(400, 40, 0x00aaff, 0x222222);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    grid.rotateX(Math.PI / 2);
    scene.add(grid);

    const animate = () => {
      requestAnimationFrame(animate);
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

    const handleMouseDown = (e: MouseEvent) => {
        if (!props.activeTool) return;
        controls.enabled = false;
        const point = getIntersectPoint(e);

        if (props.activeTool === 'polyline' || props.activeTool === 'spline') {
            isDrawing = true;
            polyPoints.push(point.clone());
            
            if (e.button === 2 || e.detail === 2) { // Right click or double click to finish
                if (polyPoints.length > 1) {
                    const geo = new THREE.BufferGeometry().setFromPoints(polyPoints);
                    const mat = new THREE.LineBasicMaterial({ color: 0x00aaff });
                    const m = props.activeTool === 'spline' 
                        ? new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(polyPoints).getPoints(50)), mat)
                        : new THREE.Line(geo, mat);
                    scene.add(m);
                    props.onObjectAdded({ type: props.activeTool.toUpperCase(), points: polyPoints.map(p => [p.x, p.y]) });
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
                const addMesh = (mesh: THREE.Object3D) => {
                    scene.add(mesh);
                };

                if (props.activeTool === 'circle') {
                    const radius = startPoint.distanceTo(point);
                    const m = new THREE.Mesh(new THREE.RingGeometry(radius - 0.5, radius + 0.5, 64), new THREE.MeshBasicMaterial({ color: 0x00aaff }));
                    m.position.set(startPoint.x, startPoint.y, 0);
                    addMesh(m);
                    props.onObjectAdded({ type: 'Circle', center: [startPoint.x, startPoint.y], radius });
                } else if (props.activeTool === 'line') {
                    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints([startPoint.clone(), point.clone()]), new THREE.LineBasicMaterial({ color: 0x00aaff }));
                    addMesh(m);
                    props.onObjectAdded({ type: 'Line', p1: [startPoint.x, startPoint.y], p2: [point.x, point.y] });
                } else if (props.activeTool === 'rect') {
                    const w = point.x - startPoint.x;
                    const h = point.y - startPoint.y;
                    const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: 0x00aaff }));
                    m.position.set(startPoint.x + w/2, startPoint.y + h/2, 0);
                    addMesh(m);
                    props.onObjectAdded({ type: 'Rect', x: startPoint.x, y: startPoint.y, w, h });
                } else if (['hexagon', 'octagon', 'triangle'].includes(props.activeTool)) {
                    const sides = props.activeTool === 'hexagon' ? 6 : props.activeTool === 'octagon' ? 8 : 3;
                    const radius = startPoint.distanceTo(point);
                    const m = new THREE.Mesh(new THREE.RingGeometry(radius - 0.5, radius + 0.5, sides), new THREE.MeshBasicMaterial({ color: 0x00aaff }));
                    m.position.set(startPoint.x, startPoint.y, 0);
                    m.rotation.z = Math.PI / sides;
                    addMesh(m);
                    props.onObjectAdded({ type: props.activeTool.toUpperCase(), center: [startPoint.x, startPoint.y], radius });
                }
            }
            
            if (tempObject) scene.remove(tempObject);
            isDrawing = false;
            startPoint = null;
            controls.enabled = true;
        }
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDrawing) return;
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

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);

    onCleanup(() => {
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.dispose();
      controls.dispose();
    });
  });

  return (
    <div ref={containerRef} class="w-full h-full absolute inset-0" />
  );
};

export default Viewport;
