# Implementation Plan: Leaflet → Mapbox GL JS Migration

## Problem Statement

Replace entire Leaflet/react-leaflet map system with Mapbox GL JS using react-map-gl. Keep all existing logic, state management, WebSocket handling, and Zustand stores intact.

## Task Type
- [x] Frontend (→ Primary focus)
- [ ] Backend (No changes needed)
- [x] Fullstack (Two apps: frontend + user-app)

---

## Technical Solution

### Migration Strategy

**Phase 1:** Package management - Remove Leaflet, install Mapbox GL JS
**Phase 2:** Environment setup - Add Mapbox token
**Phase 3:** Migrate frontend TrafficMap.tsx (main dashboard)
**Phase 4:** Migrate frontend CameraPopup.tsx (popup component)
**Phase 5:** Migrate user-app TrafficMap.tsx (citizen app)
**Phase 6:** Update CSS files - Remove Leaflet styles, add Mapbox styles
**Phase 7:** Delete any Leaflet-only files
**Phase 8:** Build and test

### Component Mapping (Leaflet → Mapbox GL JS)

| Leaflet Component | Mapbox GL JS Equivalent |
|-------------------|------------------------|
| `MapContainer` | `<Map>` from react-map-gl |
| `TileLayer` | `mapStyle` prop on Map |
| `Circle` | `<Source>` + `<Layer type="circle">` |
| `CircleMarker` | `<Marker>` with custom div |
| `Polyline` | `<Source>` + `<Layer type="line">` |
| `Polygon` | `<Source>` + `<Layer type="fill">` |
| `Tooltip` | Custom popup or HTML overlay |
| `Popup` | `<Popup>` from react-map-gl |
| `useMap()` | `useMap()` from react-map-gl |
| L.Marker.prototype.options | Not needed |

### Coordinate System Change

**Leaflet:** `[lat, lng]` format
**Mapbox:** `[lng, lat]` format (GeoJSON standard)

This is actually **simpler** - ORS returns `[lng, lat]` so NO conversion needed!

---

## Implementation Steps

### Step 1: Package Management (frontend)
```bash
cd frontend
npm uninstall leaflet react-leaflet @types/leaflet
npm install mapbox-gl react-map-gl
npm install -D @types/mapbox-gl
```

### Step 2: Package Management (user-app)
```bash
cd user-app
npm uninstall leaflet react-leaflet @types/leaflet
npm install mapbox-gl react-map-gl
npm install -D @types/mapbox-gl
```

### Step 3: Environment Variables
Add to `frontend/.env` and `user-app/.env`:
```
VITE_MAPBOX_TOKEN=your_mapbox_public_token
```

### Step 4: Migrate frontend/src/components/map/TrafficMap.tsx

