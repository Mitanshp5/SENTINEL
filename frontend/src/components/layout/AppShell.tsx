import React, { ReactNode } from 'react';
import { useFeedStore } from '../../store';
import { Activity, Map as MapIcon, MessageSquare, ShieldAlert } from 'lucide-react';

interface AppShellProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({ leftPanel, centerPanel, rightPanel }) => {
  const { city, setCity, lastUpdate } = useFeedStore();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-scada-bg">
      {/* Top Header */}
      <header className="h-14 border-b border-scada-border flex items-center justify-between px-6 bg-scada-panel">
        <div className="flex items-center gap-3">
          <ShieldAlert className="text-scada-red h-6 w-6" />
          <h1 className="text-lg font-bold text-scada-header uppercase tracking-wider">
            Traffic Incident Co-Pilot
          </h1>
          <div className="ml-6 px-3 py-1 rounded border border-scada-border bg-scada-bg/50 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-scada-green animate-pulse" />
            <span className="text-xs font-mono uppercase">System Active</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex bg-scada-bg rounded border border-scada-border overflow-hidden">
            <button
              onClick={() => setCity('nyc')}
              className={`px-4 py-1 text-xs font-bold transition-colors ${
                city === 'nyc' ? 'bg-scada-blue text-white' : 'hover:bg-scada-panel text-scada-text'
              }`}
            >
              NEW YORK
            </button>
            <button
              onClick={() => setCity('chandigarh')}
              className={`px-4 py-1 text-xs font-bold transition-colors border-l border-scada-border ${
                city === 'chandigarh' ? 'bg-scada-blue text-white' : 'hover:bg-scada-panel text-scada-text'
              }`}
            >
              CHANDIGARH
            </button>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase font-bold text-scada-text/50">Last Update</span>
            <span className="text-xs font-mono text-scada-header">
              {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--:--'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel: Intelligence Outputs */}
        <section className="w-[380px] border-r border-scada-border bg-scada-panel/30 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-scada-border bg-scada-panel flex items-center gap-2">
            <Activity className="h-4 w-4 text-scada-blue" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-scada-header">Incident Intelligence</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {leftPanel}
          </div>
        </section>

        {/* Center Panel: Map Environment */}
        <section className="flex-1 relative border-r border-scada-border flex flex-col overflow-hidden bg-black">
           <div className="absolute top-4 left-4 z-[1000] p-2 rounded bg-scada-panel/80 backdrop-blur-sm border border-scada-border flex items-center gap-2 pointer-events-none">
            <MapIcon className="h-4 w-4 text-scada-blue" />
            <span className="text-xs font-bold uppercase tracking-wider text-scada-header">Situation Map</span>
          </div>
          {centerPanel}
        </section>

        {/* Right Panel: Conversational Assistant */}
        <section className="w-[400px] flex flex-col overflow-hidden bg-scada-panel/30">
          <div className="p-3 border-b border-scada-border bg-scada-panel flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-scada-blue" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-scada-header">Officer Communication</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            {rightPanel}
          </div>
        </section>
      </main>
    </div>
  );
};

export default AppShell;
