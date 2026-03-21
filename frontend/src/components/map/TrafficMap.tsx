import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useFeedStore, useIncidentStore } from '../../store';

// Fix for default Leaflet icon paths in Vite
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const NYC_CENTER: [number, number] = [40.7128, -74.0060];
const CHANDIGARH_CENTER: [number, number] = [30.7333, 76.7794];

// Component to handle map re-centering when city changes
const MapController = ({ city }: { city: 'nyc' | 'chandigarh' }) => {
  const map = useMap();
  useEffect(() => {
    const center = city === 'nyc' ? NYC_CENTER : CHANDIGARH_CENTER;
    map.setView(center, 13, { animate: true });
  }, [city, map]);
  return null;
};

const TrafficMap: React.FC = () => {
  const { city, segments } = useFeedStore();
  const { currentIncident } = useIncidentStore();

  const getSpeedColor = (speed: number) => {
    if (speed < 10) return '#ef4444'; // Red
    if (speed < 20) return '#eab308'; // Yellow
    return '#22c55e'; // Green
  };

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={city === 'nyc' ? NYC_CENTER : CHANDIGARH_CENTER}
        zoom={13}
        className="w-full h-full"
        zoomControl={false}
      >
        {/* Dark Mode Map Tiles */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        <MapController city={city} />

        {/* Traffic Speed Layer */}
        {segments.map((segment) => (
          <Polyline
            key={segment.link_id}
            positions={[[segment.lat, segment.lng], [segment.lat + 0.005, segment.lng + 0.005]]} // Simple mock segment
            pathOptions={{
              color: getSpeedColor(segment.speed),
              weight: 4,
              opacity: 0.8
            }}
          />
        ))}

        {/* Incident Marker */}
        {currentIncident && (
          <Marker position={[currentIncident.location.lat, currentIncident.location.lat]}>
            {/* Custom Pulsing Marker would go here */}
          </Marker>
        )}
        
        <div className="leaflet-vignette" />
      </MapContainer>
    </div>
  );
};

export default TrafficMap;