**Remove:**
- Lines 2-3: Leaflet imports
- Lines 8-17: Marker icon setup (not needed in Mapbox)
- Lines 31-47: MapController component (use Mapbox's built-in controls)

**New imports:**
```tsx
import Map, { Source, Layer, Marker, Popup, useMap } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
```

**New Map component structure:**
```tsx
<Map
  mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
  initialViewState={{
    longitude: cityCenter?.lng || -74.0060,
    latitude: cityCenter?.lat || 40.7128,
    zoom: cityCenter?.zoom || 15
  }}
  style={{ width: '100%', height: '100%' }}
  mapStyle="mapbox://styles/mapbox/dark-v11"
>
  {/* Layers go here */}
</Map>
```

**Incident gradient zones → Mapbox circles:**
```tsx
{/* Build GeoJSON for all incidents */}
const incidentGeoJSON = {
  type: 'FeatureCollection',
  features: incidents
    .filter(inc => inc.status === 'active' && inc.city === city)
    .flatMap(inc => {
      const radius = SEVERITY_RADIUS[inc.severity] || 330;
      return [
        // Outer glow (yellow)
        { type: 'Feature', properties: { layer: 'outer', severity: inc.severity }, 
          geometry: { type: 'Point', coordinates: [inc.location.lng, inc.location.lat] } },
        // Middle (amber)
        { type: 'Feature', properties: { layer: 'middle', severity: inc.severity },
          geometry: { type: 'Point', coordinates: [inc.location.lng, inc.location.lat] } },
        // Inner (red)
        { type: 'Feature', properties: { layer: 'inner', severity: inc.severity },
          geometry: { type: 'Point', coordinates: [inc.location.lng, inc.location.lat] } },
      ];
    })
};

<Source id="incidents" type="geojson" data={incidentGeoJSON}>
  <Layer id="incident-outer" type="circle" filter={['==', ['get', 'layer'], 'outer']}
    paint={{
      'circle-radius': ['*', ['get', 'radius'], 1],
      'circle-color': '#fbbf24',
      'circle-opacity': 0.15,
    }}
  />
  <Layer id="incident-middle" type="circle" filter={['==', ['get', 'layer'], 'middle']}
    paint={{
      'circle-radius': ['*', ['get', 'radius'], 0.5],
      'circle-color': '#f59e0b',
      'circle-opacity': 0.35,
    }}
  />
  <Layer id="incident-inner" type="circle" filter={['==', ['get', 'layer'], 'inner']}
    paint={{
      'circle-radius': ['*', ['get', 'radius'], 0.25],
      'circle-color': '#ef4444',
      'circle-opacity': 0.7,
    }}
  />
</Source>
```

**Routes → Mapbox line layers:**
```tsx
// Build GeoJSON from incidentRoutes
const routeGeoJSON = {
  type: 'FeatureCollection',
  features: incidentRoutes
    .filter(rp => incidents.some(i => i.id === rp.incidentId && i.city === city && i.status === 'active'))
    .flatMap(rp => [
      // Blocked route (red dashed)
      rp.blocked?.geometry?.coordinates?.length >= 5 && {
        type: 'Feature',
        properties: { type: 'blocked', incidentId: rp.incidentId },
        geometry: rp.blocked.geometry
      },
      // Alternate route (green solid)
      rp.alternate?.geometry?.coordinates?.length >= 5 && {
        type: 'Feature',
        properties: { type: 'alternate', incidentId: rp.incidentId },
        geometry: rp.alternate.geometry
      },
    ].filter(Boolean))
};

<Source id="routes" type="geojson" data={routeGeoJSON}>
  <Layer id="blocked-routes" type="line" filter={['==', ['get', 'type'], 'blocked']}
    paint={{
      'line-color': '#ef4444',
      'line-width': 6,
      'line-opacity': 0.75,
      'line-dasharray': [2, 1],
    }}
  />
  <Layer id="alternate-routes" type="line" filter={['==', ['get', 'type'], 'alternate']}
    paint={{
      'line-color': '#22c55e',
      'line-width': 7,
      'line-opacity': 0.95,
    }}
  />
</Source>
```

**Congestion zones → Mapbox line layers:**
```tsx
const congestionGeoJSON = {
  type: 'FeatureCollection',
  features: congestionZones
    .filter(z => z.city === city)
    .flatMap(zone => 
      zone.segment_geometries?.map((seg, idx) => ({
        type: 'Feature',
        properties: { severity: zone.severity, name: seg.name, speed: seg.speed },
        geometry: { type: 'LineString', coordinates: seg.geometry }
      })) || []
    )
};

<Source id="congestion" type="geojson" data={congestionGeoJSON}>
  <Layer id="congestion-lines" type="line"
    paint={{
      'line-color': ['case',
        ['==', ['get', 'severity'], 'severe'], '#ef4444',
        '#f59e0b'
      ],
      'line-width': 12,
      'line-opacity': 0.7,
      'line-cap': 'round',
      'line-join': 'round',
    }}
  />
</Source>
```

**Incident markers → Mapbox Markers:**
```tsx
{incidents.filter(inc => inc.status === 'active' && inc.city === city).map(inc => (
  <Marker key={inc.id} longitude={inc.location.lng} latitude={inc.location.lat}>
    <div className="relative">
      <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-white shadow-lg" />
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 px-2 py-1 rounded text-[10px] font-mono text-white">
        ⚠️ {inc.severity.toUpperCase()}: {inc.on_street}
      </div>
    </div>
  </Marker>
))}
```

**Camera markers → Mapbox Markers with Popup:**
```tsx
{BIG_INTERSECTIONS.filter(cam => 
  (city === 'nyc' && cam.lat > 40) || (city === 'chandigarh' && cam.lat < 35)
).map(cam => (
  <Marker key={cam.id} longitude={cam.lng} latitude={cam.lat}>
    <div className="w-4 h-4 rounded-full bg-blue-500/70 border border-white cursor-pointer" />
  </Marker>
))}
```

**City toggle → useMap hook:**
```tsx
const MapController = ({ city, cityCenter }) => {
  const { current: mapRef } = useMap();
  
  useEffect(() => {
    if (mapRef && cityCenter) {
      mapRef.flyTo({
        center: [cityCenter.lng, cityCenter.lat],
        zoom: cityCenter.zoom || 15,
        duration: 1500
      });
    }
  }, [city]);
  
  return null;
};
```

### Step 5: Migrate frontend/src/components/map/CameraPopup.tsx

**Change:**
```tsx
import { Popup } from 'react-map-gl';
```

The Popup API is similar - just update props:
```tsx
<Popup
  longitude={cam.lng}
  latitude={cam.lat}
  anchor="bottom"
  closeOnClick={false}
  onClose={() => setShowPopup(false)}
>
  {/* Same content */}
</Popup>
```

### Step 6: Migrate user-app/src/components/map/TrafficMap.tsx

Similar changes but with light theme:
```tsx
mapStyle="mapbox://styles/mapbox/light-v11"
```

Traffic speed segments as circles:
```tsx
const segmentGeoJSON = {
  type: 'FeatureCollection',
  features: segments.map(seg => ({
    type: 'Feature',
    properties: { speed: seg.speed },
    geometry: { type: 'Point', coordinates: [seg.lng, seg.lat] }
  }))
};

<Source id="segments" type="geojson" data={segmentGeoJSON}>
  <Layer id="speed-circles" type="circle"
    paint={{
      'circle-radius': 6,
      'circle-color': ['interpolate', ['linear'], ['get', 'speed'],
        0, '#ef4444',   // Red for stopped
        10, '#f59e0b',  // Amber for slow
        20, '#22c55e',  // Green for normal
        40, '#3f3f46'   // Gray for fast
      ],
      'circle-opacity': 0.85,
    }}
  />
</Source>
```

### Step 7: Update CSS Files

**frontend/src/index.css** - Remove lines 78-115 (Leaflet CSS), add:
```css
/* Mapbox GL dark theme adjustments */
.mapboxgl-map {
  font-family: inherit;
}
.mapboxgl-ctrl-attrib {
  display: none !important;
}
```

**user-app/src/index.css** - Remove lines 70-77 (Leaflet CSS), add:
```css
/* Mapbox GL light theme adjustments */
.mapboxgl-map {
  font-family: inherit;
}
.mapboxgl-ctrl-attrib {
  display: none !important;
}
```

### Step 8: Remove Leaflet CSS imports

Remove from both index.css files:
```css
@import "leaflet/dist/leaflet.css";
```

Add Mapbox CSS import in components or index.css:
```css
@import 'mapbox-gl/dist/mapbox-gl.css';
```

Or import in component:
```tsx
import 'mapbox-gl/dist/mapbox-gl.css';
```

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| frontend/package.json | Modify | Remove leaflet deps, add mapbox-gl |
| user-app/package.json | Modify | Remove leaflet deps, add mapbox-gl |
| frontend/.env | Create/Modify | Add VITE_MAPBOX_TOKEN |
| user-app/.env | Create/Modify | Add VITE_MAPBOX_TOKEN |
| frontend/src/components/map/TrafficMap.tsx | Rewrite | Full Mapbox migration |
| frontend/src/components/map/CameraPopup.tsx | Modify | Change Popup import |
| user-app/src/components/map/TrafficMap.tsx | Rewrite | Full Mapbox migration |
| frontend/src/index.css | Modify | Remove Leaflet CSS, add Mapbox CSS |
| user-app/src/index.css | Modify | Remove Leaflet CSS, add Mapbox CSS |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Mapbox token exposure | Token is public (client-side), use URL restrictions in Mapbox dashboard |
| Circle radius units differ | Mapbox uses pixels, need to convert meters→pixels based on zoom |
| GeoJSON coordinate order | ORS already returns [lng, lat], actually simplifies code |
| Popup positioning differences | Test and adjust anchor/offset values |
| Performance with many features | Use Mapbox's built-in clustering for large datasets |
| Build size increase | Mapbox GL is larger but offers better performance |

---

## Mapbox-Specific Advantages

1. **Vector tiles**: Smoother zoom, better performance
2. **Native GeoJSON**: ORS responses plug directly into Source
3. **Expression-based styling**: Dynamic colors without multiple layers
4. **3D support**: Future capability for terrain/buildings
5. **Better label rendering**: Street names included by default
6. **flyTo animation**: Built-in smooth city transitions

---

## Testing Checklist

- [ ] Map loads with correct center (NYC/Chandigarh)
- [ ] City toggle animates smoothly
- [ ] Incident gradient zones render correctly
- [ ] Routes display (green alternate, red blocked)
- [ ] Congestion overlays show on roads
- [ ] Incident markers with labels
- [ ] Camera markers clickable
- [ ] Camera popup opens/closes
- [ ] User-app light theme works
- [ ] Traffic speed colors interpolate
- [ ] WebSocket updates reflect on map
- [ ] No Leaflet imports remain in codebase

---

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A (manual analysis)
- GEMINI_SESSION: N/A (manual analysis)

---

## Dependencies Summary

**Remove:**
- leaflet: ^1.9.4
- react-leaflet: ^5.0.0
- @types/leaflet: ^1.9.21

**Install:**
- mapbox-gl: ^3.x
- react-map-gl: ^7.x
- @types/mapbox-gl: ^3.x

**Environment:**
- VITE_MAPBOX_TOKEN: Required (get from mapbox.com)
