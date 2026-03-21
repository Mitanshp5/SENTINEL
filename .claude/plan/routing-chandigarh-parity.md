# Implementation Plan: A* Routing Fix + Streets Data + Chandigarh Injection (v2)

## Task Type
- [x] Backend (routing, congestion, data generation)
- [x] Frontend (map zoom fix)
- [x] Database (Chandigarh CSV + collision data)

---

## Problem Statement

1. **Congestion routing wrong**: Uses single-point center offset; should use segment bounding box to find true entry/exit of the congested road, and avoid ALL congested segment positions
2. **Too few street points**: NYC demo has 8 segments, API limit=1000 — A* has no alternate paths to find
3. **Map auto-zooms on incident**: `MapController` fires `map.setView()` on every re-render, not just city switch
4. **No Chandigarh data file**: No `chandigarh_link_speed.csv`, no synthetic collision data
5. **Chandigarh not fully on-par**: Missing collision data, limited road segments

---

## Implementation Steps

### AGENT 1 — Backend: Congestion Routing + NYC API Limit + Chandigarh segments

#### File: `backend/services/routing_service.py`

Add `compute_congestion_route_pair(congested_segments, city)` method:
```python
async def compute_congestion_route_pair(self, congested_segments: list[dict], city: str = "nyc") -> dict:
    lats = [s["lat"] for s in congested_segments if s.get("lat")]
    lngs = [s["lng"] for s in congested_segments if s.get("lng")]
    if not lats:
        return await self.compute_incident_route_pair(0, 0, city)
    
    min_lat, max_lat = min(lats), max(lats)
    min_lng, max_lng = min(lngs), max(lngs)
    center_lat = (min_lat + max_lat) / 2
    center_lng = (min_lng + max_lng) / 2
    lat_span = max_lat - min_lat
    lng_span = max_lng - min_lng
    
    offset = 0.007  # ~800m
    if lat_span >= lng_span:  # N-S road
        origin = (round(center_lng, 6), round(min_lat - offset, 6))
        destination = (round(center_lng, 6), round(max_lat + offset, 6))
    else:  # E-W road
        origin = (round(min_lng - offset, 6), round(center_lat, 6))
        destination = (round(max_lng + offset, 6), round(center_lat, 6))
    
    # Avoid ALL congested segment positions (not just center)
    avoid_coords = [(round(s["lng"], 6), round(s["lat"], 6)) for s in congested_segments if s.get("lng") and s.get("lat")]
    
    blocked_raw = await self.get_diversion_route(origin, destination, avoid_coords=None)
    blocked_info = self.extract_route_info(blocked_raw) if blocked_raw else {}
    
    alt_raw = await self.get_diversion_route(origin, destination, avoid_coords=avoid_coords)
    alt_info = self.extract_route_info(alt_raw) if alt_raw else {}
    
    fallback_blocked = {"type": "LineString", "coordinates": [list(origin), [center_lng, center_lat], list(destination)]}
    fallback_alt = {"type": "LineString", "coordinates": [list(origin), list(destination)]}
    
    return {
        "origin": list(origin),
        "destination": list(destination),
        "blocked": {
            "geometry": blocked_info.get("geometry", fallback_blocked),
            "total_length_km": blocked_info.get("total_distance_km", 0),
            "street_names": blocked_info.get("street_names", []),
        },
        "alternate": {
            "geometry": alt_info.get("geometry", fallback_alt),
            "total_length_km": alt_info.get("total_distance_km", 0),
            "estimated_extra_minutes": alt_info.get("total_duration_min", 0),
            "street_names": alt_info.get("street_names", []),
        },
    }
```

Also: Update `get_diversion_route` to accept multiple avoid_coords for congestion (already does via list, but the polygon generation needs to handle multiple points as separate polygons at 0.002 radius each).

#### File: `backend/app.py`

In `_on_congestion()`, replace:
```python
congestion_routes = await routing_service.compute_incident_route_pair(lng, lat, city=city)
```
With:
```python
congestion_routes = await routing_service.compute_congestion_route_pair(
    zone.get("segments", []), city=city
)
```

#### File: `backend/services/feed_simulator.py`

1. Change `$limit: 1000` → `$limit: 5000`
2. Expand NYC demo segments from 8 → 50 covering: Midtown, Hell's Kitchen, Chelsea, Hudson Yards, Times Square, Garment District, Penn Station area
3. Expand Chandigarh demo segments from 24 → 50 covering: all major chowks, Madhya Marg full length, Jan Marg, Dakshin Marg, Vidhya Path, all major sector roads
4. Add `_load_chandigarh_csv()` method that reads CSV in NYC schema format and convert `link_points` to lat/lng

---

### AGENT 2 — Database: Generate Chandigarh CSV + Collision Data

#### File: `backend/data/chandigarh_link_speed.csv` (NEW — generate via Python script)

Schema matches NYC DOT API i4gi-tjb9:
`id,speed,travel_time,status,data_as_of,link_id,link_name,link_points,encoded_poly_line,borough,owner,transcom_id`

