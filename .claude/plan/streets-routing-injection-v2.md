# Plan: A* Routing + Hundreds of Streets + Chandigarh Injection

## Root Cause Analysis

### Issue 1: A* / ORS gives poor alternate route
- **Root cause**: `avoid_polygons` = multiple tiny 200m squares per segment point.
  For a congested road spanning many coords, ORS just avoids tiny patches and still
  routes through the same road corridor.
- **Fix**:
  1. Build ONE large corridor polygon covering the entire congested zone bounding box
     (min_lng-0.003 to max_lng+0.003, min_lat-0.003 to max_lat+0.003)
  2. ADDITIONALLY: add a forced waypoint perpendicular to the congested road
     - N-S road (lat_span > lng_span): waypoint at (center_lng ± 0.012, center_lat)
     - E-W road: waypoint at (center_lng, center_lat ± 0.012)
  3. ORS request: coordinates = [origin, WAYPOINT, destination] + avoid_polygons = corridor
  This forces ORS A* to find the shortest path that goes around the corridor via a 
  parallel street.

### Issue 2: Only 5-6 NYC streets visible
- **Root cause**: `_fetch_nyc_live()` groups records by `data_as_of` timestamp.
  With $limit=5000 spread across 10 timestamps → each frame has ~500 records but
  when demo falls back to generated data there are only 50 segments.
  Bigger problem: if API call fails, falls back to 50-segment demo data.
- **Fix**:
  1. Change `_fetch_nyc_live()` to take **LATEST record per unique link_id**
     instead of grouping by timestamp → 1 large frame with ALL unique road segments
  2. Create 10 replay frames by adding slight speed noise to the base frame
  3. Expand demo fallback to 150+ NYC segments (add blocks along every avenue)

### Issue 3: No Chandigarh incident injection
- **Root cause**: `demo.py` only has `NYC_DEMO_STREETS`; `DemoControls.tsx` 
  hardcodes the NYC street list.
- **Fix**:
  1. Add `CHD_DEMO_STREETS` dict to `demo.py` with 15+ Chandigarh intersections
  2. Update `list_demo_streets` to accept `?city=nyc|chandigarh`
  3. Update `inject_incident` to look up from correct city streets dict
  4. Update `DemoControls.tsx` to use active city from store + fetch streets dynamically

### Issue 4: Too few Chandigarh streets (50 → need 150+)
- **Root cause**: CSV only has 50 segments generated in v1
- **Fix**: Regenerate `chandigarh_link_speed.csv` with 150+ segments:
  - Madhya Marg: 1 point every 300m along full 10km length = ~33 points
  - Jan Marg: 1 point every 300m = ~20 points
  - Dakshin Marg: ~15 points
  - Vidhya Path, Himalaya Marg, Purv Marg: ~10 each
  - All major sector dividing roads: ~50 additional points
  - Total: 150+ unique segment points

---

## AGENT 1 — Backend: routing_service.py

### `get_diversion_route()` — add waypoint support

Change signature to accept optional waypoint:
```python
async def get_diversion_route(
    self,
    origin: tuple[float, float],
    destination: tuple[float, float],
    avoid_coords: Optional[list[tuple[float, float]]] = None,
    waypoint: Optional[tuple[float, float]] = None,  # NEW
) -> Optional[dict]:
```

Update body construction:
```python
# If waypoint given, insert between origin and destination
coords = [list(origin)]
if waypoint:
    coords.append(list(waypoint))
coords.append(list(destination))
body = {"coordinates": coords, ...}
```

Update cache key to include waypoint:
```python
cache_key = f"{origin}_{destination}_{bool(avoid_coords)}_{waypoint}"
```

### `compute_congestion_route_pair()` — use corridor polygon + waypoint

Replace the current simple point-polygon approach:

```python
# 1. Determine orientation
if lat_span >= lng_span:  # N-S road
    # Waypoint on a parallel street to the right (~1.2km)
    waypoint = (round(center_lng + 0.012, 6), round(center_lat, 6))
    # Corridor polygon covers entire N-S extent
    corridor = self._bounding_polygon(
        min_lng - 0.003, min_lat - 0.003,
        max_lng + 0.003, max_lat + 0.003
    )
else:  # E-W road
    # Waypoint on a parallel street above (~1.2km)
    waypoint = (round(center_lng, 6), round(center_lat + 0.012, 6))
    corridor = self._bounding_polygon(
        min_lng - 0.003, min_lat - 0.003,
        max_lng + 0.003, max_lat + 0.003
    )

# Blocked: direct, no avoidance, no waypoint
blocked_raw = await self.get_diversion_route(origin, destination)

# Alternate: corridor avoidance + forced waypoint
alt_raw = await self.get_diversion_route(
    origin, destination,
    avoid_coords=None,     # use corridor polygon instead of per-point polygons
    waypoint=waypoint,
    avoid_polygon=corridor  # NEW param
)
```

