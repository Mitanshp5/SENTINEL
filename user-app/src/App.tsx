import React from 'react';
import AppShell from './components/layout/AppShell';
import Sidebar from './components/outputs/Sidebar';
import TrafficMap from './components/map/TrafficMap';
import ChatPanel from './components/layout/ChatPanel';
import SocialPanel from './components/social/SocialPanel';
import { useWebSocket } from './hooks/useWebSocket';

const App: React.FC = () => {
  useWebSocket();

  return (
    <AppShell
      leftPanel={<Sidebar />}
      centerPanel={<TrafficMap />}
      rightPanel={<ChatPanel />}
      socialPanel={<SocialPanel />}
    />
  );
};

export default App;
