# Implementation Plan: Optimal Route Selection with Mapbox Directions API

## Problem Statement

Currently, multiple overlapping alternate routes are displayed for each incident, creating visual clutter (see screenshot). The user wants ONE optimal route using Mapbox's native routing capabilities with real-time traffic awareness.

## Task Type
- [x] Backend (Routing service changes)
- [x] Frontend (Display single optimal route)
- [x] Fullstack (API integration + UI)

---

## Technical Solution

### Current State (ORS-based)
- Uses OpenRouteService API for routing
- Computes blocked route + alternate route via `avoid_polygons`
- Multiple incidents = multiple overlapping routes
- No real-time traffic awareness
- Routes sometimes look unnatural (sharp turns, odd paths)

### Proposed State (Mapbox Directions API)
- Replace/supplement ORS with **Mapbox Directions API**
- Use `mapbox/driving-traffic` profile for **traffic-aware routing**
- Request `alternatives=true` for 2-3 candidate routes
- Apply **A* scoring algorithm** to pick THE BEST single route based on:
  - Distance
  - Duration (traffic-adjusted)
  - Congestion level
  - Incident avoidance
- Display **ONE optimal route** per incident instead of multiple

### Key Advantages of Mapbox Directions
| Feature | ORS | Mapbox Directions |
|---------|-----|-------------------|
| Real-time traffic | ❌ | ✅ `driving-traffic` profile |
| Road snapping | Via workaround | ✅ Native |
| Alternatives | ❌ With `avoid_polygons` | ✅ `alternatives=true` |
| Congestion data | ❌ | ✅ `annotations=congestion` |
| API limits | 2000/day free | 100K/month free |

---

## Implementation Steps

### Step 1: Add Mapbox Directions API Support (Backend)
Create new service method `get_mapbox_route()` in `routing_service.py`:

```python
MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic"

async def get_mapbox_route(
    self,
    origin: tuple[float, float],
    destination: tuple[float, float],
    waypoints: list[tuple[float, float]] | None = None,
    avoid_incident: tuple[float, float] | None = None,
) -> dict:
    """Get optimal route using Mapbox Directions API with traffic awareness."""
    
    # Build coordinates string: origin;waypoint1;waypoint2;destination
    coords = [f"{origin[0]},{origin[1]}"]
    if waypoints:
        coords.extend([f"{wp[0]},{wp[1]}" for wp in waypoints])
    coords.append(f"{destination[0]},{destination[1]}")
    
    params = {
        "access_token": self.mapbox_token,
        "geometries": "geojson",
        "overview": "full",
        "alternatives": "true",  # Get up to 2 alternatives
        "annotations": "congestion,duration,distance,speed",
        "steps": "true",  # For street names
    }
    
    # Add exclusion for incident area via exclude parameter
    if avoid_incident:
        # Mapbox supports point-based exclusions
        params["exclude"] = f"point({avoid_incident[0]} {avoid_incident[1]})"
    
    url = f"{MAPBOX_DIRECTIONS_URL}/{';'.join(coords)}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, params=params)
        if response.is_success:
            return response.json()
    return None
```

### Step 2: Implement A* Route Scoring Algorithm (Backend)
Create `score_and_select_best_route()` method:

```python
def score_and_select_best_route(
    self,
    routes: list[dict],
    incident_location: tuple[float, float],
    severity: str = "moderate",
) -> dict:
    """
    Score routes using A* inspired heuristic and return the optimal one.
    
    Scoring factors:
    - g(n): Actual cost = duration in traffic
    - h(n): Heuristic = distance from incident + congestion penalty
    - f(n) = g(n) + h(n)
    """
    SEVERITY_WEIGHTS = {
        "critical": 2.0,
        "major": 1.5,
        "moderate": 1.0,
        "minor": 0.5,
    }
    
    scored_routes = []
    for route in routes:
        duration = route.get("duration", 9999)  # seconds
        distance = route.get("distance", 9999)  # meters
        
        # Calculate congestion penalty from annotations
        congestion = route.get("legs", [{}])[0].get("annotation", {}).get("congestion", [])
        congestion_score = sum(1 for c in congestion if c in ["heavy", "severe"]) / max(len(congestion), 1)
        
        # Calculate minimum distance from incident
        coords = route.get("geometry", {}).get("coordinates", [])
        min_incident_dist = min(
            self._haversine(coord, incident_location) for coord in coords
        ) if coords else 0
        
        # A* score: f(n) = g(n) + h(n)
        # g(n) = duration (normalized to minutes)
        # h(n) = congestion penalty + incident proximity penalty
        g_cost = duration / 60  # minutes
        h_cost = (
            congestion_score * 10 +  # 0-10 points for congestion
            max(0, 500 - min_incident_dist) / 100 * SEVERITY_WEIGHTS.get(severity, 1.0)  # Proximity penalty
        )
        
        f_score = g_cost + h_cost
        scored_routes.append((f_score, route))
    
    # Return route with lowest f_score (optimal)
    scored_routes.sort(key=lambda x: x[0])
    return scored_routes[0][1] if scored_routes else routes[0]
```

### Step 3: Update compute_incident_route_pair() (Backend)
Modify to use Mapbox and return single optimal route:

