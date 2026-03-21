# Implementation Plan: Route Visualization Overhaul

## Problem Statement

Current map visualization has several issues:
1. **Congestion zones appear as squares** instead of road-following colored overlays
2. **Incident markers are basic circles** instead of severity-based gradient impact zones
3. **Routes overlap poorly** - green alternate routes overlap with red blocked routes
4. **Multiple nearby incidents create visual clutter** with overlapping route pairs

## Technical Solution

### Solution 1: Road-Following Congestion Overlays

**Approach:** Instead of polygon squares, render congestion as **colored polylines on the actual road segments** with gradient coloring based on severity.

**Backend Changes:**
- Modify `_on_congestion()` to include affected segment geometries
- Each congested segment already has lat/lng - use these to draw colored road overlays

**Frontend Changes:**
- Replace `Polygon` rendering with multiple `Polyline` components per segment
- Use SVG gradient definitions for red→yellow fading effect
- Apply thicker line weights (8-12px) with severity-based colors

**Color Scheme:**
```
Severe: #ef4444 (Red) center, #f59e0b (Amber) edges
Moderate: #f59e0b (Amber) center, #fbbf24 (Yellow) edges
```

### Solution 2: Gradient Impact Zones for Incidents

**Approach:** Replace CircleMarkers with **multiple concentric circles** creating gradient effect.

**Implementation:**
- Inner circle (25% radius): Solid red (#ef4444) 80% opacity
- Middle ring (50% radius): Amber (#f59e0b) 40% opacity  
- Outer ring (100% radius): Yellow (#fbbf24) 15% opacity + pulse animation

**Severity Radius Mapping:**
```
critical: 0.006° (~660m)
major: 0.004° (~440m)
moderate: 0.003° (~330m)
minor: 0.002° (~220m)
```

### Solution 3: Route Overlap Prevention

**Backend Approach:** Ensure alternate routes diverge BEFORE entering blocked area.

**Changes to `compute_incident_route_pair()`:**
1. Increase avoidance box from ±0.003° to ±0.005° (~550m)
2. Place origin/destination further apart (±0.008° instead of ±0.005°)
3. Add route similarity threshold check - if >50% overlap, force waypoint

**Frontend Approach:** Visual differentiation
- Blocked route: Dashed red (#ef4444), 5px weight, 70% opacity
- Alternate route: Solid green (#22c55e), 7px weight, 90% opacity
- Add glow effect to alternate route using SVG filter

### Solution 4: Multiple Incident Route Consolidation

**Backend Approach:** New function `compute_consolidated_routes()`:

1. Group incidents within 500m of each other
2. Calculate single bounding box encompassing all grouped incidents
3. Generate ONE blocked route (covering entire congested corridor)
4. Generate ONE alternate route (bypassing entire group)

**Data Structure:**
```typescript
interface ConsolidatedRoutePair {
  incidentIds: string[];  // All incidents covered
  groupCenter: [number, number];
  blocked: RouteGeometry;
  alternate: RouteGeometry;
}
```

**Frontend:** Render consolidated routes instead of individual pairs when incidents are grouped.

---

## Implementation Steps

### Step 1: Backend - Segment-Based Congestion Data
- **File:** `backend/app.py` lines 574-636
- **Changes:** Include segment coordinates in congestion_alert broadcast
- **Expected:** Each segment has `geometry: [[lng, lat], ...]` for road path

### Step 2: Frontend - Road-Following Congestion Overlays
- **File:** `frontend/src/components/map/TrafficMap.tsx` lines 211-234
- **Changes:** Replace Polygon with Polyline per segment, add gradient coloring
- **Expected:** Congestion shows as colored road segments, not squares

### Step 3: Frontend - Gradient Impact Zones
- **File:** `frontend/src/components/map/TrafficMap.tsx` lines 102-133
- **Changes:** Add concentric Circle components for gradient effect
- **Expected:** Incidents show red center fading to yellow edges

### Step 4: Backend - Larger Avoidance & Better Separation
- **File:** `backend/services/routing_service.py` lines 275-421
- **Changes:** Increase avoidance box, widen origin/destination spread
- **Expected:** Green routes diverge earlier, less overlap with red

### Step 5: Backend - Route Consolidation Logic
- **File:** `backend/services/routing_service.py` (new function)
- **Changes:** Add `compute_consolidated_routes()` for nearby incidents
- **Expected:** Single route pair for incident clusters

### Step 6: Frontend - Consolidated Route Rendering
- **File:** `frontend/src/components/map/TrafficMap.tsx`
- **Changes:** Detect and render consolidated routes, skip individual overlapping pairs
- **Expected:** Clean single route instead of multiple overlapping routes

### Step 7: Frontend - Route Visual Enhancement
- **File:** `frontend/src/components/map/TrafficMap.tsx`
- **Changes:** Add SVG glow filter, adjust weights/opacity for clarity
- **Expected:** Professional, clean route visualization

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `backend/app.py:574-636` | Modify | Add segment geometries to congestion broadcast |
| `backend/services/routing_service.py:275-421` | Modify | Increase avoidance, add consolidation |
| `frontend/src/components/map/TrafficMap.tsx:102-133` | Modify | Gradient impact zones for incidents |
| `frontend/src/components/map/TrafficMap.tsx:135-209` | Modify | Better route rendering with glow effects |
| `frontend/src/components/map/TrafficMap.tsx:211-234` | Modify | Road-following congestion overlays |
| `frontend/src/store/index.ts:85-91` | Modify | Add ConsolidatedRoutePair interface |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Segment geometries not available | Fall back to point-based circles if no geometry |
| Performance with many polylines | Limit to 50 segments max, use canvas renderer |
| Route consolidation edge cases | Keep individual routes as fallback |
| SVG gradients browser support | Use solid colors as fallback |

---

## Visual Specifications

### Congestion Overlay Colors
```css
--congestion-severe-center: #ef4444;   /* Red */
--congestion-severe-edge: #f59e0b;     /* Amber */
--congestion-moderate-center: #f59e0b; /* Amber */
--congestion-moderate-edge: #fbbf24;   /* Yellow */
```

### Impact Zone Layers
```
Layer 1 (innermost): radius * 0.25, color: #ef4444, opacity: 0.8
Layer 2 (middle):    radius * 0.50, color: #f59e0b, opacity: 0.4
Layer 3 (outer):     radius * 1.00, color: #fbbf24, opacity: 0.15, animate: pulse
```

### Route Styling
```
Blocked Route:  color: #ef4444, weight: 5px, opacity: 0.7, dashArray: '12,8'
Alternate Route: color: #22c55e, weight: 7px, opacity: 0.9, filter: glow
```

---

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A (manual analysis)
- GEMINI_SESSION: N/A (manual analysis)

---

## Task Type
- [x] Frontend (→ TrafficMap.tsx, store)
- [x] Backend (→ routing_service.py, app.py)
- [x] Fullstack (→ Parallel)
