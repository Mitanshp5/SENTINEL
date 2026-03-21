import React, { useEffect, useMemo } from 'react';
import Map, { Source, Layer, Marker, useMap } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useFeedStore, useIncidentStore } from '../../store';

const FALLBACK_CENTER: [number, number] = [76.7794, 30.7333]; // [lng, lat] for Chandigarh
const DEFAULT_ZOOM = 15;

const MapController: React.FC = () => {
  const { cityCenter } = useFeedStore();
  const { current: map } = useMap();

  useEffect(() => {
    if (map && cityCenter) {
      map.flyTo({
        center: [cityCenter.lng, cityCenter.lat],
        zoom: cityCenter.zoom || DEFAULT_ZOOM,
        duration: 1500
      });
    }
  }, [cityCenter, map]);

  return null;
};

const TrafficMap: React.FC = () => {
  const { segments, cityCenter } = useFeedStore();
  const { incidents, diversionRoutes } = useIncidentStore();

  // Build GeoJSON for segments
  const segmentGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: segments.map(seg => ({
      type: 'Feature' as const,
      properties: { speed: seg.speed },
      geometry: { type: 'Point' as const, coordinates: [seg.lng, seg.lat] }
    }))
  }), [segments]);

  // Build GeoJSON for diversion routes
  const diversionGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: diversionRoutes
      .filter((route: any) => route.geometry?.coordinates?.length > 0)
      .map((route: any, idx: number) => ({
        type: 'Feature' as const,
        properties: { idx },
        geometry: route.geometry
      }))
  }), [diversionRoutes]);

  return (
    <div className="w-full h-full relative">
      <Map
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
        initialViewState={{
          longitude: cityCenter?.lng || FALLBACK_CENTER[0],
          latitude: cityCenter?.lat || FALLBACK_CENTER[1],
          zoom: cityCenter?.zoom || DEFAULT_ZOOM
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/light-v11"
      >
        <MapController />

        {/* Traffic Speed Segments */}
        <Source id="segments" type="geojson" data={segmentGeoJSON}>
          <Layer id="speed-circles" type="circle"
            paint={{
              'circle-radius': ['interpolate', ['linear'], ['get', 'speed'],
                0, 8, 10, 6, 20, 4
              ],
              'circle-color': ['interpolate', ['linear'], ['get', 'speed'],
                0, '#FF5A5F', 10, '#FF5A5F', 20, '#a1a1aa', 30, '#3f3f46'
              ],
              'circle-opacity': 0.85,
            }}
          />
        </Source>

        {/* Diversion Routes */}
        <Source id="diversions" type="geojson" data={diversionGeoJSON}>
          <Layer id="diversion-lines" type="line"
            paint={{
              'line-color': '#1A1A1A',
              'line-width': 3,
              'line-opacity': 0.8,
              'line-dasharray': [2, 1],
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>

        {/* Incident Markers */}
        {incidents.map((inc: any) => {
          const lat = inc.location?.lat ?? inc.location?.coordinates?.[1] ?? 0;
          const lng = inc.location?.lng ?? inc.location?.coordinates?.[0] ?? 0;
          return (
            <Marker key={inc.id || inc._id} longitude={lng} latitude={lat}>
              <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-white shadow-lg" />
            </Marker>
          );
        })}
      </Map>
    </div>
  );
};

export default TrafficMap;
