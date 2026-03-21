import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useFeedStore, useIncidentStore } from '../../store';
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

const NYC_CENTER: [number, number] = [30.7333, 76.7794]; // Updated to Chandigarh
const DEFAULT_ZOOM = 15;

const getSpeedColor = (speed: number): string => {
  if (speed < 5) return '#ef4444';  // red — blocked
  if (speed < 15) return '#eab308'; // yellow — slow
  return '#22c55e';                 // green — free flow
};

const MapController: React.FC<{ center: [number, number]; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
};

const TrafficMap: React.FC = () => {
  const { segments, cityCenter } = useFeedStore();
  const { currentIncident, diversionRoutes, collisions, setCollisions, congestionZones, congestionRoutes, blockedRoute, alternateRoute, incidentRouteOrigin, incidentRouteDest } = useIncidentStore();

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
        <MapController center={mapCenter} zoom={mapZoom} />

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
        />

        {/* Traffic Speed Segments */}
        {segments.map((seg) => (
          <CircleMarker
            key={seg.link_id}
            center={[seg.lat, seg.lng]}
            radius={seg.speed < 5 ? 8 : 6}
            pathOptions={{
              color: getSpeedColor(seg.speed),
              fillColor: getSpeedColor(seg.speed),
              fillOpacity: 0.85,
              weight: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={0.9}>
              <span className="text-[10px] font-mono">
                {seg.link_name} — {seg.speed.toFixed(0)} mph
              </span>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Incident Marker with pulsing effect */}
        {currentIncident && (
          <>
            <CircleMarker
              center={[currentIncident.location.lat, currentIncident.location.lng]}
              radius={14}
              pathOptions={{
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.2,
                weight: 1,
                className: 'animate-pulse',
              }}
            />
            <CircleMarker
              center={[currentIncident.location.lat, currentIncident.location.lng]}
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
                  INCIDENT: {currentIncident.on_street}
                </span>
              </Tooltip>
            </CircleMarker>
          </>
        )}

        {/* ═══ INCIDENT ROUTES — Auto-displayed on incident detection ═══ */}
        {/* Blocked Road (RED) — the road the incident is on */}
        {blockedRoute?.geometry?.coordinates && blockedRoute.geometry.coordinates.length >= 2 && (
          <Polyline
            positions={blockedRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])}
            pathOptions={{
              color: '#ef4444',
              weight: 7,
              opacity: 0.85,
            }}
          >
            <Tooltip sticky>
              <span className="text-[10px] font-mono font-bold">
                🔴 BLOCKED: {(blockedRoute.street_names || []).slice(0, 2).join(' → ') || 'Incident Road'}
                {blockedRoute.total_length_km ? ` — ${blockedRoute.total_length_km} km` : ''}
              </span>
            </Tooltip>
          </Polyline>
        )}

        {/* Alternate Route (GREEN) — the detour */}
        {alternateRoute?.geometry?.coordinates && alternateRoute.geometry.coordinates.length >= 2 && (
          <Polyline
            positions={alternateRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])}
            pathOptions={{
              color: '#22c55e',
              weight: 6,
              opacity: 0.9,
            }}
          >
            <Tooltip sticky>
              <span className="text-[10px] font-mono font-bold">
                🟢 ALTERNATE: {(alternateRoute.street_names || []).slice(0, 2).join(' → ') || 'Detour Route'}
                {alternateRoute.total_length_km ? ` — ${alternateRoute.total_length_km} km` : ''}
                {alternateRoute.estimated_extra_minutes ? ` (+${alternateRoute.estimated_extra_minutes} min)` : ''}
              </span>
            </Tooltip>
          </Polyline>
        )}

        {/* Origin marker (where drivers should diverge) */}
        {incidentRouteOrigin && (
          <CircleMarker
            center={[incidentRouteOrigin[1], incidentRouteOrigin[0]]}
            radius={8}
            pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent>
              <span className="text-[9px] font-mono font-bold">↗ DIVERT HERE</span>
            </Tooltip>
          </CircleMarker>
        )}

        {/* Destination marker */}
        {incidentRouteDest && (
          <CircleMarker
            center={[incidentRouteDest[1], incidentRouteDest[0]]}
            radius={8}
            pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent>
              <span className="text-[9px] font-mono font-bold">✓ REJOIN</span>
            </Tooltip>
          </CircleMarker>
        )}

        {/* Collision markers */}
        {collisions.map((c: any, idx: number) => {
          if (!c.latitude || !c.longitude) return null;
          return (
            <CircleMarker
              key={`collision-${idx}`}
              center={[parseFloat(c.latitude), parseFloat(c.longitude)]}
              radius={4}
              pathOptions={{
                color: '#f97316',
                fillColor: '#f97316',
                fillOpacity: 0.7,
                weight: 1,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                <span className="text-[10px] font-mono">
                  Crash: {c.on_street_name || 'Unknown'} ({c.number_of_persons_injured || 0} injured)
                </span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* Congestion Zone Markers — amber pulsing */}
        {congestionZones.map((zone: any) => {
          const lat = zone.location?.coordinates?.[1];
          const lng = zone.location?.coordinates?.[0];
          if (!lat || !lng) return null;
          return (
            <React.Fragment key={`congestion-zone-${zone.zone_id}`}>
              <CircleMarker
                center={[lat, lng]}
                radius={16}
                pathOptions={{
                  color: zone.severity === 'severe' ? '#ef4444' : '#f59e0b',
                  fillColor: zone.severity === 'severe' ? '#ef4444' : '#f59e0b',
                  fillOpacity: 0.15,
                  weight: 2,
                  className: 'animate-pulse',
                }}
              />
              <CircleMarker
                center={[lat, lng]}
                radius={7}
                pathOptions={{
                  color: zone.severity === 'severe' ? '#ef4444' : '#f59e0b',
                  fillColor: zone.severity === 'severe' ? '#ef4444' : '#f59e0b',
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95} permanent>
                  <span className="text-[9px] font-mono font-bold">
                    🚧 CONGESTION: {zone.primary_street}
                  </span>
                </Tooltip>
              </CircleMarker>
            </React.Fragment>
          );
        })}

        {/* Congestion Blocked Roads (YELLOW) */}
        {congestionZones.map((zone: any) => {
          const coords = zone.blocked_geometry?.coordinates;
          if (!coords || coords.length < 2) return null;
          return (
            <Polyline
              key={`cong-blocked-${zone.zone_id}`}
              positions={coords.map((c: number[]) => [c[1], c[0]] as [number, number])}
              pathOptions={{ color: '#f59e0b', weight: 6, opacity: 0.85 }}
            >
              <Tooltip sticky>
                <span className="text-[10px] font-mono font-bold">
                  🚧 CONGESTED: {zone.primary_street}
                </span>
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Congestion Alternate Route Polylines — amber/orange */}
        {congestionRoutes.map((route: any, idx: number) => {
          const coords = route.geometry?.coordinates;
          if (!coords || !Array.isArray(coords) || coords.length < 2) return null;
          const positions = coords.map((c: number[]) => [c[1], c[0]] as [number, number]);
          return (
            <Polyline
              key={`congestion-route-${idx}`}
              positions={positions}
              pathOptions={{
                color: '#f59e0b',
                weight: 5,
                opacity: 0.85,
                dashArray: '10 6',
              }}
            >
              <Tooltip sticky>
                <span className="text-[10px] font-mono font-bold">
                  🚧 ALT ROUTE: {route.name || `Route ${idx + 1}`}
                  {route.total_length_km ? ` — ${route.total_length_km} km` : ''}
                </span>
              </Tooltip>
            </Polyline>
          );
        })}

      </MapContainer>
    </div>
  );
};

export default TrafficMap;
