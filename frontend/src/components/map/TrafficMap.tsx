import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, Polyline, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useFeedStore, useIncidentStore } from '../../store';
import { CameraPopup } from './CameraPopup';
import { api } from '../../services/api';

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const NYC_CENTER: [number, number] = [40.7128, -74.0060]; // NYC fallback center
const DEFAULT_ZOOM = 15;

const SEVERITY_RADIUS: Record<string, number> = {
  critical: 600,  // ~600m
  major: 450,
  moderate: 330,
  minor: 220,
};



const MapController: React.FC<{ center: [number, number]; zoom: number; city: string }> = ({ center, zoom, city }) => {
  const map = useMap();
  const prevCityRef = useRef<string>('');
  const mountedRef = useRef<boolean>(false);

  useEffect(() => {
    // Only call setView on initial mount OR when the city actually changes
    // Do NOT re-zoom on incident detection, feed updates, or segment changes
    if (!mountedRef.current || prevCityRef.current !== city) {
      map.setView(center, zoom);
      prevCityRef.current = city;
      mountedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]); // Intentionally only city in deps — center/zoom changes must NOT trigger setView
  return null;
};

const TrafficMap: React.FC = () => {
  const { cityCenter, city } = useFeedStore();
  const { incidents, currentIncident, setCollisions, incidentRoutes, congestionZones } = useIncidentStore();

  const BIG_INTERSECTIONS = [
    { id: '1', name: "W 34th St & 7th Ave", lat: 40.7505, lng: -73.9904 },
    { id: '2', name: "Broadway & 34th St", lat: 40.7484, lng: -73.9878 },
    { id: '3', name: "10th Ave & 42nd St", lat: 40.7579, lng: -73.9980 },
    { id: '4', name: "Tribune Chowk", lat: 30.7270, lng: 76.7675 },
    { id: '5', name: "Piccadily Chowk", lat: 30.7246, lng: 76.7621 }
  ];



  // Debug: log incidentRoutes state changes
  useEffect(() => {
    console.log('[TrafficMap] incidentRoutes updated:', incidentRoutes.length, 'pairs',
      incidentRoutes.map(r => ({
        id: r.incidentId,
        blockedPts: r.blocked?.geometry?.coordinates?.length || 0,
        altPts: r.alternate?.geometry?.coordinates?.length || 0,
      }))
    );
  }, [incidentRoutes]);

  useEffect(() => {
    if (currentIncident) {
      api.getNearbyCollisions(currentIncident.location.lat, currentIncident.location.lng, 0.01)
        .then(data => {
          if (Array.isArray(data)) setCollisions(data);
        })
        .catch(() => {});
    }
  }, [currentIncident?.id]);

  const mapCenter: [number, number] = cityCenter
    ? [cityCenter.lat, cityCenter.lng]
    : NYC_CENTER;
  const mapZoom = cityCenter?.zoom ?? DEFAULT_ZOOM;

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        className="w-full h-full"
        zoomControl={false}
      >
        {/* SVG Filter definitions for route glow effects */}
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            <filter id="route-glow-green" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="route-glow-purple" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        </svg>
        <MapController center={mapCenter} zoom={mapZoom} city={city} />

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
        />

        {/* Traffic Speed Segments — DISABLED: too noisy, only show actual incident markers */}
        {/* Segment heat-map can be re-enabled here if needed for analytics view */}



        {/* Incident Markers — ALL active incidents with gradient impact zones */}
        {incidents.filter((inc) => inc.status === 'active' && inc.city === city).map((inc) => {
          const baseRadius = SEVERITY_RADIUS[inc.severity] || 330;
          // Convert meters to approximate Leaflet Circle radius
          // At ~40° latitude, 1° ≈ 111km, so radius in degrees = meters / 111000
          
          return (
            <React.Fragment key={`incident-${inc.id}`}>
              {/* Layer 3: Outer glow - Yellow, 15% opacity, pulsing */}
              <Circle
                center={[inc.location.lat, inc.location.lng]}
                radius={baseRadius}
                pathOptions={{
                  color: '#fbbf24',
                  fillColor: '#fbbf24',
                  fillOpacity: 0.15,
                  weight: 1,
                  className: 'animate-pulse',
                }}
              />
              {/* Layer 2: Middle ring - Amber, 35% opacity */}
              <Circle
                center={[inc.location.lat, inc.location.lng]}
                radius={baseRadius * 0.5}
                pathOptions={{
                  color: '#f59e0b',
                  fillColor: '#f59e0b',
                  fillOpacity: 0.35,
                  weight: 1,
                }}
              />
              {/* Layer 1: Inner core - Red, 70% opacity */}
              <Circle
                center={[inc.location.lat, inc.location.lng]}
                radius={baseRadius * 0.25}
                pathOptions={{
                  color: '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: 0.7,
                  weight: 2,
                }}
              />
              {/* Center marker with label */}
              <CircleMarker
                center={[inc.location.lat, inc.location.lng]}
                radius={6}
                pathOptions={{
                  color: '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95} permanent>
                  <span className="text-[10px] font-mono font-bold">
                    ⚠️ {inc.severity.toUpperCase()}: {inc.on_street}
                  </span>
                </Tooltip>
              </CircleMarker>
            </React.Fragment>
          );
        })}

        {/* ═══ INCIDENT ROUTES — only for active incidents in current city ═══ */}
        {/* Determine which incident IDs are already covered by consolidated routes */}
        {(() => {
          const consolidatedIncidentIds = new Set<string>();
          incidentRoutes.forEach(rp => {
            if ((rp as any).is_consolidated && (rp as any).incident_ids) {
              ((rp as any).incident_ids as string[]).forEach(id => consolidatedIncidentIds.add(id));
            }
          });
          return null;
        })()}
        
        {/* ═══ LAYER 1: ALL alternate routes (GREEN) — bottom layer ═══ */}
        {/* Only render routes with valid geometry (>=5 points = real road route) */}
        {(() => {
          // Build consolidated incident ID set
          const consolidatedIncidentIds = new Set<string>();
          incidentRoutes.forEach(rp => {
            if ((rp as any).is_consolidated && (rp as any).incident_ids) {
              ((rp as any).incident_ids as string[]).forEach(id => consolidatedIncidentIds.add(id));
            }
          });
          
          return incidentRoutes
            .filter(rp => {
              // Check if this is an active incident in current city
              const isActive = incidents.some(i => 
                i.id === rp.incidentId && i.city === city && i.status === 'active'
              );
              // For consolidated routes, check if any incident in the group is active
              if ((rp as any).is_consolidated && (rp as any).incident_ids) {
                const hasActiveIncident = ((rp as any).incident_ids as string[]).some(id =>
                  incidents.some(i => i.id === id && i.city === city && i.status === 'active')
                );
                return hasActiveIncident;
              }
              if (!isActive) return false;
              
              // For individual routes, skip if incident is in a consolidated group
              if (consolidatedIncidentIds.has(rp.incidentId)) return false;
              
              return true;
            })
            .map((routePair) =>
              routePair.alternate?.geometry?.coordinates && routePair.alternate.geometry.coordinates.length >= 5 && (
                <Polyline
                  key={`alt-${routePair.incidentId}`}
                  positions={routePair.alternate.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])}
                  pathOptions={{ 
                    color: (routePair as any).is_consolidated ? '#8b5cf6' : '#22c55e', 
                    weight: (routePair as any).is_consolidated ? 8 : 7, 
                    opacity: 0.95,
                    lineCap: 'round',
                    lineJoin: 'round',
                    className: (routePair as any).is_consolidated ? 'route-consolidated' : 'route-alternate',
                  }}
                >
                  <Tooltip sticky>
                    <span className="text-[10px] font-mono">
                      {(routePair as any).is_consolidated 
                        ? `🔗 Consolidated Route (${(routePair as any).incident_ids?.length || 0} incidents)`
                        : '🟢 Alternate Route'}
                      {routePair.alternate?.estimated_extra_minutes != null && ` • +${routePair.alternate.estimated_extra_minutes} min`}
                      {routePair.alternate?.avg_speed_kmh && ` • ${routePair.alternate.avg_speed_kmh} km/h avg`}
                    </span>
                  </Tooltip>
                </Polyline>
              )
            );
        })()}

        {/* ═══ LAYER 2: ALL blocked routes (RED) — top layer, always covers green ═══ */}
        {(() => {
          // Build consolidated incident ID set
          const consolidatedIncidentIds = new Set<string>();
          incidentRoutes.forEach(rp => {
            if ((rp as any).is_consolidated && (rp as any).incident_ids) {
              ((rp as any).incident_ids as string[]).forEach(id => consolidatedIncidentIds.add(id));
            }
          });
          
          return incidentRoutes
            .filter(rp => {
              // For consolidated routes, check if any incident in the group is active
              if ((rp as any).is_consolidated && (rp as any).incident_ids) {
                return ((rp as any).incident_ids as string[]).some(id =>
                  incidents.some(i => i.id === id && i.city === city && i.status === 'active')
                );
              }
              // Check if this is an active incident in current city
              const isActive = incidents.some(i => 
                i.id === rp.incidentId && i.city === city && i.status === 'active'
              );
              if (!isActive) return false;
              
              // For individual routes, skip if incident is in a consolidated group
              if (consolidatedIncidentIds.has(rp.incidentId)) return false;
              
              return true;
            })
            .map((routePair) =>
              routePair.blocked?.geometry?.coordinates && routePair.blocked.geometry.coordinates.length >= 5 && (
                <Polyline
                  key={`blk-${routePair.incidentId}`}
                  positions={routePair.blocked.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])}
                  pathOptions={{ 
                    color: '#ef4444', 
                    weight: 6, 
                    opacity: 0.75, 
                    dashArray: '15,10',
                    lineCap: 'round',
                    lineJoin: 'round',
                    className: 'route-blocked',
                  }}
                >
                  <Tooltip sticky>
                    <span className="text-[10px] font-mono">
                      🔴 Congested Route — {routePair.blocked?.street_names?.join(' → ') || 'Blocked road'}
                      {routePair.blocked?.total_length_km && ` • ${routePair.blocked.total_length_km} km`}
                    </span>
                  </Tooltip>
                </Polyline>
              )
            );
        })()}

        {/* ═══ CONSOLIDATED ROUTE INDICATOR ═══ */}
        {incidentRoutes
          .filter(rp => (rp as any).is_consolidated && (rp as any).group_center)
          .filter(rp => incidents.some(i => 
            (rp as any).incident_ids?.includes(i.id) && i.city === city && i.status === 'active'
          ))
          .map((rp) => (
            <CircleMarker
              key={`consolidated-${(rp as any).incident_ids?.join('-')}`}
              center={[(rp as any).group_center[1], (rp as any).group_center[0]]}
              radius={10}
              pathOptions={{
                color: '#8b5cf6',
                fillColor: '#8b5cf6',
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} permanent>
                <span className="text-[9px] font-mono font-bold">
                  🔗 {(rp as any).incident_ids?.length || 0} INCIDENTS GROUPED
                </span>
              </Tooltip>
            </CircleMarker>
          ))}

        {/* ═══ LAYER 3: ALL route markers — topmost, only show if alternate route has valid geometry ═══ */}
        {(() => {
          // Build consolidated incident ID set
          const consolidatedIncidentIds = new Set<string>();
          incidentRoutes.forEach(rp => {
            if ((rp as any).is_consolidated && (rp as any).incident_ids) {
              ((rp as any).incident_ids as string[]).forEach(id => consolidatedIncidentIds.add(id));
            }
          });
          
          return incidentRoutes
            .filter(rp => {
              // For consolidated routes, check if any incident in the group is active
              if ((rp as any).is_consolidated && (rp as any).incident_ids) {
                return ((rp as any).incident_ids as string[]).some(id =>
                  incidents.some(i => i.id === id && i.city === city && i.status === 'active')
                ) && rp.alternate?.geometry?.coordinates?.length >= 5;
              }
              // Check if this is an active incident in current city
              const isActive = incidents.some(i => 
                i.id === rp.incidentId && i.city === city && i.status === 'active'
              );
              if (!isActive) return false;
              
              // For individual routes, skip if incident is in a consolidated group
              if (consolidatedIncidentIds.has(rp.incidentId)) return false;
              
              return rp.alternate?.geometry?.coordinates?.length >= 5;
            })
            .map((routePair) => (
              <React.Fragment key={`markers-${routePair.incidentId}`}>
                {routePair.origin && (
                  <CircleMarker
                    center={[routePair.origin[1], routePair.origin[0]]}
                    radius={10}
                    pathOptions={{ 
                      color: (routePair as any).is_consolidated ? '#8b5cf6' : '#22c55e', 
                      fillColor: (routePair as any).is_consolidated ? '#8b5cf6' : '#22c55e', 
                      fillOpacity: 0.9, 
                      weight: 3,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -8]} permanent>
                      <span className="text-[9px] font-mono font-bold">↗ DIVERT HERE</span>
                    </Tooltip>
                  </CircleMarker>
                )}
                {routePair.destination && (
                  <CircleMarker
                    center={[routePair.destination[1], routePair.destination[0]]}
                    radius={10}
                    pathOptions={{ 
                      color: (routePair as any).is_consolidated ? '#8b5cf6' : '#22c55e', 
                      fillColor: (routePair as any).is_consolidated ? '#8b5cf6' : '#22c55e', 
                      fillOpacity: 0.9, 
                      weight: 3,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -8]} permanent>
                      <span className="text-[9px] font-mono font-bold">✓ REJOIN</span>
                    </Tooltip>
                  </CircleMarker>
                )}
              </React.Fragment>
            ));
        })()}

        {/* CONGESTION ZONE ROAD OVERLAYS */}
        {congestionZones
          .filter((z: any) => z.city === city)
          .map((zone: any) => (
            <React.Fragment key={`czone-${zone.zone_id}`}>
              {/* Render each segment as a thick colored polyline */}
              {zone.segment_geometries?.map((seg: any, idx: number) => (
                seg.geometry && seg.geometry.length >= 2 && (
                  <Polyline
                    key={`seg-${zone.zone_id}-${idx}`}
                    positions={seg.geometry.map((c: number[]) => [c[1], c[0]] as [number, number])}
                    pathOptions={{
                      color: zone.severity === 'severe' ? '#ef4444' : '#f59e0b',
                      weight: 12,
                      opacity: 0.7,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  >
                    <Tooltip sticky>
                      <span className="text-[10px] font-mono">
                        🚧 {seg.name || 'Road segment'} — {seg.speed?.toFixed(0) || '?'} mph
                      </span>
                    </Tooltip>
                  </Polyline>
                )
              ))}
              
              {/* Fallback: If no segment_geometries, show polygon outline only (not filled) */}
              {(!zone.segment_geometries || zone.segment_geometries.length === 0) && 
                zone.polygon && zone.polygon.length >= 4 && (
                <Polygon
                  positions={zone.polygon.map((c: number[]) => [c[1], c[0]] as [number, number])}
                  pathOptions={{
                    color: zone.severity === 'severe' ? '#ef4444' : '#f59e0b',
                    fillColor: 'transparent',
                    fillOpacity: 0,
                    weight: 3,
                    dashArray: '8,6',
                  }}
                >
                  <Tooltip sticky>
                    <span className="text-[10px] font-mono">
                      ⚠️ {zone.name} — {zone.severity} zone
                    </span>
                  </Tooltip>
                </Polygon>
              )}
            </React.Fragment>
          ))}

        {/* Collision markers removed — data used by LLM only, visual noise on map */}



        {/* Surveillance Cameras */}
        {BIG_INTERSECTIONS.map((cam) => (
          <CircleMarker
            key={`cam-${cam.id}`}
            center={[cam.lat, cam.lng]}
            radius={8}
            pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.9, weight: 2 }}
          >
            <CameraPopup cam={cam} />
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              <span className="text-[11px] font-mono font-bold text-[#0ea5e9]">
                📹 Camera: {cam.name}
              </span>
            </Tooltip>
          </CircleMarker>
        ))}

      </MapContainer>
    </div>
  );
};

export default TrafficMap;
