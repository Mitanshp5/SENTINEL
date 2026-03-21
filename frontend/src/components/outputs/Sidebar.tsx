import React from 'react';
import { useIncidentStore } from '../../store';
import { TrafficCone, Navigation, Share2, Clipboard, CheckCircle } from 'lucide-react';

const Sidebar: React.FC = () => {
  const { llmOutput, currentIncident } = useIncidentStore();

  if (!currentIncident) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-scada-text/30 p-10 text-center">
        <TrafficCone className="h-12 w-12 mb-4" />
        <p className="text-sm font-bold uppercase tracking-widest italic">Monitoring City Feed</p>
        <p className="text-xs mt-2 uppercase tracking-tight">System standing by for incident detection.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-20 overflow-y-auto h-full">
      {/* Active Incident Header */}
      <div className="bg-scada-red/10 border border-scada-red/30 rounded p-3">
        <div className="flex justify-between items-start mb-2">
          <span className="text-[10px] font-bold text-scada-red uppercase tracking-widest bg-scada-red/20 px-2 py-0.5 rounded">
            {currentIncident.severity}
          </span>
          <span className="text-[10px] font-mono text-scada-text/50 uppercase">ID: {currentIncident.id}</span>
        </div>
        <h3 className="text-sm font-bold text-scada-header uppercase tracking-tight truncate">
          {currentIncident.on_street}
        </h3>
        <p className="text-xs text-scada-text uppercase tracking-tight">At {currentIncident.cross_street}</p>
      </div>

      {/* Signal Retiming Recommendations */}
      {llmOutput?.signal_retiming?.intersections.map((sig, i) => (
        <div key={i} className="bg-scada-panel border border-scada-border rounded overflow-hidden">
          <div className="bg-scada-blue/10 px-3 py-2 border-b border-scada-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrafficCone className="h-3 w-3 text-scada-blue" />
              <span className="text-xs font-bold uppercase tracking-widest text-scada-header">Signal Retiming</span>
            </div>
            <button className="text-[10px] uppercase font-bold text-scada-blue hover:underline">Apply All</button>
          </div>
          <div className="p-3">
             <h4 className="text-xs font-bold text-scada-header mb-2 uppercase">{sig.name}</h4>
             <div className="grid grid-cols-2 gap-4 mb-3">
               <div className="bg-scada-bg/50 p-2 border border-scada-border/30 rounded">
                 <span className="block text-[9px] text-scada-text/50 uppercase font-bold mb-1">N/S Green</span>
                 <div className="flex items-center justify-between font-mono">
                   <span className="text-scada-text line-through opacity-50">{sig.current_ns_green}s</span>
                   <span className="text-scada-green text-sm font-bold">{sig.recommended_ns_green}s</span>
                 </div>
               </div>
               <div className="bg-scada-bg/50 p-2 border border-scada-border/30 rounded">
                 <span className="block text-[9px] text-scada-text/50 uppercase font-bold mb-1">E/W Green</span>
                 <div className="flex items-center justify-between font-mono">
                   <span className="text-scada-text line-through opacity-50">{sig.current_ew_green}s</span>
                   <span className="text-scada-red text-sm font-bold">{sig.recommended_ew_green}s</span>
                 </div>
               </div>
             </div>
             <p className="text-xs italic text-scada-text/80 leading-snug border-l-2 border-scada-blue/30 pl-2">
               {sig.reasoning}
             </p>
          </div>
        </div>
      ))}

      {/* Diversion Recommendations */}
      {llmOutput?.diversions?.routes.map((route, i) => (
        <div key={i} className="bg-scada-panel border border-scada-border rounded overflow-hidden">
          <div className="bg-scada-blue/10 px-3 py-2 border-b border-scada-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Navigation className="h-3 w-3 text-scada-blue" />
              <span className="text-xs font-bold uppercase tracking-widest text-scada-header">Active Diversion</span>
            </div>
          </div>
          <div className="p-3">
            <h4 className="text-xs font-bold text-scada-header mb-1 uppercase">{route.name}</h4>
            <div className="flex flex-wrap gap-1 mb-3">
               {route.path.map((step, idx) => (
                 <React.Fragment key={idx}>
                   <span className="text-[10px] text-scada-text uppercase bg-scada-bg/50 px-1.5 rounded border border-scada-border/20">{step}</span>
                   {idx < route.path.length - 1 && <span className="text-scada-text/30 text-[10px]">→</span>}
                 </React.Fragment>
               ))}
            </div>
            <div className="flex items-center justify-between bg-scada-bg/50 p-2 rounded border border-scada-border/30">
               <div>
                 <span className="block text-[9px] text-scada-text/50 uppercase font-bold">Absorption Load</span>
                 <span className="text-sm font-mono text-scada-blue font-bold">{route.estimated_absorption_pct}%</span>
               </div>
               <button className="bg-scada-blue text-white px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-scada-blue/80">Activate</button>
            </div>
          </div>
        </div>
      ))}

      {/* Alert Drafts */}
      {llmOutput?.alerts && (
        <div className="bg-scada-panel border border-scada-border rounded overflow-hidden mb-6">
           <div className="bg-scada-blue/10 px-3 py-2 border-b border-scada-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Share2 className="h-3 w-3 text-scada-blue" />
              <span className="text-xs font-bold uppercase tracking-widest text-scada-header">Broadcast Drafts</span>
            </div>
          </div>
          <div className="p-3 space-y-4">
             <div>
               <div className="flex items-center justify-between mb-1">
                 <span className="text-[9px] font-bold text-scada-text/50 uppercase tracking-widest">VMS SIGNBOARD</span>
                 <Clipboard className="h-3 w-3 text-scada-text/30 cursor-pointer hover:text-scada-blue" />
               </div>
               <pre className="bg-black text-scada-yellow p-2 rounded text-xs font-mono leading-tight border border-scada-yellow/20">
                 {llmOutput.alerts.vms}
               </pre>
             </div>
             <div>
               <div className="flex items-center justify-between mb-1">
                 <span className="text-[9px] font-bold text-scada-text/50 uppercase tracking-widest">RADIO BULLETIN</span>
                 <Clipboard className="h-3 w-3 text-scada-text/30 cursor-pointer hover:text-scada-blue" />
               </div>
               <p className="text-xs text-scada-text leading-tight bg-scada-bg p-2 rounded border border-scada-border/20">
                 {llmOutput.alerts.radio}
               </p>
             </div>
             <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-bold text-scada-text/50 uppercase tracking-widest">SOCIAL MEDIA</span>
                  <CheckCircle className="h-3 w-3 text-scada-green cursor-pointer" />
                </div>
                <p className="text-xs text-scada-blue leading-tight bg-scada-bg p-2 rounded border border-scada-blue/10">
                  {llmOutput.alerts.social_media}
                </p>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