Key columns:
- `link_points`: space-separated `lat,lng` pairs showing road direction (min 3 points each)
- `borough`: sector name (e.g., "Sector 17", "Sector 22", "Industrial Area")
- `data_as_of`: 20 timestamp rows per segment (5-min intervals)
- `speed`: realistic Chandigarh traffic (15–45 mph normal, drop to 2–8 in congestion frames)

Segments to cover (50+):
- Madhya Marg full length (Sector 1 to Sector 43) — 12 subsegments
- Jan Marg (Sector 3 to Sector 38) — 8 subsegments  
- Dakshin Marg — 6 subsegments
- Vidhya Path — 4 subsegments
- Himalaya Marg — 4 subsegments
- Purv Marg — 4 subsegments
- All major chowks (sector intersections) — 12 chowks

Generate using Python with `numpy` for realistic speed variation.

#### File: `backend/data/chandigarh_collisions.json` (NEW — synthetic)

Schema matches NYC h9gi-nx95:
```json
[
  {
    "crash_date": "2024-03-15T00:00:00.000",
    "crash_time": "08:30",
    "borough": "Sector 17",
    "zip_code": "160017",
    "latitude": "30.7412",
    "longitude": "76.7788",
    "location": {"type": "Point", "coordinates": [76.7788, 30.7412]},
    "on_street_name": "MADHYA MARG",
    "cross_street_name": "SECTOR 17 CHOWK",
    "number_of_persons_injured": 2,
    "number_of_persons_killed": 0,
    "contributing_factor_vehicle_1": "Driver Inattention/Distraction",
    "vehicle_type_code1": "Sedan"
  }
]
```
Generate 200+ synthetic collision records across major Chandigarh intersections.

#### File: `backend/services/collision_service.py`

Add Chandigarh support:
```python
async def get_nearby_collisions(self, lat: float, lng: float, radius_deg: float = 0.01, city: str = "nyc") -> list[dict]:
    if city == "chandigarh":
        return self._get_chandigarh_collisions(lat, lng, radius_deg)
    # ... existing NYC API call

def _get_chandigarh_collisions(self, lat: float, lng: float, radius_deg: float) -> list[dict]:
    data_file = Path(__file__).parent.parent / "data" / "chandigarh_collisions.json"
    if not data_file.exists():
        return []
    with open(data_file) as f:
        all_collisions = json.load(f)
    # Filter by proximity
    nearby = []
    for c in all_collisions:
        try:
            c_lat, c_lng = float(c["latitude"]), float(c["longitude"])
            if abs(c_lat - lat) <= radius_deg and abs(c_lng - lng) <= radius_deg:
                nearby.append(c)
        except (ValueError, KeyError):
            continue
    return nearby[:100]
```

Also update the `_on_incident` call in `app.py` to pass `city`:
```python
collisions_data = await collision_service.get_nearby_collisions(lat, lng, city=city)
```

---

### AGENT 3 — Frontend: Fix Map Auto-Zoom

#### File: `frontend/src/components/map/TrafficMap.tsx`

Replace `MapController` component:
```tsx
import { useRef } from 'react';

const MapController: React.FC<{ center: [number, number]; zoom: number; city: string }> = ({ center, zoom, city }) => {
  const map = useMap();
  const prevCityRef = useRef<string>('');
  const mountedRef = useRef<boolean>(false);

  useEffect(() => {
    // Only setView on initial mount OR city change — never on incident/feed updates
    if (!mountedRef.current || prevCityRef.current !== city) {
      map.setView(center, zoom);
      prevCityRef.current = city;
      mountedRef.current = true;
    }
  }, [city]); // intentionally NOT in deps: center, zoom
  return null;
};
```

Also update the useFeedStore destructure to get `activeCity`:
```tsx
const { segments, cityCenter, activeCity } = useFeedStore();
```

And pass city to MapController:
```tsx
<MapController center={mapCenter} zoom={mapZoom} city={activeCity || 'nyc'} />
```

Check store/index.ts to confirm `activeCity` field exists (add if missing).

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `backend/services/routing_service.py` | Modify | Add `compute_congestion_route_pair()` |
| `backend/app.py` | Modify | Use new congestion routing method |
| `backend/services/feed_simulator.py` | Modify | Increase limit, expand demo segments, Chandigarh CSV reader |
| `backend/services/collision_service.py` | Modify | Add Chandigarh collision support |
| `backend/data/chandigarh_link_speed.csv` | Create | 50+ segments × 20 timestamps, NYC schema |
| `backend/data/chandigarh_collisions.json` | Create | 200+ synthetic Chandigarh collision records |
| `frontend/src/components/map/TrafficMap.tsx` | Modify | Fix MapController zoom logic |
| `frontend/src/store/index.ts` | Modify | Add `activeCity` to feedStore if missing |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| ORS may return same route for congestion (small area) | Use 0.003° radius per segment polygon, ensure avoid_coords covers wide area |
| CSV generation may be slow for large data | Pre-generate offline, commit to repo |
| Chandigarh ORS routing — some roads might not be in ORS database | Use fallback mock_route gracefully |
| `activeCity` may not exist in feedStore | Add it to the store, set from `feed_update` WS message |
