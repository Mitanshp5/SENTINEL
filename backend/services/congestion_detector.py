import asyncio
import logging
import math
import time
from datetime import datetime, timezone
from typing import Callable
from collections import defaultdict

logger = logging.getLogger(__name__)


class CongestionDetector:
    """Detects traffic congestion from sustained low speeds (not sudden drops)."""
    
    def __init__(
        self,
        speed_threshold: float = 12.0,       # mph — below this = congested
        min_congested_frames: int = 6,        # 6 frames × 5s = 30s sustained
        min_congested_segments: int = 2,      # at least 2 segments in same area
        cooldown_seconds: float = 180,        # 3 min between congestion alerts
        recovery_frames: int = 4,             # 4 clear frames to clear congestion
    ):
        self.speed_threshold = speed_threshold
        self.min_congested_frames = min_congested_frames
        self.min_congested_segments = min_congested_segments
        self.cooldown_seconds = cooldown_seconds
        self.recovery_frames_needed = recovery_frames
        
        # Per-segment consecutive low-speed frame count
        self._low_speed_count: dict[str, int] = defaultdict(int)
        # Per-segment metadata
        self._segment_meta: dict[str, dict] = {}
        # Currently active congestion zones: {zone_id: zone_data}
        self._active_zones: dict[str, dict] = {}
        # Recovery counters per zone
        self._zone_recovery: dict[str, int] = defaultdict(int)
        # Last alert time
        self._last_alert_time: float = 0
        # Callbacks
        self._congestion_callbacks: list[Callable] = []
        self._clear_callbacks: list[Callable] = []
    
    def on_congestion(self, callback: Callable):
        """Register callback for new congestion detection."""
        self._congestion_callbacks.append(callback)
    
    def on_clear(self, callback: Callable):
        """Register callback for congestion cleared."""
        self._clear_callbacks.append(callback)
    
    def get_active_zones(self) -> list[dict]:
        """Return all active congestion zones."""
        return list(self._active_zones.values())
    
    async def process_frame(self, segments: list[dict]):
        """Process a feed frame and check for congestion."""
        congested_segments = []
        
        for seg in segments:
            link_id = seg["link_id"]
            speed = seg.get("speed", 0)
            
            # Cache metadata
            self._segment_meta[link_id] = {
                "link_name": seg.get("link_name", ""),
                "lat": seg.get("lat", 0),
                "lng": seg.get("lng", 0),
            }
            
            if speed < self.speed_threshold and speed > 0:
                self._low_speed_count[link_id] += 1
            else:
                self._low_speed_count[link_id] = 0
            
            # Check if this segment has been congested long enough
            if self._low_speed_count[link_id] >= self.min_congested_frames:
                meta = self._segment_meta[link_id]
                congested_segments.append({
                    "link_id": link_id,
                    "link_name": meta.get("link_name", ""),
                    "speed": speed,
                    "avg_speed": round(speed, 1),  # current speed (already sustained)
                    "congested_frames": self._low_speed_count[link_id],
                    "lat": meta.get("lat", 0),
                    "lng": meta.get("lng", 0),
                })
        
        # Check for new congestion zones (cluster of congested segments)
        if len(congested_segments) >= self.min_congested_segments:
            clustered_segments = self._select_local_cluster(congested_segments)
            if len(clustered_segments) < self.min_congested_segments:
                clustered_segments = []

            # Check cooldown
            now = time.time()
            if now - self._last_alert_time < self.cooldown_seconds and self._active_zones:
                # Update existing zones but don't create new alerts
                self._update_existing_zones(congested_segments)
                return

            if clustered_segments:
                # Create/update congestion zone using local cluster only
                zone_id = self._get_zone_id(clustered_segments)
                if zone_id not in self._active_zones:
                    await self._trigger_congestion(zone_id, clustered_segments)
                else:
                    # Reset recovery counter since congestion is still present
                    self._zone_recovery[zone_id] = 0
        
        # Check for recovery of active zones
        zones_to_clear = []
        for zone_id, zone in self._active_zones.items():
            zone_segment_ids = {s["link_id"] for s in zone.get("segments", [])}
            still_congested = any(
                s["link_id"] in zone_segment_ids for s in congested_segments
            )
            if not still_congested:
                self._zone_recovery[zone_id] += 1
                if self._zone_recovery[zone_id] >= self.recovery_frames_needed:
                    zones_to_clear.append(zone_id)
            else:
                self._zone_recovery[zone_id] = 0
        
        for zone_id in zones_to_clear:
            await self._clear_congestion(zone_id)
    
    def _get_zone_id(self, segments: list[dict]) -> str:
        """Generate a zone ID from the primary congested segment."""
        if not segments:
            return "unknown"
        primary = max(segments, key=lambda s: s.get("congested_frames", 0))
        center = self._cluster_center(segments)
        if center:
            key = f"{center[0]:.4f}_{center[1]:.4f}"
            return f"congestion_{primary['link_id']}_{key}"
        return f"congestion_{primary['link_id']}"
    
    def _update_existing_zones(self, congested_segments: list[dict]):
        """Update existing zone data without triggering new alerts."""
        for zone_id, zone in self._active_zones.items():
            zcoords = zone.get("location", {}).get("coordinates", [0, 0])
            zl, za = float(zcoords[0] or 0), float(zcoords[1] or 0)
            local_segments = [
                s for s in congested_segments
                if self._haversine_m(float(s.get("lng", 0)), float(s.get("lat", 0)), zl, za) <= 550.0
            ]
            zone["segments"] = local_segments or zone.get("segments", [])
            zone["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    async def _trigger_congestion(self, zone_id: str, congested_segments: list[dict]):
        """Create a new congestion zone and notify callbacks."""
        primary = max(congested_segments, key=lambda s: s.get("congested_frames", 0))
        center = self._cluster_center(congested_segments)
        span_m = self._cluster_span_m(congested_segments)
        cluster_id = self._cluster_id(congested_segments)
        
        zone = {
            "zone_id": zone_id,
            "city": "",  # set by caller
            "type": "congestion",
            "status": "active",
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "severity": "moderate" if primary["speed"] > 5 else "severe",
            "location": {
                "type": "Point",
                "coordinates": [primary["lng"], primary["lat"]],
            },
            "primary_street": primary["link_name"],
            "segments": congested_segments,
            "affected_segment_ids": [s["link_id"] for s in congested_segments],
            "cluster_id": cluster_id,
            "cluster_segment_count": len(congested_segments),
            "cluster_span_m": round(span_m, 1),
        }
        if center:
            zone["cluster_center"] = [center[0], center[1]]
        
        self._active_zones[zone_id] = zone
        self._zone_recovery[zone_id] = 0
        self._last_alert_time = time.time()
        
        logger.info(
            f"CONGESTION DETECTED: {primary['link_name']} "
            f"(speed: {primary['speed']:.0f} mph, sustained {primary['congested_frames']} frames, "
            f"cluster_segments={len(congested_segments)}, span={span_m:.0f}m)"
        )
        
        for callback in self._congestion_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(zone)
                else:
                    callback(zone)
            except Exception as e:
                logger.error(f"Congestion callback error: {e}")
    
    async def _clear_congestion(self, zone_id: str):
        """Clear a congestion zone."""
        zone = self._active_zones.pop(zone_id, None)
        self._zone_recovery.pop(zone_id, None)
        
        if zone:
            zone["status"] = "cleared"
            zone["cleared_at"] = datetime.now(timezone.utc).isoformat()
            logger.info(f"Congestion cleared: {zone.get('primary_street', zone_id)}")
            
            for callback in self._clear_callbacks:
                try:
                    if asyncio.iscoroutinefunction(callback):
                        await callback(zone)
                    else:
                        callback(zone)
                except Exception as e:
                    logger.error(f"Congestion clear callback error: {e}")
    
    def reset(self):
        """Reset all state (e.g., on city switch or loop wrap)."""
        self._low_speed_count.clear()
        self._segment_meta.clear()
        self._active_zones.clear()
        self._zone_recovery.clear()
        self._last_alert_time = 0

    def _cluster_id(self, segments: list[dict]) -> str:
        center = self._cluster_center(segments)
        if not center:
            return "unknown"
        return f"{center[0]:.4f}_{center[1]:.4f}"

    def _cluster_center(self, segments: list[dict]) -> tuple[float, float] | None:
        points = [
            (float(s.get("lng", 0)), float(s.get("lat", 0)))
            for s in segments
            if s.get("lat") is not None and s.get("lng") is not None
        ]
        if not points:
            return None
        return (
            sum(p[0] for p in points) / len(points),
            sum(p[1] for p in points) / len(points),
        )

    def _cluster_span_m(self, segments: list[dict]) -> float:
        points = [
            (float(s.get("lng", 0)), float(s.get("lat", 0)))
            for s in segments
            if s.get("lat") is not None and s.get("lng") is not None
        ]
        if len(points) < 2:
            return 0.0
        max_d = 0.0
        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                d = self._haversine_m(points[i][0], points[i][1], points[j][0], points[j][1])
                if d > max_d:
                    max_d = d
        return max_d

    def _select_local_cluster(self, segments: list[dict]) -> list[dict]:
        if not segments:
            return []
        # Cluster sustained-low segments by proximity to avoid city-spanning zones.
        threshold_m = 520.0
        points = [
            (
                idx,
                float(seg.get("lng", 0)),
                float(seg.get("lat", 0)),
                seg,
            )
            for idx, seg in enumerate(segments)
            if seg.get("lat") is not None and seg.get("lng") is not None
        ]
        if len(points) < 2:
            return segments

        neighbors: dict[int, list[int]] = {idx: [] for idx, *_ in points}
        for i in range(len(points)):
            ia, ilng, ilat, _ = points[i]
            for j in range(i + 1, len(points)):
                ja, jlng, jlat, _ = points[j]
                if self._haversine_m(ilng, ilat, jlng, jlat) <= threshold_m:
                    neighbors[ia].append(ja)
                    neighbors[ja].append(ia)

        visited = set()
        clusters: list[list[int]] = []
        for idx, *_ in points:
            if idx in visited:
                continue
            stack = [idx]
            comp = []
            visited.add(idx)
            while stack:
                cur = stack.pop()
                comp.append(cur)
                for nxt in neighbors.get(cur, []):
                    if nxt not in visited:
                        visited.add(nxt)
                        stack.append(nxt)
            clusters.append(comp)

        primary = max(segments, key=lambda s: s.get("congested_frames", 0))
        primary_idx = next((i for i, s in enumerate(segments) if s.get("link_id") == primary.get("link_id")), 0)
        selected = None
        for comp in clusters:
            if primary_idx in comp:
                selected = comp
                break
        if selected is None:
            selected = max(clusters, key=len)
        return [segments[i] for i in selected if 0 <= i < len(segments)]

    @staticmethod
    def _haversine_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
        r = 6_371_000.0
        p1 = math.radians(lat1)
        p2 = math.radians(lat2)
        dlat = p2 - p1
        dlng = math.radians(lng2 - lng1)
        h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
        return 2 * r * math.asin(math.sqrt(h))
