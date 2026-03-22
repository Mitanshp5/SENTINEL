import { create } from 'zustand';
import type { TrafficSegment, Incident, LLMOutput, ChatMessage } from '../types';
import { api } from '../services/api';
import { inferIncidentCity, normalizeCityCode } from '../utils/city';

// Hardcoded city centers so the map snaps immediately on click
const CITY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  nyc: { lat: 40.7549, lng: -73.984, zoom: 14 },
  chandigarh: { lat: 30.7333, lng: 76.7794, zoom: 14 },
};

interface FeedState {
  city: 'nyc' | 'chandigarh';
  segments: TrafficSegment[];
  lastUpdate: string | null;
  baselines: Record<string, any>;
  cityCenter: { lat: number; lng: number; zoom: number } | null;
  setCity: (city: 'nyc' | 'chandigarh') => void;
  setSegments: (segments: TrafficSegment[]) => void;
  setBaselines: (baselines: Record<string, any>) => void;
  setCityCenter: (center: { lat: number; lng: number; zoom: number }) => void;
  switchCity: (city: 'nyc' | 'chandigarh') => Promise<void>;
  fetchBaselines: () => Promise<void>;
  fetchCityInfo: () => Promise<void>;
}

export const useFeedStore = create<FeedState>((set) => ({
  city: 'nyc',
  segments: [],
  lastUpdate: null,
  baselines: {},
  cityCenter: CITY_CENTERS['nyc'],
  setCity: (city) => set({ city, segments: [], cityCenter: CITY_CENTERS[city] }),
  setSegments: (segments) =>
    set({ segments, lastUpdate: new Date().toISOString() }),
  setBaselines: (baselines) => set({ baselines }),
  setCityCenter: (cityCenter) => set({ cityCenter }),
  switchCity: async (city) => {
    // Immediately update local state + map center — no waiting on backend
    set({ city, segments: [], cityCenter: CITY_CENTERS[city] });
    try {
      // Also inform backend to switch its live feed source
      await api.switchCity(city);
      const baselineData = await api.getBaselines();
      set({ baselines: baselineData.baselines });
    } catch (e) {
      console.error('Failed to switch city on backend:', e);
      // Local state already updated — map will still work
    }
  },
  fetchBaselines: async () => {
    try {
      const data = await api.getBaselines();
      set({ baselines: data.baselines });
    } catch (e) {
      console.error('Failed to fetch baselines:', e);
    }
  },
  fetchCityInfo: async () => {
    try {
      const data = await api.getCity();
      // Keep local city selection stable; only refresh center details.
      set((state) => ({ cityCenter: state.cityCenter ?? data.center }));
    } catch (e) {
      console.error('Failed to fetch city info:', e);
    }
  },
}));

interface IncidentState {
  currentIncident: Incident | null;
  llmOutput: LLMOutput | null;
  incidents: Incident[];
  diversionRoutes: any[];
  collisions: any[];
  congestionZones: any[];
  setIncident: (incident: Incident | null) => void;
  setLLMOutput: (output: LLMOutput | null) => void;
  addIncident: (incident: Incident) => void;
  clearIncident: () => void;
  setDiversionRoutes: (routes: any[]) => void;
  setCollisions: (collisions: any[]) => void;
  setIncidents: (incidents: Incident[]) => void;
  setCongestionZone: (zone: any) => void;
  clearCongestionZone: (zoneId: string) => void;
  setCongestionZones: (zones: any[]) => void;
}

export const useIncidentStore = create<IncidentState>((set) => ({
  currentIncident: null,
  llmOutput: null,
  incidents: [],
  diversionRoutes: [],
  collisions: [],
  congestionZones: [],
  setIncident: (incident) =>
    set((state) => {
      if (!incident) {
        return { currentIncident: null };
      }
      const inferred = inferIncidentCity({
        city: incident.city,
        on_street: incident.on_street,
        location: { coordinates: [incident.location?.lng, incident.location?.lat] },
      });
      const normalized: Incident = {
        ...incident,
        city: inferred ?? incident.city,
      };
      return {
        currentIncident: normalized,
        incidents: [...state.incidents.filter((i) => i.id !== normalized.id), normalized],
      };
    }),
  setLLMOutput: (output) => set({ llmOutput: output }),
  addIncident: (incident) =>
    set((state) => {
      const inferred = inferIncidentCity({
        city: incident.city,
        on_street: incident.on_street,
        location: { coordinates: [incident.location?.lng, incident.location?.lat] },
      });
      const normalized = { ...incident, city: inferred ?? incident.city };
      return { incidents: [...state.incidents, normalized] };
    }),
  clearIncident: () => set({ currentIncident: null, llmOutput: null, diversionRoutes: [], collisions: [] }),
  setDiversionRoutes: (routes) => set({ diversionRoutes: routes }),
  setCollisions: (collisions) => set({ collisions }),
  setIncidents: (incidents) =>
    set((state) => {
      const normalized = (incidents || []).map((inc: any) => {
        const inferred = inferIncidentCity(inc);
        return { ...inc, city: inferred ?? normalizeCityCode(inc?.city) ?? inc?.city };
      });
      const currentId = state.currentIncident?.id;
      return {
        incidents: normalized,
        currentIncident: currentId
          ? (normalized.find((i: any) => i.id === currentId) ?? state.currentIncident)
          : state.currentIncident,
      };
    }),
  setCongestionZone: (zone) =>
    set((state) => {
      const cityFromCenter = normalizeCityCode(
        inferIncidentCity({
          city: zone?.city,
          location: { coordinates: zone?.center || zone?.location?.coordinates || [] },
        }),
      );
      const normalized = {
        ...zone,
        city: normalizeCityCode(zone?.city) ?? cityFromCenter ?? useFeedStore.getState().city,
      };
      return {
        congestionZones: [
          ...state.congestionZones.filter((z: any) => z.zone_id !== normalized.zone_id),
          normalized,
        ],
      };
    }),
  clearCongestionZone: (zoneId) =>
    set((state) => ({
      congestionZones: state.congestionZones.filter((z: any) => z.zone_id !== zoneId),
    })),
  setCongestionZones: (zones) =>
    set({
      congestionZones: (zones || []).map((z: any) => ({
        ...z,
        city: normalizeCityCode(z?.city) ?? useFeedStore.getState().city,
      })),
    }),
}));

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  addMessage: (message: ChatMessage) => void;
  setStreaming: (isStreaming: boolean) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setStreaming: (isStreaming) => set({ isStreaming }),
  clearChat: () => set({ messages: [] }),
}));