```python
async def compute_incident_route_pair(
    self,
    incident_lng: float,
    incident_lat: float,
    city: str = "nyc",
    severity: str = "moderate",
    on_street: str = "",
    extra_avoid_polygons: list | None = None,
) -> dict:
    """Compute blocked road + SINGLE BEST alternate route using Mapbox."""
    
    # ... existing origin/destination logic ...
    
    # Try Mapbox first (if token available)
    if self.mapbox_token:
        mapbox_result = await self.get_mapbox_route(
            origin, destination,
            avoid_incident=(incident_lng, incident_lat),
        )
        
        if mapbox_result and mapbox_result.get("routes"):
            # Pick the optimal route using A* scoring
            routes = mapbox_result["routes"]
            best_route = self.score_and_select_best_route(
                routes, 
                (incident_lng, incident_lat),
                severity,
            )
            
            return {
                "origin": list(origin),
                "destination": list(destination),
                "blocked": self._extract_blocked_route(blocked_raw),
                "alternate": {
                    "geometry": best_route["geometry"],
                    "total_length_km": best_route["distance"] / 1000,
                    "estimated_extra_minutes": best_route["duration"] / 60,
                    "congestion_level": self._get_congestion_summary(best_route),
                    "street_names": self._extract_street_names(best_route),
                    "is_optimal": True,  # Flag for frontend
                },
            }
    
    # Fallback to ORS if Mapbox unavailable
    return await self._compute_with_ors(...)
```

### Step 4: Add MAPBOX_TOKEN to Backend Config
Update `backend/config.py`:

```python
class Settings(BaseSettings):
    # ... existing ...
    mapbox_token: str = ""  # For Directions API
```

### Step 5: Update Frontend to Show Single Route (Frontend)
Modify `TrafficMap.tsx` to display only the optimal route:

```tsx
// Instead of rendering all routes, filter to optimal only
const optimalRoutes = useMemo(() => {
  return incidentRoutes.filter(rp => {
    // Only show routes marked as optimal, or first route per incident
    const isOptimal = rp.alternate?.is_optimal ?? true;
    const isActive = incidents.some(i => 
      i.id === rp.incidentId && i.city === city && i.status === 'active'
    );
    return isActive && isOptimal;
  });
}, [incidentRoutes, incidents, city]);
```

### Step 6: Add Route Quality Indicator (Frontend)
Show congestion level and ETA on the route:

```tsx
{/* Route label with congestion indicator */}
<Marker longitude={routeMidpoint[0]} latitude={routeMidpoint[1]}>
  <div className="bg-green-900/90 px-2 py-1 rounded text-xs font-mono">
    <span className={`w-2 h-2 rounded-full inline-block mr-1 ${
      congestionLevel === 'low' ? 'bg-green-500' :
      congestionLevel === 'moderate' ? 'bg-yellow-500' : 'bg-red-500'
    }`} />
    {estimatedMinutes} min • {distanceKm} km
  </div>
</Marker>
```

### Step 7: Add Traffic Layer Toggle (Frontend)
Enable Mapbox's built-in traffic layer:

```tsx
<Map
  mapboxAccessToken={...}
  mapStyle="mapbox://styles/mapbox/dark-v11"
>
  {/* Add traffic layer source */}
  <Source
    id="traffic"
    type="vector"
    url="mapbox://mapbox.mapbox-traffic-v1"
  >
    <Layer
      id="traffic-flow"
      type="line"
      source-layer="traffic"
      paint={{
        'line-color': [
          'match', ['get', 'congestion'],
          'low', '#22c55e',
          'moderate', '#f59e0b',
          'heavy', '#ef4444',
          'severe', '#991b1b',
          '#3f3f46'
        ],
        'line-width': 2,
        'line-opacity': 0.7,
      }}
    />
  </Source>
</Map>
```

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| backend/config.py | Modify | Add mapbox_token setting |
| backend/services/routing_service.py | Modify | Add get_mapbox_route(), score_and_select_best_route() |
| backend/app.py | Modify | Pass severity to compute_incident_route_pair() |
| frontend/src/components/map/TrafficMap.tsx | Modify | Show single optimal route, add traffic layer |
| backend/.env | Modify | Add MAPBOX_TOKEN |

---

## Scoring Algorithm (A* Inspired)

```
f(route) = g(route) + h(route)

where:
  g(route) = duration_minutes              # Actual travel time in traffic
  h(route) = congestion_penalty            # Heavy/severe segments count
          + incident_proximity_penalty     # Closer to incident = higher penalty
          + severity_weight                # Critical incidents penalize nearby routes more

Best route = argmin(f(route))
```

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Mapbox API quota exceeded | Keep ORS as fallback, cache routes |
| API latency | Parallel requests, caching |
| No alternatives returned | Fall back to direct route with avoidance |
| Token exposure | Use env var, never commit |

---

## API Comparison

| API | Free Tier | Traffic-Aware | Alternatives |
|-----|-----------|---------------|--------------|
| ORS | 2,000/day | ❌ | Via avoid_polygons |
| Mapbox | 100,000/month | ✅ driving-traffic | ✅ alternatives=true |
| OSRM | Unlimited (self-host) | ❌ | ✅ |

---

## Testing Checklist

- [ ] Mapbox token configured in .env
- [ ] Single optimal route displays per incident
- [ ] Route avoids incident area
- [ ] Congestion data shows in route info
- [ ] Traffic layer toggleable
- [ ] Fallback to ORS works when Mapbox fails
- [ ] A* scoring picks shorter/less congested route

---

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A (manual analysis)
- GEMINI_SESSION: N/A (manual analysis)
