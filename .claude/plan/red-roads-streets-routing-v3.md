# Plan: Red Roads on Incident + Fix "5 Streets" + Better ORS Routing (v3)

## Root Cause Analysis

### BUG 1: "Roads passing through incident are not marked red"

**Root cause:** TrafficMap.tsx colors segment dots ONLY by speed (`getSpeedColor(seg.speed)`). When an incident occurs, the incident detector fires and the red polyline is drawn, but the individual segment dots that the blocked road passes through **remain green** because their speed value hasn't changed in the feed data.

The `affected_segment_ids` field exists in the incident data (`["demo_major_001"]`) but is **never used** in TrafficMap to recolor dots. There is zero logic to check if a segment is near the blocked route.

**Fix:** In TrafficMap, when `blockedRoute` exists, determine which segment dots fall within ~0.003° of the blocked route polyline coordinates, and force them to render red (override `getSpeedColor`). This creates the visual effect of "the road through the incident is red."

**Implementation:**
```tsx
// Helper: check if a point is near any coordinate on the blocked route
const isNearBlockedRoute = (lat: number, lng: number, blockedCoords: number[][]): boolean => {
  if (!blockedCoords || blockedCoords.length === 0) return false;
  const threshold = 0.003; // ~330m proximity
  return blockedCoords.some(
    ([cLng, cLat]) => Math.abs(lat - cLat) < threshold && Math.abs(lng - cLng) < threshold
  );
};

// In the segment map, override color:
const blockedCoords = blockedRoute?.geometry?.coordinates || [];
{segments.map((seg) => {
  const isBlocked = blockedCoords.length > 0 && isNearBlockedRoute(seg.lat, seg.lng, blockedCoords);
  const color = isBlocked ? '#ef4444' : getSpeedColor(seg.speed);
  const radius = isBlocked ? 9 : (seg.speed < 5 ? 8 : 6);
  return (
    <CircleMarker
      key={seg.link_id}
      center={[seg.lat, seg.lng]}
      radius={radius}
      pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: isBlocked ? 2 : 1 }}
    >
      ...
    </CircleMarker>
  );
})}
```

### BUG 2: "Still only 5 streets in NYC"

**Root cause:** The `load_city()` method has a **CSV fallback path (lines 70-87)** that STILL uses the OLD `df.groupby("DATA_AS_OF")` approach with UPPERCASE column names. Here's the failure cascade:

1. `_fetch_nyc_live()` is called → succeeds and returns deduped frames (correct)
2. Those frames are used. All good... BUT
3. The cached CSV (`nyc_link_speed.csv`) is written from `pd.DataFrame(records)` with **lowercase** column names (from NYC API JSON: `data_as_of`, `link_id`, etc.)
4. Next time the server starts, if the API call **fails** (timeout/rate-limit/network), it falls to the CSV fallback
5. CSV fallback does `df.groupby("DATA_AS_OF")` — but columns are lowercase → **KeyError** → crash or empty frames
6. Falls to `_generate_demo_data()` which has 137 segments BUT each frame only shows them with slow/normal speeds, and the replay works fine

BUT there's ANOTHER issue: if the user is currently running **Chandigarh**, the `load_city("chandigarh")` code hits `_load_chandigarh_csv()` which NOW correctly deduplicates. But if that CSV is not found, it goes to `_generate_demo_data("chandigarh")` which has 50 segments. The newly regenerated CSV should have 150 segments.

**The real remaining bug:** The CSV fallback path at lines 70-87 uses uppercase column names (`DATA_AS_OF`, `LINK_ID`, `LINK_NAME`, `SPEED`, `TRAVEL_TIME`, `STATUS`, `LATITUDE`, `LONGITUDE`) but the cached CSV has lowercase columns. This path MUST be updated to use the dedup-by-link_id approach with correct column names.

**Fix:** Replace the CSV fallback (lines 69-87) with the same dedup-by-link_id approach used in `_fetch_nyc_live()` and `_load_chandigarh_csv()`:
```python
# 2. Fall back to cached CSV
if csv_path.exists():
    try:
        import random
        df = pd.read_csv(csv_path)
        # Detect column names (API JSON uses lowercase, old CSVs may use uppercase)
        link_id_col = "link_id" if "link_id" in df.columns else "LINK_ID"
        link_name_col = "link_name" if "link_name" in df.columns else "LINK_NAME"
        speed_col = "speed" if "speed" in df.columns else "SPEED"
        travel_time_col = "travel_time" if "travel_time" in df.columns else "TRAVEL_TIME"
        data_as_of_col = "data_as_of" if "data_as_of" in df.columns else "DATA_AS_OF"
        link_points_col = "link_points" if "link_points" in df.columns else "LINK_POINTS"
        
        # Dedup: latest per link_id
        latest_by_link: dict[str, dict] = {}
        for _, row in df.iterrows():
            lid = str(row.get(link_id_col, "") or "")
            if not lid or lid == "nan":
                continue
            ts = str(row.get(data_as_of_col, "") or "")
            existing = latest_by_link.get(lid)
            if not existing or ts > str(existing.get(data_as_of_col, "")):
                latest_by_link[lid] = row.to_dict()
        
        base_frame: list[dict] = []
        for rec in latest_by_link.values():
            speed = float(rec.get(speed_col, 0) or 0)
            # Try link_points first, then lat/lng columns
            lp = str(rec.get(link_points_col, "") or "")
            lat, lng = self._parse_link_points(lp)
            if lat == 0 and lng == 0:
                lat = float(rec.get("LATITUDE", rec.get("latitude", 0)) or 0)
                lng = float(rec.get("LONGITUDE", rec.get("longitude", 0)) or 0)
            if lat == 0 and lng == 0:
                continue
            base_frame.append({
                "link_id": str(rec.get(link_id_col, "")),
                "link_name": str(rec.get(link_name_col, "Unknown")),
                "speed": round(speed, 1),
                "travel_time": round(float(rec.get(travel_time_col, 0) or 0), 2),
                "status": "BLOCKED" if speed < 2 else "SLOW" if speed < 15 else "OK",
                "lat": lat, "lng": lng,
            })
        
        if base_frame:
            frames: list[list[dict]] = []
            for _ in range(12):
                frame = []
                for seg in base_frame:
                    noise = random.uniform(-2.5, 2.5)
                    spd = max(0.0, round(seg["speed"] + noise, 1))
                    frame.append({**seg, "speed": spd, "status": "BLOCKED" if spd < 2 else "SLOW" if spd < 15 else "OK"})
                frames.append(frame)
            self.frames = frames
            logger.info(f"CSV fallback: {len(base_frame)} unique segments → {len(frames)} frames for {city}")
        else:
            logger.warning(f"CSV had no valid segments for {city}")
            self.frames = self._generate_demo_data(city)
    except Exception as e:
        logger.warning(f"CSV fallback failed: {e}, generating demo data")
        self.frames = self._generate_demo_data(city)
```

