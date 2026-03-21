import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../store';
import { Send, Bot, User, Terminal } from 'lucide-react';

const ChatPanel: React.FC = () => {
  const { messages, addMessage, isStreaming } = useChatStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    addMessage({
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    });

    setInput('');

    // Mock response
    setTimeout(() => {
      addMessage({
        role: 'assistant',
        content: "Acknowledged. Querying live feed for segment status. Current congestion level on diversion route is moderate (~45%).",
        timestamp: new Date().toISOString()
      });
    }, 1000);
  };

  return (
    <div className="flex flex-col h-full bg-scada-bg/20">
      {/* Chat History */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full opacity-20 pointer-events-none">
            <Terminal className="h-12 w-12 mb-2" />
            <p className="text-[10px] uppercase font-bold tracking-[0.2em]">Secure Channel Established</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="h-6 w-6 rounded bg-scada-blue/20 flex items-center justify-center border border-scada-blue/40 flex-shrink-0 mt-1">
                <Bot className="h-3 w-3 text-scada-blue" />
              </div>
            )}
            <div className={`max-w-[85%] p-3 rounded text-xs leading-relaxed ${
              msg.role === 'user' 
                ? 'bg-scada-panel border border-scada-border text-scada-header' 
                : 'bg-scada-blue/5 border border-scada-blue/20 text-scada-text'
            }`}>
              {msg.content}
              <span className="block text-[8px] mt-2 opacity-30 font-mono uppercase">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {msg.role === 'user' && (
              <div className="h-6 w-6 rounded bg-scada-panel flex items-center justify-center border border-scada-border flex-shrink-0 mt-1">
                <User className="h-3 w-3 text-scada-text" />
              </div>
            )}
          </div>
        ))}
        {isStreaming && (
          <div className="flex gap-3 justify-start">
            <div className="h-6 w-6 rounded bg-scada-blue/20 flex items-center justify-center border border-scada-blue/40 flex-shrink-0">
               <Bot className="h-3 w-3 text-scada-blue animate-pulse" />
            </div>
            <div className="bg-scada-blue/5 border border-scada-blue/20 p-3 rounded">
               <div className="flex gap-1">
                 <div className="w-1 h-1 bg-scada-blue rounded-full animate-bounce" />
                 <div className="w-1 h-1 bg-scada-blue rounded-full animate-bounce [animation-delay:0.2s]" />
                 <div className="w-1 h-1 bg-scada-blue rounded-full animate-bounce [animation-delay:0.4s]" />
               </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-scada-border bg-scada-panel/50">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="TYPE COMMAND OR QUERY OFFICER..."
            className="w-full bg-scada-bg border border-scada-border rounded-lg pl-4 pr-12 py-3 text-xs font-mono text-scada-header focus:outline-none focus:border-scada-blue transition-colors uppercase tracking-wider"
          />
          <button 
            onClick={handleSend}
            className="absolute right-2 top-2 p-2 text-scada-text hover:text-scada-blue transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[8px] text-scada-text/30 mt-2 uppercase text-center tracking-widest">
          End-to-end encrypted • AI Co-pilot Session
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
