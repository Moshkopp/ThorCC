import { createSignal, Component, onMount, onCleanup, For } from 'solid-js';
import Viewport from './components/Viewport';
import { DimensionAnnotation, DimensionTarget, DrawObject, Sketch, SketchConstraint, ThorClient } from './api/client';

const App: Component = () => {
  const [mode, setMode] = createSignal<'Sketch' | 'Nesting' | 'CAM' | 'Simulation'>('Sketch');
  const [gcode, setGCode] = createSignal<string>("");
  const [status, setStatus] = createSignal("Ready");
  const [activeTool, setActiveTool] = createSignal<string | null>('select');
  const [toolActionVersion, setToolActionVersion] = createSignal(0);
  const [history, setHistory] = createSignal<string[]>([]);
  const [sketch, setSketch] = createSignal<Sketch | null>(null);
  const [annotations, setAnnotations] = createSignal<DimensionAnnotation[]>([]);
  
  let client: ThorClient | undefined;

  onMount(() => {
    client = new ThorClient(`ws://${window.location.host}/ws`);
    client.onMessage((msg) => {
      if (msg.type === 'GCode') {
        setGCode(msg.content);
        setStatus("G-Code Generated");
      }
      if (msg.type === 'UpdateHistory') {
        setHistory(msg.items);
      }
      if (msg.type === 'Sketch') {
        setSketch(msg.sketch);
        setAnnotations(msg.annotations ?? []);
        setStatus("Sketch Updated");
        setHistory([
          `${msg.sketch.entities.length} entities in sketch`,
          `${msg.sketch.constraints.length} constraints in sketch`,
          `${(msg.annotations ?? []).length} dimensions in sketch`,
        ]);
      }
      if (msg.type === 'Error') {
        setStatus(msg.message);
      }
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isEditingText = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
      if (isEditingText) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleSketchRedo();
        } else {
          handleSketchUndo();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleSketchRedo();
        return;
      }

      if (event.key !== 'Escape') return;
      setActiveTool('select');
      setStatus("SELECT: ready");
    };

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  const handleGenerate = () => {
    if (client) {
      setStatus("Generating Toolpath...");
      client.send({ type: 'ExportGCode' });
    }
  };

  const handleSketchUndo = () => {
    client?.send({ type: 'SketchUndo' });
    setStatus("Sketch Undo");
  };

  const handleSketchRedo = () => {
    client?.send({ type: 'SketchRedo' });
    setStatus("Sketch Redo");
  };

  const handleToolClick = (tool: string) => {
    setActiveTool(tool);
    setToolActionVersion((version) => version + 1);
    if (tool === 'select') {
      setStatus("SELECT: click geometry in the viewport");
    } else if (['horiz', 'vert', 'parallel', 'coincident', 'equal', 'dimension', 'radius', 'diameter', 'angle'].includes(tool)) {
      setStatus(`${tool.toUpperCase()}: click geometry in the viewport`);
    } else {
      setStatus(`Draw ${tool.toUpperCase()}: click start and end points`);
    }
  };

  const onObjectAdded = (obj: DrawObject) => {
    if (client) {
      client.send({ type: 'AddObject', object: obj });
      setHistory(prev => [`${obj.type} added`, ...prev]);
      setActiveTool('select');
      setStatus("SELECT: ready");
    }
  };

  const onDimensionAdded = (target: DimensionTarget, value: number, offset?: [number, number]) => {
    client?.send({ type: 'AddDimension', target, value, offset });
    setHistory(prev => [`Dimension ${value.toFixed(2)} added`, ...prev]);
  };

  const onDimensionChanged = (index: number, value: number) => {
    client?.send({ type: 'UpdateDimensionValue', index, value });
    setHistory(prev => [`Dimension changed to ${value.toFixed(2)}`, ...prev].slice(0, 12));
  };

  const onDimensionMoved = (index: number, offset: [number, number]) => {
    client?.send({ type: 'UpdateDimensionOffset', index, offset });
    setHistory(prev => [`Dimension moved`, ...prev].slice(0, 12));
  };

  const onConstraintAdded = (constraint: SketchConstraint) => {
    client?.send({ type: 'AddConstraint', constraint });
    setHistory(prev => [`Constraint added`, ...prev]);
  };

  const onPointsMoved = (points: { id: string; x: number; y: number }[]) => {
    client?.send({ type: 'UpdatePoints', points });
    setHistory(prev => [`${points.length} point${points.length === 1 ? '' : 's'} moved`, ...prev].slice(0, 12));
  };

  const onSelectionDeleted = (entities: string[], dimensions: number[]) => {
    client?.send({ type: 'DeleteSelection', entities, dimensions });
    setHistory(prev => [`Selection deleted`, ...prev].slice(0, 12));
  };

  const onSelectTool = () => {
    setActiveTool('select');
  };

  const onViewportFeedback = (message: string) => {
    setStatus(message);
    setHistory(prev => [message, ...prev].slice(0, 12));
  };

  const tools = [
    { id: 'select', icon: '↖', label: 'SELECT' },
    { id: 'line', icon: '╱', label: 'LINE' },
    { id: 'circle', icon: '◯', label: 'CIRCLE' },
    { id: 'rect', icon: '□', label: 'RECT' },
    { id: 'triangle', icon: '△', label: 'TRI' },
    { id: 'polyline', icon: '⟪', label: 'POLY' },
    { id: 'hexagon', icon: '⬢', label: 'HEX' },
    { id: 'octagon', icon: '⯃', label: 'OCTA' },
    { id: 'spline', icon: '〜', label: 'SPLINE' },
    { id: 'fillet', icon: '◰', label: 'FILLET' },
  ];

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
    <div class="h-screen overflow-hidden flex flex-col bg-[#090c0d] text-[#d7dcdd] font-['Inter']">
      {/* Header */}
      <header class="h-14 bg-[#101415] border-b border-white/10 flex items-center justify-between px-5 z-20">
        <div class="flex items-center gap-4">
            <h1 class="text-xl font-bold tracking-normal text-[#38b8c8]">THOR<span class="text-white/80">CC</span></h1>
            <div class="h-5 w-px bg-white/10 mx-1"></div>
            <nav class="flex gap-1">
                <button class="px-3 py-1 rounded text-xs font-semibold uppercase tracking-normal text-white/50 hover:text-white/80 transition">File</button>
                <button class="px-3 py-1 rounded text-xs font-semibold uppercase tracking-normal text-white/50 hover:text-white/80 transition">Edit</button>
            </nav>
            <div class="flex gap-1">
                <button onClick={handleSketchUndo} title="Sketch Undo" class="px-2.5 py-1 rounded text-xs font-semibold text-white/55 hover:text-white/85 hover:bg-white/5 transition">Undo</button>
                <button onClick={handleSketchRedo} title="Sketch Redo" class="px-2.5 py-1 rounded text-xs font-semibold text-white/55 hover:text-white/85 hover:bg-white/5 transition">Redo</button>
            </div>
        </div>
        
        <div class="flex bg-[#0b0f10] p-0.5 rounded border border-white/10">
            {['Sketch', 'CAM', 'Simulation'].map(m => (
                <button 
                  onClick={() => setMode(m as any)}
                  class={`px-6 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-normal transition-colors ${mode() === m ? 'bg-[#2f8f9d] text-[#061012]' : 'text-white/55 hover:text-white/85'}`}
                >
                  {m === 'Simulation' ? 'Sim' : m}
                </button>
            ))}
        </div>

        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#7bbf8b] tracking-normal">
                <div class="w-1.5 h-1.5 rounded-full bg-[#7bbf8b]"></div>
                ONLINE
            </div>
            <button class="bg-[#2f8f9d] text-[#061012] px-5 py-2 rounded font-bold text-xs tracking-normal hover:bg-[#38a8b8] active:bg-[#267783] transition-colors" onClick={handleGenerate}>
              GENERATE G-CODE
            </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main class="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside class="w-80 bg-[#101415] border-r border-white/10 flex flex-col z-10">
            <div class="p-5 border-b border-white/10">
                <h2 class="text-xs font-semibold uppercase tracking-normal text-white/60 mb-4 flex items-center gap-3">
                    <span class="w-4 h-px bg-[#38b8c8]/70"></span>
                    Sketching
                </h2>
                <div class="grid grid-cols-3 gap-2">
                    <For each={tools}>
                      {(tool) => (
                        <button 
                          onClick={() => handleToolClick(tool.id)}
                          title={tool.label}
                          class={`flex flex-col items-center justify-center h-16 rounded border transition-colors group ${activeTool() === tool.id ? 'bg-[#2f8f9d] border-[#65c1cc] text-[#061012]' : 'bg-[#151a1b] border-white/10 hover:bg-[#1a2021] hover:border-white/20'}`}
                        >
                            <span class="text-xl leading-none mb-1">{tool.icon}</span>
                            <span class={`text-[10px] font-semibold tracking-normal ${activeTool() === tool.id ? 'text-[#061012]' : 'text-white/55 group-hover:text-white/80'}`}>{tool.label}</span>
                        </button>
                      )}
                    </For>
                </div>

                <h2 class="text-xs font-semibold uppercase tracking-normal text-white/60 mt-8 mb-4 flex items-center gap-3">
                    <span class="w-4 h-px bg-[#38b8c8]/70"></span>
                    Constraints
                </h2>
                <div class="grid grid-cols-5 gap-2">
                    <For each={constraints}>
                      {(c) => (
                        <button 
                          onClick={() => handleToolClick(c.id)}
                          title={c.label}
                          class={`flex flex-col items-center justify-center aspect-square min-h-12 rounded border transition-colors ${activeTool() === c.id ? 'bg-[#2f8f9d] border-[#65c1cc] text-[#061012]' : 'bg-[#151a1b] border-white/10 hover:bg-[#1a2021] hover:border-white/20'}`}
                        >
                            <span class="text-base font-semibold">{c.icon}</span>
                        </button>
                      )}
                    </For>
                </div>
            </div>
            
            <div class="p-5 flex-1 overflow-y-auto custom-scrollbar">
                <h2 class="text-xs font-semibold uppercase tracking-normal text-white/60 mb-4 flex items-center gap-3">
                    <span class="w-4 h-px bg-white/10"></span>
                    {mode() === 'CAM' ? 'Toolpath' : 'History'}
                </h2>
                
                <div class="space-y-1">
                    <For each={history()}>
                      {(item) => (
                        <div class="px-3 py-2.5 bg-[#151a1b] border border-white/10 rounded text-xs flex items-center justify-between group hover:bg-[#1a2021] transition-colors">
                          <div class="flex items-center gap-3">
                            <span class="w-1.5 h-1.5 rounded-full bg-[#38b8c8]/85"></span>
                            <span class="font-medium text-white/70 group-hover:text-white/90 transition-colors">{item}</span>
                          </div>
                          <button class="text-white/10 hover:text-red-500 transition px-2 text-xs">✕</button>
                        </div>
                      )}
                    </For>
                </div>
            </div>
        </aside>

        {/* Viewport */}
        <div class="flex-1 relative bg-[#070a0b] flex items-center justify-center">
            {/* Viewport Ambient Grid */}
            <Viewport
              mode={mode()}
              activeTool={activeTool()}
              toolActionVersion={toolActionVersion()}
              sketch={sketch()}
              annotations={annotations()}
              onObjectAdded={onObjectAdded}
              onDimensionAdded={onDimensionAdded}
              onDimensionChanged={onDimensionChanged}
              onDimensionMoved={onDimensionMoved}
              onConstraintAdded={onConstraintAdded}
              onPointsMoved={onPointsMoved}
              onSelectionDeleted={onSelectionDeleted}
              onSelectTool={onSelectTool}
              onFeedback={onViewportFeedback}
            />
        </div>
      </main>

      {/* Footer */}
      <footer class="h-11 bg-[#101415] border-t border-white/10 flex items-center justify-between px-5 text-xs text-white/45 z-20">
        <div class="flex items-center gap-6">
          <span class={`${activeTool() ? 'text-[#72c4ce] font-semibold opacity-100' : 'font-medium opacity-70'} tracking-normal`}>{status()}</span>
        </div>
        <div class="flex gap-7 uppercase font-semibold tracking-normal">
            <div class="flex items-center gap-2"><span class="opacity-45">UNIT</span> <span class="text-white/65">MM</span></div>
            <div class="flex items-center gap-2"><span class="opacity-45">GRID</span> <span class="text-white/65">5.0</span></div>
            <div class="flex items-center gap-2 text-[#72c4ce]"><span class="opacity-45 text-white">SNAP</span> ON</div>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(114,196,206,0.35); }
      `}</style>
    </div>
  );
};

export default App;
