import React from 'react';
import AppShell from './components/layout/AppShell';
import Sidebar from './components/outputs/Sidebar';
import TrafficMap from './components/map/TrafficMap';
import ChatPanel from './components/layout/ChatPanel';
import { useWebSocket } from './hooks/useWebSocket';

const App: React.FC = () => {
  // Initialize real-time feed simulation
  useWebSocket();

  return (
    <AppShell
      leftPanel={<Sidebar />}
      centerPanel={<TrafficMap />}
      rightPanel={<ChatPanel />}
    />
  );
};

export default App;
