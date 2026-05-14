import { createSignal, Component, onMount, Show, For } from 'solid-js';
import Viewport from './components/Viewport';
import { DrawObject, ThorClient } from './api/client';

const App: Component = () => {
  const [mode, setMode] = createSignal<'Sketch' | 'Nesting' | 'CAM' | 'Simulation'>('Sketch');
  const [gcode, setGCode] = createSignal<string>("");
  const [status, setStatus] = createSignal("Ready");
  const [activeTool, setActiveTool] = createSignal<string | null>(null);
  const [history, setHistory] = createSignal<string[]>([]);
  
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
      if (msg.type === 'Error') {
        setStatus(msg.message);
      }
    });
  });

  const handleGenerate = () => {
    if (client) {
      setStatus("Generating Toolpath...");
      client.send({ type: 'ExportGCode' });
    }
  };

  const handleToolClick = (tool: string) => {
    setActiveTool(tool);
    setStatus(`Active Tool: ${tool.toUpperCase()}`);
  };

  const onObjectAdded = (obj: DrawObject) => {
    if (client) {
      client.send({ type: 'AddObject', object: obj });
      setHistory(prev => [`${obj.type} added`, ...prev]);
    }
  };

  const tools = [
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
  ];

  return (
    <div class="h-screen overflow-hidden flex flex-col bg-[#050505] text-[#e5e5e5] font-['Inter']">
      {/* Header */}
      <header class="h-14 bg-[#111111cc] backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-6 z-20 shadow-xl">
        <div class="flex items-center gap-4">
            <h1 class="text-xl font-black tracking-tighter text-[#00aaff]">THOR<span class="text-white">CC</span></h1>
            <div class="h-6 w-px bg-white/10 mx-2"></div>
            <nav class="flex gap-1">
                <button class="px-4 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest opacity-30 hover:opacity-100 transition">File</button>
                <button class="px-4 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest opacity-30 hover:opacity-100 transition">Edit</button>
            </nav>
        </div>
        
        <div class="flex bg-white/5 p-1 rounded-xl border border-white/5">
            {['Sketch', 'CAM', 'Simulation'].map(m => (
                <button 
                  onClick={() => setMode(m as any)}
                  class={`px-6 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${mode() === m ? 'bg-[#00aaff] text-black shadow-lg shadow-[#00aaff]/20' : 'text-white/40 hover:text-white'}`}
                >
                  {m === 'Simulation' ? 'Sim' : m}
                </button>
            ))}
        </div>

        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2 text-[10px] font-bold text-green-500 tracking-[0.2em]">
                <div class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                ONLINE
            </div>
            <button class="bg-[#00aaff] text-black px-6 py-2 rounded-lg font-black text-[10px] tracking-[0.2em] shadow-lg shadow-[#00aaff]/10 hover:scale-105 active:scale-95 transition" onClick={handleGenerate}>
              GENERATE G-CODE
            </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main class="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside class="w-72 bg-[#111111cc] backdrop-blur-2xl border-r border-white/5 flex flex-col z-10 shadow-2xl">
            <div class="p-6 border-b border-white/5">
                <h2 class="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mb-6 flex items-center gap-3">
                    <span class="w-4 h-px bg-[#00aaff]"></span>
                    Sketching
                </h2>
                <div class="grid grid-cols-3 gap-2">
                    <For each={tools}>
                      {(tool) => (
                        <button 
                          onClick={() => handleToolClick(tool.id)}
                          title={tool.label}
                          class={`flex flex-col items-center justify-center py-3 rounded-xl transition-all duration-300 group ${activeTool() === tool.id ? 'bg-[#00aaff] text-black shadow-xl shadow-[#00aaff]/20 scale-95' : 'bg-white/5 hover:bg-white/10'}`}
                        >
                            <span class="text-xl mb-1">{tool.icon}</span>
                            <span class={`text-[8px] font-black tracking-tighter ${activeTool() === tool.id ? 'text-black' : 'text-white/20 group-hover:text-white/60'}`}>{tool.label}</span>
                        </button>
                      )}
                    </For>
                </div>

                <h2 class="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-10 mb-6 flex items-center gap-3">
                    <span class="w-4 h-px bg-[#00aaff]"></span>
                    Constraints
                </h2>
                <div class="grid grid-cols-5 gap-1.5">
                    <For each={constraints}>
                      {(c) => (
                        <button 
                          onClick={() => handleToolClick(c.id)}
                          title={c.label}
                          class={`flex flex-col items-center justify-center aspect-square rounded-lg transition-all duration-300 ${activeTool() === c.id ? 'bg-[#00aaff] text-black shadow-lg shadow-[#00aaff]/20' : 'bg-white/5 hover:bg-white/10'}`}
                        >
                            <span class="text-[10px] font-black">{c.icon}</span>
                        </button>
                      )}
                    </For>
                </div>
            </div>
            
            <div class="p-6 flex-1 overflow-y-auto custom-scrollbar">
                <h2 class="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mb-6 flex items-center gap-3">
                    <span class="w-4 h-px bg-white/10"></span>
                    {mode() === 'CAM' ? 'Toolpath' : 'History'}
                </h2>
                
                <div class="space-y-1.5">
                    <For each={history()}>
                      {(item) => (
                        <div class="p-3 bg-white/5 border border-white/5 rounded-xl text-[10px] flex items-center justify-between group hover:bg-white/10 transition duration-300">
                          <div class="flex items-center gap-3">
                            <span class="w-1.5 h-1.5 rounded-full bg-[#00aaff] shadow-[0_0_8px_#00aaff]"></span>
                            <span class="font-bold opacity-60 group-hover:opacity-100 transition">{item}</span>
                          </div>
                          <button class="text-white/10 hover:text-red-500 transition px-2 text-xs">✕</button>
                        </div>
                      )}
                    </For>
                </div>
            </div>
        </aside>

        {/* Viewport */}
        <div class="flex-1 relative bg-black flex items-center justify-center">
            {/* Viewport Ambient Grid */}
            <div class="absolute inset-0 opacity-[0.05] pointer-events-none" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 50px 50px;"></div>
            <Viewport mode={mode()} activeTool={activeTool()} onObjectAdded={onObjectAdded} />
            
            {/* Context Tooltip */}
            <Show when={activeTool()}>
                <div class="absolute bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 bg-[#00aaff] text-black rounded-2xl font-black text-xs tracking-widest shadow-2xl animate-bounce">
                    CLICK TO START {activeTool()?.toUpperCase()}
                </div>
            </Show>
        </div>
      </main>

      {/* Footer */}
      <footer class="h-10 bg-[#111111] border-t border-white/5 flex items-center justify-between px-6 text-[10px] text-white/20 z-20">
        <div class="flex items-center gap-6">
          <span class={`${activeTool() ? 'text-[#00aaff] font-black opacity-100' : 'font-bold opacity-40'} tracking-widest`}>{status()}</span>
        </div>
        <div class="flex gap-8 uppercase font-black tracking-[0.3em]">
            <div class="flex items-center gap-3"><span class="opacity-20">UNIT</span> <span class="text-white/60">MM</span></div>
            <div class="flex items-center gap-3"><span class="opacity-20">GRID</span> <span class="text-white/60">5.0</span></div>
            <div class="flex items-center gap-3 text-[#00aaff]"><span class="opacity-20 text-white">SNAP</span> ON</div>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0,170,255,0.3); }
      `}</style>
    </div>
  );
};

export default App;