### BUG 3: "ORS takes longer path instead of shorter one"

**Root cause:** The forced waypoint offset of **0.012°** (~1.3km) is too aggressive. It sends the alternate route 1.3km away from the incident, making the detour unnecessarily long. ORS's own A* algorithm would find a shorter parallel-street route with a smaller nudge.

Additionally, the avoidance corridor of 0.005° (~555m) is larger than needed for a point incident — it may block roads that are valid short detours.

**ORS already has complete road geometry** — it uses OpenStreetMap data which has full street networks for both NYC and Chandigarh. The problem isn't "not enough road data" but rather our routing parameters being too aggressive.

**Fix:**
1. **Reduce waypoint offset**: 0.012° → 0.006° (~667m) — enough to force a parallel street without going too far
2. **Reduce incident corridor**: 0.005° → 0.003° (~333m) — blocks the immediate road but allows nearby parallel streets
3. **For congestion**: reduce waypoint from 0.013° → 0.007° and corridor padding from 0.003° → 0.002°
4. **Try without waypoint first**: If blocked route and alternate route are nearly identical (>90% coordinate overlap), THEN add the waypoint. This prevents unnecessary detours for incidents on roads where ORS naturally finds a different path.

```python
# Step 1: Try alternate without waypoint (just avoidance polygon)
alt_raw = await self.get_diversion_route(
    origin, destination,
    avoid_polygon=incident_corridor,
)

# Step 2: Check if alternate is genuinely different from blocked
if alt_raw and blocked_raw:
    alt_coords = alt_raw.get("features", [{}])[0].get("geometry", {}).get("coordinates", [])
    blocked_coords = blocked_raw.get("features", [{}])[0].get("geometry", {}).get("coordinates", [])
    # If routes share >80% of coordinates (nearly identical), force waypoint
    if self._routes_too_similar(blocked_coords, alt_coords, threshold=0.8):
        alt_raw = await self.get_diversion_route(
            origin, destination,
            waypoint=waypoint,
            avoid_polygon=incident_corridor,
        )
```

---

## Implementation Steps

### Step 1: Fix TrafficMap segment coloring near incidents
**File:** `frontend/src/components/map/TrafficMap.tsx`
- Add `isNearBlockedRoute()` helper function
- Extract `blockedCoords` from `blockedRoute?.geometry?.coordinates`
- Override segment color to red when segment is within 0.003° of blocked route
- Increase radius to 9 for blocked segments (more visible)

### Step 2: Fix CSV fallback in feed_simulator.py
**File:** `backend/services/feed_simulator.py`
- Replace lines 69-91 (CSV fallback path) with dedup-by-link_id approach
- Handle both uppercase and lowercase column names (for backward compat)
- Fall back to `_parse_link_points()` then to LATITUDE/LONGITUDE columns
- Wrap in try/except with fallback to `_generate_demo_data()`

### Step 3: Optimize ORS routing parameters
**File:** `backend/services/routing_service.py`
- In `compute_incident_route_pair()`:
  - Reduce corridor: 0.005° → 0.003°
  - Reduce waypoint: 0.012° → 0.006°
  - Add fallback: try without waypoint first, add waypoint only if routes too similar
  - Add `_routes_too_similar()` helper
- In `compute_congestion_route_pair()`:
  - Reduce waypoint: 0.013° → 0.007°
  - Reduce corridor padding: 0.003° → 0.002°

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `frontend/src/components/map/TrafficMap.tsx` | Modify | Red segments near blocked route |
| `backend/services/feed_simulator.py:L69-91` | Modify | CSV fallback dedup by link_id |
| `backend/services/routing_service.py:L118-182` | Modify | Smaller corridor + waypoint; try-without-waypoint-first |
| `backend/services/routing_service.py:L184-270` | Modify | Reduce congestion routing aggressiveness |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| isNearBlockedRoute() expensive on large segment lists | Only check if blockedRoute exists; use early exit in loop |
| Smaller avoidance polygon may not force different route | Fallback: add waypoint if routes are too similar |
| CSV column name detection may miss edge cases | Try both cases + explicit fallback to demo data |
| ORS may reject waypoint on unreachable location | Existing retry logic handles this; fallback to mock route |

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A (Claude-only analysis)
- GEMINI_SESSION: N/A (Claude-only analysis)