Add `_bounding_polygon(min_lng, min_lat, max_lng, max_lat)` helper.
Add `avoid_polygon` param to `get_diversion_route()` for pre-built polygon.

### Also update `compute_incident_route_pair()` for incidents

For a point incident, the corridor is still the same diagonal bounding box.
Add waypoint perpendicular to the typical road direction:
- NYC: typically E-W streets → waypoint offset in lat
- Chandigarh: mix of N-S and E-W → use default perpendicular

---

## AGENT 2 — Backend: feed_simulator.py + demo.py

### `feed_simulator.py` — latest-per-link_id approach

Replace the timestamp-grouping in `_fetch_nyc_live()`:

```python
# OLD: group by timestamp → many small frames
# NEW: take latest per link_id → 1 large frame + noisy replays

latest_by_link: dict[str, dict] = {}
for rec in records:
    link_id = rec.get("link_id", "")
    if not link_id:
        continue
    existing = latest_by_link.get(link_id)
    if not existing or str(rec.get("data_as_of","")) > str(existing.get("data_as_of","")):
        latest_by_link[link_id] = rec

# Parse all unique segments
base_frame = []
for rec in latest_by_link.values():
    speed = float(rec.get("speed", 0) or 0)
    lat, lng = self._parse_link_points(rec.get("link_points", ""))
    if lat == 0 and lng == 0:
        continue
    base_frame.append({
        "link_id": str(rec.get("link_id", "")),
        "link_name": str(rec.get("link_name", "Unknown")),
        "speed": round(speed, 1),
        "travel_time": round(float(rec.get("travel_time", 0) or 0), 2),
        "status": "BLOCKED" if speed < 2 else "SLOW" if speed < 15 else "OK",
        "lat": lat, "lng": lng,
    })

if not base_frame:
    return []

# Create 12 replay frames with slight speed variation
import numpy as np
frames = []
for i in range(12):
    frame = []
    for seg in base_frame:
        noise = np.random.uniform(-2.5, 2.5)
        spd = max(0, round(seg["speed"] + noise, 1))
        frame.append({**seg, "speed": spd, "status": "BLOCKED" if spd < 2 else "SLOW" if spd < 15 else "OK"})
    frames.append(frame)
    
logger.info(f"Built {len(base_frame)} unique NYC segments → {len(frames)} replay frames")
return frames
```

Apply same approach to `_load_chandigarh_csv()`.

Also expand NYC fallback demo to 150+ segments.

### `demo.py` — Chandigarh streets + city-aware injection

Add `CHD_DEMO_STREETS`:
```python
CHD_DEMO_STREETS: dict[str, dict] = {
    "Madhya Marg & Sector 17 Chowk": {"lat": 30.7412, "lng": 76.7788, "cross": "Sector 17"},
    "Madhya Marg & Sector 22 Chowk": {"lat": 30.7320, "lng": 76.7780, "cross": "Sector 22"},
    "Madhya Marg & Aroma Light":     {"lat": 30.7315, "lng": 76.7845, "cross": "Aroma"},
    "Jan Marg & IT Park Chowk":      {"lat": 30.7270, "lng": 76.8010, "cross": "IT Park"},
    "Dakshin Marg & Transport Chowk":{"lat": 30.7212, "lng": 76.8040, "cross": "Transport"},
    "Himalaya Marg & Piccadily":     {"lat": 30.7246, "lng": 76.7621, "cross": "Piccadily"},
    "Vidhya Path & Sector 15":       {"lat": 30.7516, "lng": 76.7738, "cross": "Sector 15"},
    "Purv Marg & Housing Board":     {"lat": 30.7135, "lng": 76.8202, "cross": "Housing Board"},
    "Sector 43 ISBT Road":           {"lat": 30.7226, "lng": 76.7511, "cross": "ISBT"},
    "Madhya Marg & PGI Chowk":       {"lat": 30.7646, "lng": 76.7760, "cross": "PGI"},
    "Jan Marg & Sector 9":           {"lat": 30.7554, "lng": 76.7875, "cross": "Sector 9"},
    "Tribune Chowk Road":            {"lat": 30.7270, "lng": 76.7675, "cross": "Tribune"},
    "Rock Garden Road":              {"lat": 30.7523, "lng": 76.8078, "cross": "Rock Garden"},
    "Elante Mall Road":              {"lat": 30.7061, "lng": 76.8016, "cross": "Elante"},
    "Sector 32-33 Connector":        {"lat": 30.7148, "lng": 76.7700, "cross": "Sector 33"},
}
```

