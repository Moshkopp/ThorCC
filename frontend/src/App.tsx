import { createMemo, createSignal, Component, onMount, onCleanup, For, Show } from 'solid-js';
import Viewport from './components/Viewport';
import { DimensionAnnotation, DimensionTarget, DrawObject, ProjectEntry, ProjectVersionEntry, SavedProject, Sketch, SketchConstraint, ThorClient } from './api/client';

const App: Component = () => {
  const [theme, setTheme] = createSignal<'dark' | 'light'>('dark');
  const [mode, setMode] = createSignal<'Sketch' | 'Nesting' | 'CAM' | 'Simulation'>('Sketch');
  const [gcode, setGCode] = createSignal<string>("");
  const [status, setStatus] = createSignal("Ready");
  const [activeTool, setActiveTool] = createSignal<string | null>('select');
  const [toolActionVersion, setToolActionVersion] = createSignal(0);
  const [sketch, setSketch] = createSignal<Sketch | null>(null);
  const [annotations, setAnnotations] = createSignal<DimensionAnnotation[]>([]);
  const [projectBarOpen, setProjectBarOpen] = createSignal(false);
  const [projectSearch, setProjectSearch] = createSignal("");
  const [projects, setProjects] = createSignal<ProjectEntry[]>([]);
  const [saveModalOpen, setSaveModalOpen] = createSignal(false);
  const [saveNameLocked, setSaveNameLocked] = createSignal(false);
  const [saveName, setSaveName] = createSignal("Untitled Project");
  const [saveComment, setSaveComment] = createSignal("");
  const [hoveredVersion, setHoveredVersion] = createSignal<ProjectVersionEntry | null>(null);
  const [selectedProject, setSelectedProject] = createSignal<ProjectEntry | null>(null);
  const [isDirty, setIsDirty] = createSignal(false);
  const [currentProjectName, setCurrentProjectName] = createSignal<string | null>(null);
  const [projectSaved, setProjectSaved] = createSignal(false);
  const [polygonSides, setPolygonSides] = createSignal<5 | 6 | 8>(6);

  let client: ThorClient | undefined;
  let importInputRef: HTMLInputElement | undefined;

  onMount(() => {
    client = new ThorClient(`ws://${window.location.host}/ws`);
    client.onOpen(() => client?.send({ type: 'ListProjects' }));
    client.onMessage((msg) => {
      if (msg.type === 'GCode') {
        setGCode(msg.content);
        setStatus("G-Code Generated");
      }
      if (msg.type === 'Sketch') {
        if (msg.name) setCurrentProjectName(msg.name);
        setSketch(msg.sketch);
        setAnnotations(msg.annotations ?? []);
        setStatus("Sketch Updated");
      }
      if (msg.type === 'ProjectList') {
        setProjects(msg.projects);
        const current = selectedProject();
        if (current) {
          setSelectedProject(msg.projects.find(p => p.id === current.id) ?? null);
        }
      }
      if (msg.type === 'ProjectExport') {
        downloadThorcc(msg.filename, msg.content);
        setStatus(`Exported ${msg.filename}`);
      }
      if (msg.type === 'Error') {
        setStatus(msg.message);
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isEditingText = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
      if (isEditingText) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (projectSaved()) quickSave(); else openSaveModal();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) handleSketchRedo(); else handleSketchUndo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleSketchRedo();
        return;
      }
      if (event.key.toLowerCase() === 'm' && activeTool() === 'polygon') {
        setPolygonSides(s => s === 5 ? 6 : s === 6 ? 8 : 5);
        const sides = polygonSides();
        setStatus(`POLYGON: ${sides}-Eck`);
        return;
      }
      if (event.key !== 'Escape') return;
      setActiveTool('select');
      setStatus("SELECT: ready");
    };

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  const filteredProjects = createMemo(() => {
    const query = projectSearch().trim().toLowerCase();
    if (!query) return projects();
    return projects().filter(p => p.name.toLowerCase().includes(query) || p.id.includes(query));
  });

  const downloadThorcc = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.thorcc') ? filename : `${filename}.thorcc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const sketchBounds = (project: SavedProject) => {
    const points = new Map<string, { x: number; y: number }>();
    for (const entity of project.sketch.entities) {
      if ('Point' in entity) {
        const pos = entity.Point.pos;
        points.set(entity.Point.id, Array.isArray(pos) ? { x: pos[0], y: pos[1] } : pos);
      }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    for (const point of points.values()) include(point.x, point.y);
    for (const entity of project.sketch.entities) {
      if ('Circle' in entity) {
        const center = points.get(entity.Circle.center);
        if (center) {
          include(center.x - entity.Circle.radius, center.y - entity.Circle.radius);
          include(center.x + entity.Circle.radius, center.y + entity.Circle.radius);
        }
      }
    }
    if (!Number.isFinite(minX)) return { minX: -50, minY: -50, maxX: 50, maxY: 50, points };
    const pad = Math.max(10, (Math.max(maxX - minX, maxY - minY) || 100) * 0.15);
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad, points };
  };

  const SketchPreview: Component<{ version: ProjectVersionEntry }> = (props) => {
    const bounds = () => sketchBounds(props.version.project);
    return (
      <div class="preview-card rounded p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold t-2">v{props.version.version}</span>
          <span class="text-[10px] t-3">{props.version.project.sketch.entities.length} entities</span>
        </div>
        <svg
          class="preview-svg h-72 w-full rounded"
          viewBox={`${bounds().minX} ${-bounds().maxY} ${bounds().maxX - bounds().minX} ${bounds().maxY - bounds().minY}`}
        >
          <For each={props.version.project.sketch.entities}>
            {(entity) => {
              if ('Line' in entity) {
                const a = bounds().points.get(entity.Line.p1);
                const b = bounds().points.get(entity.Line.p2);
                if (!a || !b) return null;
                return <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} stroke="var(--acc)" stroke-width="1.8" vector-effect="non-scaling-stroke" />;
              }
              if ('Circle' in entity) {
                const center = bounds().points.get(entity.Circle.center);
                if (!center) return null;
                return <circle cx={center.x} cy={-center.y} r={entity.Circle.radius} fill="none" stroke="var(--acc)" stroke-width="1.8" vector-effect="non-scaling-stroke" />;
              }
              return null;
            }}
          </For>
        </svg>
        <div class="mt-2 max-h-9 overflow-hidden text-[11px] t-2">{props.version.comment || 'Keine Notiz'}</div>
      </div>
    );
  };

  const handleGenerate = () => {
    if (client) {
      setStatus("Generating Toolpath...");
      client.send({ type: 'ExportGCode' });
    }
  };

  const openSaveModal = (locked = false) => {
    setSaveName(currentProjectName() ?? projects()[0]?.name ?? 'Untitled Project');
    setSaveComment("");
    setSaveNameLocked(locked);
    setSaveModalOpen(true);
  };

  const saveProject = () => {
    const name = saveName().trim();
    if (!name) { setStatus('Projektname erforderlich'); return; }
    client?.send({ type: 'SaveProject', name, comment: saveComment() });
    setCurrentProjectName(name);
    setProjectSaved(true);
    setIsDirty(false);
    setSaveModalOpen(false);
    setProjectBarOpen(true);
    setStatus(`Gespeichert: ${name}`);
  };

  const loadProject = (project: ProjectEntry, version = project.current_version) => {
    client?.send({ type: 'LoadProject', id: project.id, version });
    setCurrentProjectName(project.name);
    setProjectSaved(true);
    setIsDirty(false);
    setSelectedProject(null);
    setHoveredVersion(null);
    setStatus(`Lade ${project.name} v${version}`);
  };

  const deleteProject = (project: ProjectEntry) => {
    if (!window.confirm(`Projekt "${project.name}" mit ${project.versions} Version(en) löschen?`)) return;
    client?.send({ type: 'DeleteProject', id: project.id });
    if (selectedProject()?.id === project.id) setSelectedProject(null);
    setStatus(`Gelöscht: ${project.name}`);
  };

  const exportProject = (project?: ProjectEntry, version = project?.current_version) => {
    client?.send({ type: 'ExportProject', id: project?.id ?? null, version: version ?? null });
    setStatus('Exportiere...');
  };

  const importProject = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const content = await file.text();
    client?.send({ type: 'ImportProject', name: file.name.replace(/\.thorcc$/i, ''), content });
    input.value = '';
    setProjectBarOpen(true);
    setStatus(`Importiert: ${file.name}`);
  };

  const quickSave = () => {
    if (!currentProjectName()) {
      setStatus('Kein Projekt — erst "Neu Anlegen" speichern');
      return;
    }
    client?.send({ type: 'QuickSaveProject' });
    setIsDirty(false);
    setStatus(`Gespeichert: ${currentProjectName()}`);
  };

  const handleSketchUndo = () => {
    const sent = client?.send({ type: 'SketchUndo' }) ?? false;
    if (sent) setIsDirty(true);
    setStatus(sent ? "Undo" : "Undo: nicht verbunden");
  };

  const handleSketchRedo = () => {
    const sent = client?.send({ type: 'SketchRedo' }) ?? false;
    if (sent) setIsDirty(true);
    setStatus(sent ? "Redo" : "Redo: nicht verbunden");
  };

  const handleToolClick = (tool: string) => {
    setActiveTool(tool);
    setToolActionVersion(v => v + 1);
    if (tool === 'select') setStatus("SELECT: Geometrie anklicken");
    else if (tool === 'polygon') setStatus(`POLYGON: ${polygonSides()}-Eck — M zum Wechseln`);
    else if (['horiz','vert','parallel','coincident','equal','dimension','radius','diameter','angle'].includes(tool))
      setStatus(`${tool.toUpperCase()}: Geometrie anklicken`);
    else setStatus(`${tool.toUpperCase()}: Start- und Endpunkt setzen`);
  };

  const onObjectAdded = (obj: DrawObject) => {
    if (client) {
      client.send({ type: 'AddObject', object: obj });
      setIsDirty(true);
      setActiveTool('select');
      setStatus("SELECT: bereit");
    }
  };

  const onDimensionAdded = (target: DimensionTarget, value: number, offset?: [number, number]) => {
    client?.send({ type: 'AddDimension', target, value, offset });
    setIsDirty(true);
  };

  const onDimensionChanged = (index: number, value: number) => {
    client?.send({ type: 'UpdateDimensionValue', index, value });
    setIsDirty(true);
  };

  const onDimensionMoved = (index: number, offset: [number, number]) => {
    client?.send({ type: 'UpdateDimensionOffset', index, offset });
    setIsDirty(true);
  };

  const onConstraintAdded = (constraint: SketchConstraint) => {
    client?.send({ type: 'AddConstraint', constraint });
    setIsDirty(true);
  };

  const onPointsMoved = (points: { id: string; x: number; y: number }[]) => {
    client?.send({ type: 'UpdatePoints', points });
    setIsDirty(true);
  };

  const onCircleRadiusChanged = (id: string, radius: number) => {
    client?.send({ type: 'UpdateCircleRadius', id, radius });
    setIsDirty(true);
  };

  const onSelectionDeleted = (entities: string[], dimensions: number[]) => {
    client?.send({ type: 'DeleteSelection', entities, dimensions });
    setIsDirty(true);
  };

  const onSelectTool = () => setActiveTool('select');

  const onViewportFeedback = (message: string) => {
    setStatus(message);
  };

  const tools = createMemo(() => [
    { id: 'select', icon: '↖', label: 'SELECT' },
    { id: 'line', icon: '╱', label: 'LINE' },
    { id: 'circle', icon: '◯', label: 'CIRCLE' },
    { id: 'rect', icon: '□', label: 'RECT' },
    { id: 'triangle', icon: '△', label: 'TRI' },
    { id: 'polyline', icon: '⟪', label: 'POLY' },
    { id: 'polygon', icon: '⬡', label: `${polygonSides()}-ECK` },
    { id: 'spline', icon: '〜', label: 'SPLINE' },
    { id: 'fillet', icon: '◰', label: 'FILLET' },
  ]);

  const constraints = [
    { id: 'horiz', icon: '—', label: 'HORIZ' },
    { id: 'vert', icon: '|', label: 'VERT' },
    { id: 'parallel', icon: '//', label: 'PARA' },
    { id: 'coincident', icon: '⚬', label: 'COIN' },
    { id: 'equal', icon: '=', label: 'EQUAL' },
    { id: 'dimension', icon: '↔', label: 'DIM' },
    { id: 'radius', icon: 'R', label: 'RAD' },
    { id: 'diameter', icon: 'Ø', label: 'DIA' },
    { id: 'angle', icon: '∠', label: 'ANGLE' },
  ];

  return (
    <div class="h-screen overflow-hidden flex flex-col font-['Inter']" data-theme={theme()}>
      {/* Header */}
      <header class="h-14 bg-panel border-b b-default flex items-center justify-between px-5 z-20 shrink-0">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-bold tracking-tight"><span class="t-acc">THOR</span><span class="t-1 opacity-70">CC</span></h1>
          <div class="h-5 w-px bg-divider mx-1"></div>
          <nav class="flex gap-0.5">
            <button
              onClick={() => setProjectBarOpen(!projectBarOpen())}
              class={projectBarOpen() ? 'btn-nav-active' : 'btn-nav'}
            >Projekt</button>
            <button class="btn-nav">Edit</button>
          </nav>
          <div class="h-5 w-px bg-divider mx-1"></div>
          <div class="flex gap-0.5">
            <button onClick={handleSketchUndo} title="Undo (Ctrl+Z)" class="btn-ghost px-2.5 py-1 text-[12px] font-semibold rounded">Undo</button>
            <button onClick={handleSketchRedo} title="Redo (Ctrl+Y)" class="btn-ghost px-2.5 py-1 text-[12px] font-semibold rounded">Redo</button>
          </div>
          <Show when={currentProjectName()}>
            {(name) => (
              <>
                <div class="h-5 w-px bg-divider mx-1"></div>
                <div class="flex items-center gap-1.5">
                  <span class="text-sm t-1 font-semibold">{name()}</span>
                  <Show when={isDirty()}>
                    <span class="t-acc text-base leading-none">•</span>
                    <button onClick={() => projectSaved() ? quickSave() : openSaveModal()} title={projectSaved() ? "Schnellspeichern (Ctrl+S)" : "Projekt anlegen"} class="icon-btn t-acc">
                      <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor">
                        <path d="M2 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4.5L9.5 1H2zm4.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM3 2h5.5v3H3V2z"/>
                      </svg>
                    </button>
                  </Show>
                  <Show when={projectSaved()}>
                    <button onClick={() => openSaveModal(true)} title="Neue Version anlegen" class="icon-btn t-2">
                      <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <circle cx="4" cy="2.5" r="1.5"/><circle cx="4" cy="11.5" r="1.5"/><circle cx="10.5" cy="7" r="1.5"/>
                        <line x1="4" y1="4" x2="4" y2="10"/>
                        <path d="M4 4 C4 6.5 10.5 5 10.5 7"/>
                      </svg>
                    </button>
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>

        <div class="flex bg-input p-0.5 rounded border b-default">
          {['Sketch', 'CAM', 'Simulation'].map(m => (
            <button
              onClick={() => setMode(m as any)}
              class={mode() === m ? 'btn-mode-active' : 'btn-mode'}
            >{m === 'Simulation' ? 'Sim' : m}</button>
          ))}
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 text-xs font-semibold t-ok tracking-normal">
            <div class="w-1.5 h-1.5 rounded-full bg-current"></div>
            ONLINE
          </div>
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title="Theme wechseln"
            class="icon-btn t-3 p-1.5"
          >
            <Show when={theme() === 'dark'} fallback={
              <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/>
              </svg>
            }>
              <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"/>
              </svg>
            </Show>
          </button>
          <button class="btn-primary px-5 py-2 rounded font-bold text-xs tracking-normal" onClick={handleGenerate}>
            GENERATE G-CODE
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main class="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside class="w-80 bg-panel border-r b-default flex flex-col z-10 shrink-0">
          <Show when={projectBarOpen()} fallback={
            <>
              <div class="p-4 border-b b-default">
                <h2 class="section-title mb-4">Sketching</h2>
                <div class="grid grid-cols-5 gap-1.5">
                  <For each={tools()}>
                    {(tool) => (
                      <button
                        onClick={() => handleToolClick(tool.id)}
                        title={tool.label}
                        class={activeTool() === tool.id ? 'tool-btn active aspect-square' : 'tool-btn aspect-square'}
                      >
                        <span class="text-lg leading-none mb-1">{tool.icon}</span>
                        <span class="text-[10px] font-semibold tracking-wide">{tool.label}</span>
                      </button>
                    )}
                  </For>
                </div>
                <h2 class="section-title mt-6 mb-4">Constraints</h2>
                <div class="grid grid-cols-5 gap-1.5">
                  <For each={constraints}>
                    {(c) => (
                      <button
                        onClick={() => handleToolClick(c.id)}
                        title={c.label}
                        class={activeTool() === c.id ? 'tool-btn active aspect-square' : 'tool-btn aspect-square'}
                      >
                        <span class="text-2xl font-bold leading-none">{c.icon}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </>
          }>
            <div class="p-4 border-b b-default">
              <h2 class="section-title mb-4">Projektmappe</h2>
              <div class="grid grid-cols-2 gap-1.5 mb-3">
                <button onClick={openSaveModal} class="btn-primary h-9 rounded text-xs font-bold">Neu Anlegen</button>
                <button onClick={() => exportProject()} class="btn-surface h-9 rounded text-xs font-semibold">Export</button>
                <button onClick={() => importInputRef?.click()} class="btn-surface h-9 rounded text-xs font-semibold">Import</button>
                <button onClick={() => client?.send({ type: 'ListProjects' })} class="btn-surface h-9 rounded text-xs font-semibold">Refresh</button>
              </div>
              <input ref={importInputRef} type="file" accept=".thorcc,application/json" class="hidden" onChange={importProject} />
              <input
                value={projectSearch()}
                onInput={e => setProjectSearch(e.currentTarget.value)}
                placeholder="Suchen..."
                class="th-input w-full h-9 rounded px-3 text-xs"
              />
            </div>
            <div class="p-3 flex-1 overflow-y-auto th-scrollbar">
              <div class="space-y-1">
                <For each={filteredProjects()}>
                  {(project) => (
                    <button
                      onClick={() => { setSelectedProject(project); setHoveredVersion(null); }}
                      class="project-row w-full"
                    >
                      <span class="min-w-0 truncate text-sm font-semibold t-1">{project.name}</span>
                      <span class="ml-3 shrink-0 text-[11px] t-3 font-mono">v{project.current_version}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </aside>

        {/* Viewport */}
        <div class="flex-1 relative bg-viewport">
          <Viewport
            mode={mode()}
            activeTool={activeTool()}
            polygonSides={polygonSides()}
            toolActionVersion={toolActionVersion()}
            sketch={sketch()}
            annotations={annotations()}
            onObjectAdded={onObjectAdded}
            onDimensionAdded={onDimensionAdded}
            onDimensionChanged={onDimensionChanged}
            onDimensionMoved={onDimensionMoved}
            onConstraintAdded={onConstraintAdded}
            onPointsMoved={onPointsMoved}
            onCircleRadiusChanged={onCircleRadiusChanged}
            onSelectionDeleted={onSelectionDeleted}
            onSelectTool={onSelectTool}
            onFeedback={onViewportFeedback}
          />
        </div>
      </main>

      {/* Footer */}
      <footer class="h-10 bg-panel border-t b-default flex items-center justify-between px-5 z-20 shrink-0">
        <span class="text-xs font-semibold tracking-normal" style={activeTool() ? "color:var(--acc-2)" : "color:var(--t-3)"}>{status()}</span>
        <div class="flex gap-6 text-xs uppercase font-semibold tracking-wide t-3">
          <span>UNIT <span class="t-2">MM</span></span>
          <span>GRID <span class="t-2">5.0</span></span>
          <span class="t-acc">SNAP <span>ON</span></span>
        </div>
      </footer>

      {/* Save Modal */}
      <Show when={saveModalOpen()}>
        <div class="modal-backdrop absolute inset-0 z-50 flex items-center justify-center">
          <div class="modal-box w-[360px] rounded-lg p-5 shadow-2xl">
            <h2 class="text-sm font-semibold t-1 mb-4">{saveNameLocked() ? 'Neue Version anlegen' : 'Projekt speichern'}</h2>
            <input
              value={saveName()}
              onInput={e => setSaveName(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveProject(); if (e.key === 'Escape') setSaveModalOpen(false); }}
              placeholder="Projektname"
              readOnly={saveNameLocked()}
              class={saveNameLocked() ? 'th-input-locked w-full h-10 rounded px-3 text-sm' : 'th-input w-full h-10 rounded px-3 text-sm'}
              autofocus={!saveNameLocked()}
            />
            <textarea
              value={saveComment()}
              onInput={e => setSaveComment(e.currentTarget.value)}
              placeholder="Kommentar / Notiz zu dieser Version…"
              autofocus={saveNameLocked()}
              class="th-input mt-3 h-24 w-full resize-none rounded px-3 py-2 text-sm"
            />
            <div class="mt-5 flex justify-end gap-2">
              <button onClick={() => setSaveModalOpen(false)} class="btn-surface px-4 py-2 rounded text-xs font-semibold">Abbrechen</button>
              <button onClick={saveProject} class="btn-primary px-4 py-2 rounded text-xs font-bold">Speichern</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Project Modal */}
      <Show when={selectedProject()}>
        {(proj) => (
          <div class="modal-backdrop absolute inset-0 z-50 flex items-center justify-center">
            <div class="modal-box flex max-h-[82vh] w-[800px] overflow-hidden rounded-lg shadow-2xl">
              <div class="w-[320px] shrink-0 border-r b-default p-5 flex flex-col">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h2 class="truncate text-base font-semibold t-1">{proj().name}</h2>
                    <div class="mt-0.5 text-xs t-3">{proj().versions} Version{proj().versions === 1 ? '' : 'en'}</div>
                  </div>
                  <button onClick={() => { setSelectedProject(null); setHoveredVersion(null); }} class="icon-btn t-3 p-1 text-base leading-none">✕</button>
                </div>
                <div class="mt-4 flex gap-2">
                  <button onClick={() => loadProject(proj())} class="btn-primary rounded px-3 py-1.5 text-xs font-bold">Latest laden</button>
                  <button onClick={() => exportProject(proj())} class="btn-surface rounded px-3 py-1.5 text-xs font-semibold">Export</button>
                  <button onClick={() => deleteProject(proj())} class="btn-danger rounded px-3 py-1.5 text-xs font-semibold ml-auto">Löschen</button>
                </div>
                <div class="mt-4 flex-1 space-y-1 overflow-y-auto th-scrollbar pr-1">
                  <For each={[...proj().version_entries].reverse()}>
                    {(version) => (
                      <div
                        onMouseEnter={() => setHoveredVersion(version)}
                        class={hoveredVersion() === version ? 'version-row selected' : 'version-row'}
                      >
                        <div class="flex items-center justify-between gap-2">
                          <button onFocus={() => setHoveredVersion(version)} onClick={() => loadProject(proj(), version.version)} class="text-xs font-bold t-acc font-mono">v{version.version}</button>
                          <button onClick={e => { e.stopPropagation(); exportProject(proj(), version.version); }} class="btn-ghost rounded px-2 py-0.5 text-[10px]">Export</button>
                        </div>
                        <div class="mt-1 text-[11px] t-3 truncate">{version.comment || '—'}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div class="flex-1 p-5 overflow-y-auto th-scrollbar">
                <Show when={hoveredVersion() ?? proj().version_entries[proj().version_entries.length - 1]}>
                  {(ver) => (
                    <>
                      <div class="mb-4 flex items-center justify-between">
                        <div>
                          <div class="text-sm font-semibold t-1">Preview v{ver().version}</div>
                          <div class="text-xs t-3 mt-0.5">
                            {ver().project.sketch.entities.length} Entities · {ver().project.sketch.constraints.length} Constraints · {ver().project.annotations.length} Maße
                          </div>
                        </div>
                        <button onClick={() => loadProject(proj(), ver().version)} class="btn-primary rounded px-3 py-1.5 text-xs font-bold">Version laden</button>
                      </div>
                      <SketchPreview version={ver()} />
                    </>
                  )}
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>

      <style>{`
        /* ── Theme Variables ── */
        [data-theme="dark"] {
          --bg:       #141c22;
          --panel:    #1b2530;
          --surface:  #222e3a;
          --elevated: #2b3848;
          --input-bg: #0f1820;
          --viewport: #0d1318;
          --divider:  rgba(150,190,215,0.12);
          --border:   rgba(150,190,215,0.13);
          --b-acc:    rgba(60,205,224,0.5);
          --acc:      #3ccde0;
          --acc-2:    #80dde8;
          --acc-bg:   #1e6878;
          --acc-fg:   #040e12;
          --t-1:      #d4e8f4;
          --t-2:      #7aaec0;
          --t-3:      #3d6878;
          --ok:       #5ec87a;
          --danger:   #e04848;
          --danger-bg:rgba(220,60,60,0.12);
          --modal-bg: rgba(5,10,14,0.72);
        }
        [data-theme="light"] {
          --bg:       #c8d4db;
          --panel:    #d4e0e7;
          --surface:  #e8f0f6;
          --elevated: #dce8ef;
          --input-bg: #f4f8fb;
          --viewport: #dde8f0;
          --divider:  rgba(10,40,60,0.14);
          --border:   rgba(10,40,60,0.13);
          --b-acc:    rgba(0,130,158,0.4);
          --acc:      #0878a0;
          --acc-2:    #055a78;
          --acc-bg:   #0878a0;
          --acc-fg:   #ffffff;
          --t-1:      #14222c;
          --t-2:      #385868;
          --t-3:      #5a8090;
          --ok:       #1e7040;
          --danger:   #b82828;
          --danger-bg:rgba(180,30,30,0.1);
          --modal-bg: rgba(20,40,55,0.55);
        }

        /* ── Base ── */
        [data-theme] { background-color: var(--bg); color: var(--t-1); }
        .bg-panel    { background-color: var(--panel); }
        .bg-viewport { background-color: var(--viewport); }
        .bg-input    { background-color: var(--input-bg); }
        .b-default   { border-color: var(--border); }
        .bg-divider  { background-color: var(--divider); }
        .t-1  { color: var(--t-1); }
        .t-2  { color: var(--t-2); }
        .t-3  { color: var(--t-3); }
        .t-acc  { color: var(--acc); }
        .t-ok   { color: var(--ok); }

        /* ── Buttons ── */
        .btn-primary {
          background-color: var(--acc);
          color: var(--acc-fg);
          transition: filter .12s;
        }
        .btn-primary:hover  { filter: brightness(1.1); }
        .btn-primary:active { filter: brightness(0.88); }

        .btn-surface {
          background-color: var(--surface);
          border: 1px solid var(--border);
          color: var(--t-2);
          transition: background-color .12s, color .12s;
        }
        .btn-surface:hover { background-color: var(--elevated); color: var(--t-1); }

        .btn-ghost {
          color: var(--t-1);
          transition: background-color .12s, color .12s;
        }
        .btn-ghost:hover { background-color: var(--surface); color: var(--t-1); }

        .btn-danger {
          border: 1px solid var(--danger-bg);
          color: var(--danger);
          transition: background-color .12s;
        }
        .btn-danger:hover { background-color: var(--danger-bg); }

        .btn-nav {
          padding: 4px 12px; border-radius: 4px;
          font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
          color: var(--t-1);
          transition: background-color .12s, color .12s;
        }
        .btn-nav:hover { background-color: var(--surface); color: var(--t-1); }
        .btn-nav-active {
          padding: 4px 12px; border-radius: 4px;
          font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
          background-color: var(--acc); color: var(--acc-fg);
        }

        .btn-mode {
          padding: 6px 20px; border-radius: 3px;
          font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
          color: var(--t-1);
          transition: color .12s;
        }
        .btn-mode:hover { color: var(--t-1); }
        .btn-mode-active {
          padding: 6px 20px; border-radius: 3px;
          font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
          background-color: var(--acc); color: var(--acc-fg);
        }

        .icon-btn {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 3px; border-radius: 4px;
          transition: background-color .12s, color .12s;
        }
        .icon-btn:hover { background-color: var(--surface); color: var(--t-1); }

        /* ── Tool buttons ── */
        .tool-btn {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border-radius: 6px; border: 1px solid var(--border);
          background-color: var(--surface); color: var(--t-2);
          transition: background-color .12s, border-color .12s, color .12s;
        }
        .tool-btn:hover { background-color: var(--elevated); color: var(--t-1); border-color: var(--t-3); }
        .tool-btn.active { background-color: var(--acc); border-color: var(--b-acc); color: var(--acc-fg); }

        /* ── Section title ── */
        .section-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
          color: var(--t-3);
        }
        .section-title::before {
          content: ''; display: block; width: 14px; height: 1px;
          background-color: var(--acc); opacity: 0.6;
        }

        /* ── History item ── */
        .history-item {
          padding: 8px 10px; border-radius: 5px; border: 1px solid var(--border);
          background-color: var(--surface);
          transition: background-color .1s;
        }
        .history-item:hover { background-color: var(--elevated); }

        /* ── Inputs ── */
        .th-input {
          background-color: var(--input-bg);
          border: 1px solid var(--border);
          color: var(--t-1);
          outline: none;
          transition: border-color .15s;
        }
        .th-input:focus { border-color: var(--b-acc); }
        .th-input::placeholder { color: var(--t-3); }
        .th-input-locked {
          background-color: var(--input-bg);
          border: 1px solid transparent;
          color: var(--t-3);
          outline: none;
          cursor: default;
        }

        /* ── Project rows ── */
        .project-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border);
          background-color: var(--surface); text-align: left;
          transition: background-color .12s, border-color .12s;
        }
        .project-row:hover { background-color: var(--elevated); border-color: var(--t-3); }

        /* ── Version rows ── */
        .version-row {
          padding: 8px 10px; border-radius: 5px; border: 1px solid var(--border);
          background-color: var(--surface);
          transition: background-color .1s, border-color .1s;
        }
        .version-row:hover { background-color: var(--elevated); }
        .version-row.selected { background-color: var(--elevated); border-color: var(--b-acc); }

        /* ── Modals ── */
        .modal-backdrop { background-color: var(--modal-bg); backdrop-filter: blur(2px); }
        .modal-box { background-color: var(--panel); border: 1px solid var(--border); }

        /* ── Preview ── */
        .preview-card { background-color: var(--surface); border: 1px solid var(--border); }
        .preview-svg  { background-color: var(--viewport); border: 1px solid var(--border); }

        /* ── Scrollbar ── */
        .th-scrollbar::-webkit-scrollbar { width: 4px; }
        .th-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .th-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
        .th-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--t-3); }
      `}</style>
    </div>
  );
};

export default App;
