import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"


class RoutingService:
    """Computes diversion routes via OpenRouteService API."""
    
    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self._cache: dict[str, dict] = {}
    
    async def get_diversion_route(
        self, origin: tuple[float, float], destination: tuple[float, float],
        avoid_coords: Optional[list[tuple[float, float]]] = None
    ) -> Optional[dict]:
        """
        Compute a route from origin to destination.
        origin/destination: (longitude, latitude) tuples.
        Returns GeoJSON FeatureCollection with route geometry and instructions.
        """
        cache_key = f"{origin}_{destination}_{bool(avoid_coords)}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        if not self.api_key:
            logger.warning("ORS API key not configured, returning mock route")
            return self._mock_route(origin, destination)
        
        body = {
            "coordinates": [list(origin), list(destination)],
            "instructions": True,
            "extra_info": ["roadaccessrestrictions"],
            "options": {
                "avoid_features": ["tollways"]
            }
        }
        
        # Add avoidance zones if provided (around incident)
        if avoid_coords:
            body["options"]["avoid_polygons"] = {
                "type": "MultiPolygon",
                "coordinates": [
                    [self._coord_to_polygon(c, 0.002) for c in avoid_coords]
                ]
            }
        
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    response = await client.post(
                        ORS_DIRECTIONS_URL,
                        headers={
                            "Authorization": self.api_key,
                            "Content-Type": "application/json"
                        },
                        json=body
                    )
                    response.raise_for_status()
                    result = response.json()
                
                self._cache[cache_key] = result
                logger.info(f"Route computed: {origin} -> {destination}")
                return result
                
            except Exception as e:
                logger.error(f"ORS routing failed (attempt {attempt+1}): {e}")
                if attempt == 0:
                    import asyncio
                    await asyncio.sleep(1)
                    continue
                return self._mock_route(origin, destination)
    
    def extract_route_info(self, geojson_route: dict) -> dict:
        """Extract key info from an ORS GeoJSON route response."""
        if not geojson_route or "features" not in geojson_route:
            return {}
        
        feature = geojson_route["features"][0]
        props = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        
        # Extract street names from steps
        street_names = []
        for segment in props.get("segments", []):
            for step in segment.get("steps", []):
                name = step.get("name", "")
                if name and name not in street_names:
                    street_names.append(name)
        
        return {
            "geometry": geometry,
            "total_distance_km": round(props.get("summary", {}).get("distance", 0) / 1000, 2),
            "total_duration_min": round(props.get("summary", {}).get("duration", 0) / 60, 1),
            "street_names": street_names,
        }
    
    async def compute_incident_route_pair(
        self,
        incident_lng: float,
        incident_lat: float,
        city: str = "nyc",
    ) -> dict:
        """
        Compute blocked road (red) + best alternate route (green) for an incident.

        Strategy:
        - Origin = ~800m upstream of incident (diagonal offset)
        - Destination = ~800m downstream of incident (diagonal offset)
        - Blocked route = ORS direct path origin→destination (the road being blocked, shown RED)
        - Alternate route = ORS path origin→destination AVOIDING incident point (shown GREEN)

        Returns: {"blocked": {...}, "alternate": {...}, "origin": [lng, lat], "destination": [lng, lat]}
        """
        # Diagonal offset ~800m works for both N-S and E-W oriented roads
        # 0.008° lat ≈ 890m, 0.009° lng ≈ 750m at NYC latitude (40.7°)
        # For Chandigarh (30.7°): 0.009° lng ≈ 865m
        lat_offset = 0.007
        lng_offset = 0.009

        origin = (round(incident_lng - lng_offset, 6), round(incident_lat - lat_offset, 6))
        destination = (round(incident_lng + lng_offset, 6), round(incident_lat + lat_offset, 6))

        logger.info(f"Computing incident route pair: origin={origin} dest={destination} incident=({incident_lng},{incident_lat})")

        # Blocked road: direct route through the incident area (no avoidance)
        blocked_raw = await self.get_diversion_route(origin, destination, avoid_coords=None)
        blocked_info = self.extract_route_info(blocked_raw) if blocked_raw else {}

        # Alternate route: avoid a 200m radius around the incident
        alt_raw = await self.get_diversion_route(
            origin, destination,
            avoid_coords=[(incident_lng, incident_lat)]
        )
        alt_info = self.extract_route_info(alt_raw) if alt_raw else {}

        return {
            "origin": list(origin),
            "destination": list(destination),
            "blocked": {
                "geometry": blocked_info.get("geometry", {"type": "LineString", "coordinates": [list(origin), [incident_lng, incident_lat], list(destination)]}),
                "total_length_km": blocked_info.get("total_distance_km", 0),
                "street_names": blocked_info.get("street_names", []),
            },
            "alternate": {
                "geometry": alt_info.get("geometry", {"type": "LineString", "coordinates": [list(origin), list(destination)]}),
                "total_length_km": alt_info.get("total_distance_km", 0),
                "estimated_extra_minutes": alt_info.get("total_duration_min", 0),
                "street_names": alt_info.get("street_names", []),
            },
        }

    async def compute_diversions_for_incident(
        self, incident_location: tuple[float, float],
        city: str = "nyc"
    ) -> list[dict]:
        """
        Compute multiple diversion routes around an incident.
        Returns a list of prioritized route options.
        """
        # Define diversion endpoints based on city
        if city == "nyc":
            # NYC diversion endpoints around W 34th St area
            diversion_pairs = [
                {
                    "name": "Diversion A",
                    "origin": (-73.9980, 40.7579),   # 10th Ave & 42nd St
                    "destination": (-73.9895, 40.7498),  # 7th Ave & 33rd St
                },
                {
                    "name": "Diversion B", 
                    "origin": (-73.9939, 40.7580),   # 9th Ave & 42nd St
                    "destination": (-73.9878, 40.7484),  # Broadway & 34th St
                },
            ]
        else:
            # Chandigarh diversions around Madhya Marg
            diversion_pairs = [
                {
                    "name": "Diversion A",
                    "origin": (76.7788, 30.7412),    # Sector 17 Chowk
                    "destination": (76.7675, 30.7270),  # Tribune Chowk
                },
                {
                    "name": "Diversion B",
                    "origin": (76.7760, 30.7646),    # PGI Chowk
                    "destination": (76.7780, 30.7320),  # Sector 22 Chowk
                },
            ]
        
        results = []
        for i, pair in enumerate(diversion_pairs):
            route = await self.get_diversion_route(
                pair["origin"], pair["destination"],
                avoid_coords=[incident_location]
            )
            if route:
                info = self.extract_route_info(route)
                results.append({
                    "priority": i + 1,
                    "name": pair["name"],
                    "segment_names": info.get("street_names", []),
                    "geometry": info.get("geometry", {}),
                    "total_length_km": info.get("total_distance_km", 0),
                    "estimated_extra_minutes": info.get("total_duration_min", 0),
                })
        
        return results
    
    def _coord_to_polygon(self, coord: tuple[float, float], radius: float) -> list:
        """Create a simple square polygon around a coordinate for avoidance."""
        lng, lat = coord
        return [
            [lng - radius, lat - radius],
            [lng + radius, lat - radius],
            [lng + radius, lat + radius],
            [lng - radius, lat + radius],
            [lng - radius, lat - radius],
        ]
    
    def _mock_route(self, origin: tuple, destination: tuple) -> dict:
        """Return a mock route when ORS API is unavailable."""
        return {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [list(origin), list(destination)]
                },
                "properties": {
                    "summary": {"distance": 2300, "duration": 480},
                    "segments": [{
                        "steps": [
                            {"name": "Alternate Route", "distance": 2300, "duration": 480}
                        ]
                    }]
                }
            }]
        }
    
    def clear_cache(self):
        self._cache.clear()