Update `inject_incident` endpoint:
```python
# Resolve from city-specific dict
CITY_STREETS = {"nyc": NYC_DEMO_STREETS, "chandigarh": CHD_DEMO_STREETS}
city_streets = CITY_STREETS.get(body.city, NYC_DEMO_STREETS)
street_data = city_streets.get(body.street_name, {})
```

Update `list_demo_streets`:
```python
@router.get("/streets")
async def list_demo_streets(city: str = "nyc"):
    CITY_STREETS = {"nyc": NYC_DEMO_STREETS, "chandigarh": CHD_DEMO_STREETS}
    streets = CITY_STREETS.get(city, NYC_DEMO_STREETS)
    return {"streets": [{"name": k, "lat": v["lat"], "lng": v["lng"]} for k, v in streets.items()]}
```

---

## AGENT 3 — Frontend: DemoControls.tsx

Update to be city-aware:

```tsx
import { useFeedStore } from '../../store';

const DemoControls: React.FC = () => {
  const { city } = useFeedStore();
  const [streets, setStreets] = useState<string[]>([]);
  const [street, setStreet] = useState('');

  // Fetch streets from backend whenever city changes
  useEffect(() => {
    api.getDemoStreets(city).then((data) => {
      const names = data.streets.map((s: any) => s.name);
      setStreets(names);
      setStreet(names[0] || '');
    }).catch(() => {
      // Fallback
      const fallback = city === 'chandigarh'
        ? ['Madhya Marg & Sector 17 Chowk', 'Jan Marg & IT Park Chowk']
        : ['W 34th St & 7th Ave', 'Broadway & 34th St'];
      setStreets(fallback);
      setStreet(fallback[0]);
    });
  }, [city]);

  const handleInject = async () => {
    const res = await api.injectIncident({ severity, street_name: street, city });
    ...
  };
```

Also add `getDemoStreets(city: string)` to `services/api.ts`.

---

## AGENT 4 — Database: Regenerate Chandigarh CSV with 150+ segments

Run Python script to generate `chandigarh_link_speed.csv` with 150+ segments.

Approach: Add a segment every ~300m along each major road:
- Madhya Marg full (30.7650 → 30.7050 lat, ~7km → ~23 segments of 300m)
- Jan Marg (76.7700 → 76.8150 lng, ~5km → ~16 segments)  
- Dakshin Marg (~5km → ~16 segments)
- Vidhya Path, Himalaya Marg, Purv Marg (~8 each)
- All sector roads, connector roads, chowk approaches (~60 more)
- Total: 150+ unique segments

Each segment has 20 time frames with realistic speeds + congestion simulation.

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `backend/services/routing_service.py` | Modify | Waypoint + corridor polygon in congestion routing |
| `backend/services/feed_simulator.py` | Modify | Latest-per-link_id, 150+ NYC demo segments |
| `backend/routers/demo.py` | Modify | CHD_DEMO_STREETS + city-aware injection |
| `backend/data/chandigarh_link_speed.csv` | Regenerate | 150+ segments × 20 frames |
| `frontend/src/components/demo/DemoControls.tsx` | Modify | City-aware street picker |
| `frontend/src/services/api.ts` | Modify | Add getDemoStreets() |

## Risks

| Risk | Mitigation |
|------|------------|
| ORS may reject 3-point route (origin+waypoint+dest) | Fall back to 2-point with large corridor polygon only |
| Waypoint on parallel street may be off-road | ORS snaps to nearest road automatically |
| NYC API returns very few unique link_ids | Ensure demo fallback has 150+ segments |
| Chandigarh ORS: some waypoints may not be routable | Use larger offset (0.015°) if smaller fails |
