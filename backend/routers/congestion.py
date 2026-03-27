from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
import db as db_module

router = APIRouter()


def _segment_to_line_geometry(lat: float, lng: float, link_name: str, length_deg: float = 0.001) -> list[list[float]]:
    """Create a short line centered at a segment point, oriented by street type."""
    name = (link_name or "").lower()
    if "ave" in name or "avenue" in name or "broadway" in name:
        return [[lng, lat - length_deg / 2], [lng, lat + length_deg / 2]]
    return [[lng - length_deg / 2, lat], [lng + length_deg / 2, lat]]


def _is_valid_point(pt: Any) -> bool:
    return isinstance(pt, (list, tuple)) and len(pt) >= 2


def _close_polygon(points: list[list[float]]) -> list[list[float]]:
    if not points:
        return points
    if points[0] != points[-1]:
        return points + [points[0]]
    return points


def _severity_radius_deg(severity: str | None) -> float:
    sev = (severity or "").lower()
    if sev in ("critical", "severe"):
        return 0.002
    if sev in ("major",):
        return 0.0015
    if sev in ("minor", "low"):
        return 0.0008
    return 0.0012


def _derive_segment_geometries(doc: dict[str, Any]) -> list[dict[str, Any]]:
    existing = doc.get("segment_geometries")
    if isinstance(existing, list) and existing:
        out: list[dict[str, Any]] = []
        for idx, seg in enumerate(existing):
            geom = seg.get("geometry") if isinstance(seg, dict) else None
            if isinstance(geom, list) and len(geom) >= 2:
                out.append({
                    "segment_id": seg.get("segment_id") if isinstance(seg, dict) else f"seg_{idx}",
                    "name": seg.get("name") if isinstance(seg, dict) else "",
                    "speed": seg.get("speed", 0) if isinstance(seg, dict) else 0,
                    "geometry": geom,
                })
        if out:
            return out

    segments = doc.get("segments")
    if not isinstance(segments, list) or not segments:
        return []
    derived: list[dict[str, Any]] = []
    for idx, seg in enumerate(segments):
        if not isinstance(seg, dict):
            continue
        lat = seg.get("lat")
        lng = seg.get("lng")
        if lat is None or lng is None:
            continue
        name = seg.get("link_name") or seg.get("name") or ""
        derived.append({
            "segment_id": seg.get("link_id") or seg.get("segment_id") or f"seg_{idx}",
            "name": name,
            "speed": seg.get("speed", 0),
            "geometry": _segment_to_line_geometry(float(lat), float(lng), str(name)),
        })
    return derived


def _derive_polygon(doc: dict[str, Any], segment_geometries: list[dict[str, Any]]) -> list[list[float]]:
    polygon = doc.get("polygon")
    if isinstance(polygon, list) and len(polygon) >= 4 and all(_is_valid_point(p) for p in polygon):
        return _close_polygon([[float(p[0]), float(p[1])] for p in polygon])

    segment_pts: list[list[float]] = []
    for seg in segment_geometries:
        geom = seg.get("geometry", [])
        if not isinstance(geom, list):
            continue
        for pt in geom:
            if _is_valid_point(pt):
                segment_pts.append([float(pt[0]), float(pt[1])])
    if segment_pts:
        min_lng = min(p[0] for p in segment_pts)
        max_lng = max(p[0] for p in segment_pts)
        min_lat = min(p[1] for p in segment_pts)
        max_lat = max(p[1] for p in segment_pts)
        pad = 0.0006
        return [
            [min_lng - pad, min_lat - pad],
            [max_lng + pad, min_lat - pad],
            [max_lng + pad, max_lat + pad],
            [min_lng - pad, max_lat + pad],
            [min_lng - pad, min_lat - pad],
        ]

    loc = doc.get("location", {})
    coords = loc.get("coordinates") if isinstance(loc, dict) else None
    if _is_valid_point(coords):
        lng = float(coords[0])
        lat = float(coords[1])
        r = _severity_radius_deg(doc.get("severity"))
        return [
            [lng - r, lat - r],
            [lng + r, lat - r],
            [lng + r, lat + r],
            [lng - r, lat + r],
            [lng - r, lat - r],
        ]
    return []


def _derive_center(doc: dict[str, Any], polygon: list[list[float]]) -> list[float]:
    center = doc.get("center")
    if _is_valid_point(center):
        return [float(center[0]), float(center[1])]

    loc = doc.get("location", {})
    coords = loc.get("coordinates") if isinstance(loc, dict) else None
    if _is_valid_point(coords):
        return [float(coords[0]), float(coords[1])]

    if polygon:
        lats = [p[1] for p in polygon]
        lngs = [p[0] for p in polygon]
        return [sum(lngs) / len(lngs), sum(lats) / len(lats)]
    return []


def _normalize_zone(doc: dict[str, Any]) -> dict[str, Any]:
    segment_geometries = _derive_segment_geometries(doc)
    polygon = _derive_polygon(doc, segment_geometries)
    center = _derive_center(doc, polygon)
    status = str(doc.get("status") or ("permanent" if doc.get("source") == "default" else "active")).lower()

    return {
        "zone_id": str(doc.get("zone_id") or doc.get("_id") or ""),
        "city": doc.get("city", ""),
        "status": status,
        "source": doc.get("source") or doc.get("type") or "unknown",
        "severity": doc.get("severity", "moderate"),
        "center": center,
        "polygon": polygon,
        "segment_geometries": segment_geometries,
    }


@router.get("/active")
async def get_active_congestion(request: Request):
    """Return all currently active congestion zones."""
    detector = request.app.state.congestion_detector
    zones = detector.get_active_zones()
    return {"zones": zones}


@router.get("/zones/default")
async def list_default_zones(city: str = "nyc"):
    """List default congestion zones for a city."""
    if db_module.congestion_zones is None:
        return []
    cursor = db_module.congestion_zones.find(
        {"city": city, "source": "default"},
        {"_id": 0}
    )
    return [doc async for doc in cursor]


@router.get("/zones/visible")
async def list_visible_zones(city: str = "nyc", statuses: str = "active,permanent"):
    """List normalized congestion zones visible on maps."""
    if db_module.congestion_zones is None:
        return []

    requested_statuses = [s.strip().lower() for s in statuses.split(",") if s.strip()]
    if not requested_statuses:
        requested_statuses = ["active", "permanent"]

    cursor = db_module.congestion_zones.find({"city": city})
    docs = [doc async for doc in cursor]

    normalized = []
    for doc in docs:
        zone = _normalize_zone(doc)
        if zone["status"] not in requested_statuses:
            continue
        if not zone["polygon"] and not zone["segment_geometries"]:
            continue
        normalized.append(zone)

    return normalized


@router.get("/history")
async def get_congestion_history(request: Request, limit: int = 20):
    """Return recent congestion zones from DB."""
    congestion_col = getattr(db_module, 'congestion_zones', None)
    if congestion_col is None:
        return {"zones": []}
    cursor = congestion_col.find({}, {"_id": 0}).sort("detected_at", -1).limit(limit)
    zones = await cursor.to_list(length=limit)
    return {"zones": zones}
