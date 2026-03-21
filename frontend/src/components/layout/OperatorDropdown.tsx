import React, { useState, useRef, useEffect } from 'react';
import { Check, LogOut, ChevronDown, ChevronRight } from 'lucide-react';
import { useFeedStore, useOperatorStore, OPERATORS } from '../../store';

const getColorHash = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  ];
  return colors[Math.abs(hash) % colors.length];
};

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

type Section = 'session' | 'operator' | null;
type City = 'nyc' | 'chandigarh' | null;

const OperatorDropdown: React.FC = () => {
  const { city, switchCity } = useFeedStore();
  const { operator, setOperator } = useOperatorStore();

  const [isOpen, setIsOpen] = useState(false);
  // Which top-level section is expanded
  const [expandedSection, setExpandedSection] = useState<Section>(null);
  // Which city is expanded inside "Change Session"
  const [expandedCity, setExpandedCity] = useState<City>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setExpandedSection(null);
        setExpandedCity(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setExpandedSection(null);
        setExpandedCity(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const toggleSection = (section: Section) => {
    setExpandedSection((prev) => (prev === section ? null : section));
    setExpandedCity(null);
  };

  const toggleCity = (c: City) => {
    setExpandedCity((prev) => (prev === c ? null : c));
  };

  const handleSelectOperator = (selectedOperator: string, selectedCity: 'nyc' | 'chandigarh') => {
    if (selectedCity !== city) switchCity(selectedCity);
    setOperator(selectedOperator);
    setIsOpen(false);
    setExpandedSection(null);
    setExpandedCity(null);
  };

  const avatarColor = getColorHash(operator);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* ── Avatar Button ── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-scada-panel/80 transition-colors border border-transparent hover:border-scada-border rounded-sm"
      >
        <div className="flex flex-col items-end leading-none mr-1">
          <span className="text-[10px] font-mono text-scada-white font-bold">{operator}</span>
          <span className="text-[9px] font-mono text-scada-text-dim uppercase tracking-wider">
            {city === 'nyc' ? 'New York' : 'Chandigarh'}
          </span>
        </div>
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center border border-scada-bg"
          style={{ backgroundColor: avatarColor }}
        >
          <span className="text-[10px] font-bold text-white">{getInitials(operator)}</span>
        </div>
        <ChevronDown className={`h-3 w-3 text-scada-text-dim transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* ── Main Dropdown Panel ── */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-scada-panel border border-scada-border shadow-2xl z-[9999]">

          {/* Session summary */}
          <div className="p-3 border-b border-scada-border bg-scada-bg/50">
            <p className="text-[9px] font-mono uppercase text-scada-text-dim mb-2 tracking-widest">Active Session</p>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: avatarColor }}
              >
                <span className="text-xs font-bold text-white">{getInitials(operator)}</span>
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-bold text-scada-white truncate">{operator}</span>
                <span className="text-[9px] text-scada-text-dim uppercase">
                  {city === 'nyc' ? 'New York City' : 'Chandigarh'} Base
                </span>
              </div>
            </div>
          </div>

          <div className="py-1 font-mono text-[10px] uppercase">

            {/* ════ CHANGE SESSION ════ */}
            <button
              onClick={() => toggleSection('session')}
              className="w-full flex items-center justify-between px-3 py-2.5 text-scada-text hover:bg-scada-bg hover:text-scada-white transition-colors"
            >
              <span>Change Session</span>
              <ChevronRight className={`h-3 w-3 text-scada-text-dim transition-transform duration-200 ${expandedSection === 'session' ? 'rotate-90' : ''}`} />
            </button>

            {expandedSection === 'session' && (
              <div className="border-t border-scada-border/50">

                {/* NYC */}
                <button
                  onClick={() => toggleCity('nyc')}
                  className={`w-full flex items-center justify-between pl-6 pr-3 py-2 transition-colors ${expandedCity === 'nyc' ? 'bg-scada-bg text-scada-white' : 'text-scada-text hover:bg-scada-bg/50 hover:text-scada-white'}`}
                >
                  <div className="flex items-center gap-2">
                    <span>🗽</span>
                    <span>New York</span>
                    {city === 'nyc' && <div className="w-1.5 h-1.5 rounded-full bg-green-400 ml-1" />}
                  </div>
                  <ChevronRight className={`h-3 w-3 text-scada-text-dim transition-transform duration-200 ${expandedCity === 'nyc' ? 'rotate-90' : ''}`} />
                </button>

                {expandedCity === 'nyc' && (
                  <div className="bg-scada-bg/30 border-t border-scada-border/30">
                    <p className="px-8 py-1.5 text-[9px] text-scada-text-dim">NYC Operators</p>
                    {OPERATORS.nyc.map((op) => (
                      <button
                        key={op}
                        onClick={() => handleSelectOperator(op, 'nyc')}
                        className="w-full flex items-center justify-between pl-8 pr-3 py-2 text-scada-text hover:bg-scada-border/40 hover:text-scada-white transition-colors"
                      >
                        <span className={operator === op && city === 'nyc' ? 'text-scada-white font-bold' : ''}>{op}</span>
                        {operator === op && city === 'nyc' && <Check className="h-3 w-3 text-scada-blue" />}
                      </button>
                    ))}
                  </div>
                )}

                {/* Chandigarh */}
                <button
                  onClick={() => toggleCity('chandigarh')}
                  className={`w-full flex items-center justify-between pl-6 pr-3 py-2 transition-colors ${expandedCity === 'chandigarh' ? 'bg-scada-bg text-scada-white' : 'text-scada-text hover:bg-scada-bg/50 hover:text-scada-white'}`}
                >
                  <div className="flex items-center gap-2">
                    <span>🏙️</span>
                    <span>Chandigarh</span>
                    {city === 'chandigarh' && <div className="w-1.5 h-1.5 rounded-full bg-green-400 ml-1" />}
                  </div>
                  <ChevronRight className={`h-3 w-3 text-scada-text-dim transition-transform duration-200 ${expandedCity === 'chandigarh' ? 'rotate-90' : ''}`} />
                </button>

                {expandedCity === 'chandigarh' && (
                  <div className="bg-scada-bg/30 border-t border-scada-border/30">
                    <p className="px-8 py-1.5 text-[9px] text-scada-text-dim">CHD Operators</p>
                    {OPERATORS.chandigarh.map((op) => (
                      <button
                        key={op}
                        onClick={() => handleSelectOperator(op, 'chandigarh')}
                        className="w-full flex items-center justify-between pl-8 pr-3 py-2 text-scada-text hover:bg-scada-border/40 hover:text-scada-white transition-colors"
                      >
                        <span className={operator === op && city === 'chandigarh' ? 'text-scada-white font-bold' : ''}>{op}</span>
                        {operator === op && city === 'chandigarh' && <Check className="h-3 w-3 text-scada-blue" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ════ CHANGE OPERATOR (same city) ════ */}
            <button
              onClick={() => toggleSection('operator')}
              className="w-full flex items-center justify-between px-3 py-2.5 text-scada-text hover:bg-scada-bg hover:text-scada-white transition-colors border-t border-scada-border/30"
            >
              <span>Change Operator</span>
              <ChevronRight className={`h-3 w-3 text-scada-text-dim transition-transform duration-200 ${expandedSection === 'operator' ? 'rotate-90' : ''}`} />
            </button>

            {expandedSection === 'operator' && (
              <div className="bg-scada-bg/30 border-t border-scada-border/30 max-h-52 overflow-y-auto">
                <p className="px-6 py-1.5 text-[9px] text-scada-text-dim">
                  {city === 'nyc' ? 'NYC' : 'CHD'} Active Roster
                </p>
                {OPERATORS[city].map((op) => (
                  <button
                    key={op}
                    onClick={() => handleSelectOperator(op, city)}
                    className="w-full flex items-center justify-between pl-6 pr-3 py-2 text-scada-text hover:bg-scada-border/40 hover:text-scada-white transition-colors"
                  >
                    <span className={operator === op ? 'text-scada-white font-bold' : ''}>{op}</span>
                    {operator === op && <Check className="h-3 w-3 text-scada-blue" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Logout */}
          <div className="border-t border-scada-border p-1">
            <button className="w-full flex items-center justify-between px-3 py-2 text-scada-red/70 hover:text-scada-red hover:bg-scada-red/10 transition-colors">
              <span className="text-[10px] font-mono uppercase">System Logout</span>
              <LogOut className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperatorDropdown;
