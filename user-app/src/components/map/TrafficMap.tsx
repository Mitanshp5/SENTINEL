import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useFeedStore, useIncidentStore } from '../../store';

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const FALLBACK_CENTER: [number, number] = [30.7333, 76.7794]; // Updated to Chandigarh
const DEFAULT_ZOOM = 15;

const getSpeedColorAndWeight = (speed: number) => {
  if (speed < 10) return { color: '#FF5A5F', weight: 4 }; // Red for stopped/critical
  if (speed < 20) return { color: '#a1a1aa', weight: 3 }; // Light gray for slow
  return { color: '#3f3f46', weight: 2 }; // Dark gray for normal
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
  const { currentIncident, diversionRoutes } = useIncidentStore();

  const mapCenter: [number, number] = cityCenter
    ? [cityCenter.lat, cityCenter.lng]
    : FALLBACK_CENTER;
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
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
        />

        {/* Traffic Speed Segments (using points for dynamic live feed) */}
        {segments.map((segment) => {
          const style = getSpeedColorAndWeight(segment.speed);
          return (
            <CircleMarker
              key={segment.link_id}
              center={[segment.lat, segment.lng]}
              radius={style.weight * 2}
              pathOptions={{
                color: style.color,
                fillColor: style.color,
                fillOpacity: 0.85,
                weight: 1,
              }}
            />
          );
        })}

        {/* Dynamic Diversion Routes */}
        {diversionRoutes.map((route: any, idx: number) => {
          const coords = route.geometry?.coordinates;
          if (!coords || !Array.isArray(coords)) return null;
          const positions = coords.map((c: number[]) => [c[1], c[0]] as [number, number]);
          return (
            <Polyline
              key={`diversion-${idx}`}
              positions={positions}
              pathOptions={{
                color: '#1A1A1A',
                weight: 3,
                opacity: 0.8,
                dashArray: '5, 5',
              }}
            />
          );
        })}

        {/* Dynamic Incident Marker Minimal */}
        {currentIncident && (
          <CircleMarker
            center={[currentIncident.location.lat, currentIncident.location.lng]}
            radius={6}
            pathOptions={{
              color: '#FF5A5F',
              fillColor: '#FF5A5F',
              fillOpacity: 1,
              weight: 2,
            }}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default TrafficMap;
