import asyncio
import pandas as pd
import numpy as np
import logging
import httpx
from typing import Callable, Optional, Any
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

# NYC DOT Traffic Speeds NBE — real-time speed per road segment
NYC_SPEED_API = "https://data.cityofnewyork.us/resource/i4gi-tjb9.json"

# Filter to Manhattan borough for manageable data size
NYC_BOROUGH_FILTER = "borough='Manhattan'"


class FeedSimulator:
    """Replays traffic speed data — fetches live from NYC Open Data API,
    falls back to cached CSV, then to synthetic demo data."""
    
    def __init__(self, data_dir: str = "data", app_token: str = ""):
        self.data_dir = Path(data_dir)
        self.app_token = app_token
        self.active_city: str = "nyc"
        self.frames: list[list[dict]] = []
        self.current_frame_idx: int = 0
        self.is_running: bool = False
        self.interval: float = 5.0
        self._task: Optional[asyncio.Task] = None
        self._callbacks: list[Callable] = []
        self._loop_end_callbacks: list[Callable] = []
        self._current_segments: list[dict] = []
    
    def on_frame(self, callback: Callable):
        """Register callback for new frame events."""
        self._callbacks.append(callback)
    
    def on_loop_end(self, callback: Callable):
        """Register callback fired when replay loop wraps around."""
        self._loop_end_callbacks.append(callback)
    
    def get_current_segments(self) -> list[dict]:
        """Return the latest frame of segment data."""
        return self._current_segments
    
    async def load_city(self, city: str):
        """Load feed data: API → cached CSV → demo data."""
        self.active_city = city
        csv_path = self.data_dir / f"{city}_link_speed.csv"

        # 1. Try live API fetch for NYC
        if city == "nyc" and self.app_token:
            api_frames = await self._fetch_nyc_live()
            if api_frames:
                self.frames = api_frames
                self.current_frame_idx = 0
                return

        # 1b. Try Chandigarh CSV
        if city == "chandigarh":
            csv_frames = await self._load_chandigarh_csv()
            if csv_frames:
                self.frames = csv_frames
                self.current_frame_idx = 0
                return

        # 2. Fall back to cached CSV
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            grouped = df.groupby("DATA_AS_OF")
            self.frames = []
            for ts, group in sorted(grouped):
                frame = []
                for _, row in group.iterrows():
                    frame.append({
                        "link_id": str(row["LINK_ID"]),
                        "link_name": str(row.get("LINK_NAME", "")),
                        "speed": float(row.get("SPEED", 0)),
                        "travel_time": float(row.get("TRAVEL_TIME", 0)),
                        "status": str(row.get("STATUS", "OK")),
                        "lat": float(row.get("LATITUDE", 0)),
                        "lng": float(row.get("LONGITUDE", 0)),
                    })
                self.frames.append(frame)
            logger.info(f"Loaded {len(self.frames)} frames for {city} from {csv_path}")
        else:
            # 3. Generate synthetic demo data
            logger.warning(f"No API data or CSV for {city}, generating demo data")
            self.frames = self._generate_demo_data(city)

        self.current_frame_idx = 0

    async def _fetch_nyc_live(self) -> list[list[dict]]:
        """Fetch real-time traffic speeds from NYC DOT Traffic Speeds NBE API.
        
        API columns: id, speed, travel_time, status, data_as_of, link_id,
        link_name, link_points, encoded_poly_line, borough, owner, transcom_id.
        NOTE: No latitude/longitude columns — geometry is in link_points
        (space-separated "lat,lng" pairs).
        """
        try:
            params = {
                "$$app_token": self.app_token,
                "$where": NYC_BOROUGH_FILTER,
                "$limit": 5000,
                "$order": "data_as_of DESC",
                "$select": "speed,travel_time,link_id,link_name,data_as_of,link_points,borough",
            }
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(NYC_SPEED_API, params=params)
                resp.raise_for_status()
                records = resp.json()

            if not records:
                logger.warning("NYC API returned 0 records")
                return []

            # Group by data_as_of timestamp to form frames
            from collections import defaultdict
            ts_groups: dict[str, list[dict]] = defaultdict(list)
            for rec in records:
                ts = rec.get("data_as_of", "")
                if ts:
                    ts_groups[ts].append(rec)

            frames = []
            for ts in sorted(ts_groups.keys()):
                frame = []
                for rec in ts_groups[ts]:
                    speed = float(rec.get("speed", 0) or 0)
                    lat, lng = self._parse_link_points(rec.get("link_points", ""))
                    if lat == 0 and lng == 0:
                        continue  # skip records with no geometry

                    frame.append({
                        "link_id": str(rec.get("link_id", "")),
                        "link_name": str(rec.get("link_name", "Unknown")),
                        "speed": round(speed, 1),
                        "travel_time": round(float(rec.get("travel_time", 0) or 0), 2),
                        "status": "BLOCKED" if speed < 2 else "SLOW" if speed < 15 else "OK",
                        "lat": lat,
                        "lng": lng,
                    })
                if frame:
                    frames.append(frame)

            logger.info(f"Fetched {len(records)} records → {len(frames)} frames from NYC DOT API")

            # Cache to CSV for offline use
            try:
                self.data_dir.mkdir(parents=True, exist_ok=True)
                csv_path = self.data_dir / "nyc_link_speed.csv"
                df = pd.DataFrame(records)
                df.to_csv(csv_path, index=False)
                logger.info(f"Cached NYC data to {csv_path}")
            except Exception as e:
                logger.warning(f"Failed to cache CSV: {e}")

            return frames

        except Exception as e:
            logger.warning(f"NYC API fetch failed: {e}, will use fallback")
            return []

    async def _load_chandigarh_csv(self) -> list[list[dict]]:
        """Load Chandigarh feed data from CSV file (NYC-schema format)."""
        csv_path = self.data_dir / "chandigarh_link_speed.csv"
        if not csv_path.exists():
            logger.warning("chandigarh_link_speed.csv not found, will use demo data")
            return []
        try:
            df = pd.read_csv(csv_path)
            from collections import defaultdict
            ts_groups: dict[str, list[dict]] = defaultdict(list)
            for _, row in df.iterrows():
                ts = str(row.get("data_as_of", ""))
                if not ts or ts == "nan":
                    continue
                speed = float(row.get("speed", 0) or 0)
                lat, lng = self._parse_link_points(str(row.get("link_points", "") or ""))
                if lat == 0 and lng == 0:
                    continue
                ts_groups[ts].append({
                    "link_id": str(row.get("link_id", "")),
                    "link_name": str(row.get("link_name", "Unknown")),
                    "speed": round(speed, 1),
                    "travel_time": round(float(row.get("travel_time", 0) or 0), 2),
                    "status": "BLOCKED" if speed < 2 else "SLOW" if speed < 15 else "OK",
                    "lat": lat,
                    "lng": lng,
                })
            frames = [ts_groups[ts] for ts in sorted(ts_groups.keys()) if ts_groups[ts]]
            logger.info(f"Loaded {len(frames)} Chandigarh frames from CSV")
            return frames
        except Exception as e:
            logger.warning(f"Failed to load Chandigarh CSV: {e}")
            return []

    @staticmethod
    def _parse_link_points(link_points: str) -> tuple[float, float]:
        """Extract midpoint lat/lng from link_points string.
        Format: 'lat1,lng1 lat2,lng2 lat3,lng3 ...'
        Returns the midpoint of the polyline for marker placement.
        """
        if not link_points or not link_points.strip():
            return 0.0, 0.0
        try:
            pairs = link_points.strip().split()
            if not pairs:
                return 0.0, 0.0
            # Use midpoint for best marker placement
            mid_idx = len(pairs) // 2
            lat_str, lng_str = pairs[mid_idx].split(",")
            return round(float(lat_str), 6), round(float(lng_str), 6)
        except (ValueError, IndexError):
            return 0.0, 0.0
    
    def _generate_demo_data(self, city: str) -> list[list[dict]]:
        """Generate synthetic demo frames for testing when no CSV exists."""
        if city == "nyc":
            segments = [
                # W 34th St corridor
                {"link_id": "nyc_001", "link_name": "W 34th St (7th-8th Ave)", "lat": 40.7505, "lng": -73.9904},
                {"link_id": "nyc_002", "link_name": "W 34th St (8th-9th Ave)", "lat": 40.7522, "lng": -73.9932},
                {"link_id": "nyc_003", "link_name": "W 34th St (6th-7th Ave)", "lat": 40.7488, "lng": -73.9876},
                {"link_id": "nyc_004", "link_name": "W 34th St (5th-6th Ave)", "lat": 40.7491, "lng": -73.9852},
                {"link_id": "nyc_005", "link_name": "W 34th St (9th-10th Ave)", "lat": 40.7539, "lng": -73.9960},
                # 7th Ave corridor
                {"link_id": "nyc_006", "link_name": "7th Ave (33rd-34th St)", "lat": 40.7498, "lng": -73.9895},
                {"link_id": "nyc_007", "link_name": "7th Ave (34th-35th St)", "lat": 40.7512, "lng": -73.9893},
                {"link_id": "nyc_008", "link_name": "7th Ave (35th-36th St)", "lat": 40.7526, "lng": -73.9892},
                {"link_id": "nyc_009", "link_name": "7th Ave (32nd-33rd St)", "lat": 40.7484, "lng": -73.9897},
                {"link_id": "nyc_010", "link_name": "7th Ave (30th-32nd St)", "lat": 40.7462, "lng": -73.9900},
                # 8th Ave corridor
                {"link_id": "nyc_011", "link_name": "8th Ave (33rd-35th St)", "lat": 40.7515, "lng": -73.9926},
                {"link_id": "nyc_012", "link_name": "8th Ave (35th-37th St)", "lat": 40.7540, "lng": -73.9924},
                {"link_id": "nyc_013", "link_name": "8th Ave (30th-33rd St)", "lat": 40.7490, "lng": -73.9928},
                {"link_id": "nyc_014", "link_name": "8th Ave (37th-40th St)", "lat": 40.7560, "lng": -73.9922},
                # 9th Ave corridor
                {"link_id": "nyc_015", "link_name": "9th Ave (33rd-35th St)", "lat": 40.7532, "lng": -73.9955},
                {"link_id": "nyc_016", "link_name": "9th Ave (35th-38th St)", "lat": 40.7555, "lng": -73.9953},
                {"link_id": "nyc_017", "link_name": "9th Ave (30th-33rd St)", "lat": 40.7508, "lng": -73.9957},
                {"link_id": "nyc_018", "link_name": "9th Ave (38th-42nd St)", "lat": 40.7575, "lng": -73.9951},
                # Broadway corridor
                {"link_id": "nyc_019", "link_name": "Broadway & 34th St", "lat": 40.7484, "lng": -73.9878},
                {"link_id": "nyc_020", "link_name": "Broadway (32nd-34th St)", "lat": 40.7470, "lng": -73.9880},
                {"link_id": "nyc_021", "link_name": "Broadway (34th-36th St)", "lat": 40.7498, "lng": -73.9876},
                {"link_id": "nyc_022", "link_name": "Broadway (36th-40th St)", "lat": 40.7520, "lng": -73.9873},
                # 10th Ave / Hudson Yards
                {"link_id": "nyc_023", "link_name": "10th Ave (41st-43rd St)", "lat": 40.7579, "lng": -73.9980},
                {"link_id": "nyc_024", "link_name": "10th Ave (38th-41st St)", "lat": 40.7552, "lng": -73.9982},
                {"link_id": "nyc_025", "link_name": "10th Ave (34th-38th St)", "lat": 40.7530, "lng": -73.9984},
                {"link_id": "nyc_026", "link_name": "Hudson Yards Access", "lat": 40.7534, "lng": -74.0010},
                # W 42nd St
                {"link_id": "nyc_027", "link_name": "W 42nd St (9th-10th Ave)", "lat": 40.7580, "lng": -73.9939},
                {"link_id": "nyc_028", "link_name": "W 42nd St (8th-9th Ave)", "lat": 40.7577, "lng": -73.9917},
                {"link_id": "nyc_029", "link_name": "W 42nd St (7th-8th Ave)", "lat": 40.7574, "lng": -73.9895},
                {"link_id": "nyc_030", "link_name": "Times Square N (42nd-44th)", "lat": 40.7590, "lng": -73.9860},
                # 6th Ave / Avenue of Americas
                {"link_id": "nyc_031", "link_name": "6th Ave (32nd-34th St)", "lat": 40.7480, "lng": -73.9855},
                {"link_id": "nyc_032", "link_name": "6th Ave (34th-36th St)", "lat": 40.7500, "lng": -73.9853},
                {"link_id": "nyc_033", "link_name": "6th Ave (36th-40th St)", "lat": 40.7522, "lng": -73.9851},
                {"link_id": "nyc_034", "link_name": "6th Ave (40th-42nd St)", "lat": 40.7543, "lng": -73.9849},
                # 5th Ave
                {"link_id": "nyc_035", "link_name": "5th Ave (32nd-34th St)", "lat": 40.7490, "lng": -73.9830},
                {"link_id": "nyc_036", "link_name": "5th Ave (34th-36th St)", "lat": 40.7508, "lng": -73.9828},
                {"link_id": "nyc_037", "link_name": "5th Ave (36th-40th St)", "lat": 40.7530, "lng": -73.9826},
                # Cross streets W 36th-W 40th
                {"link_id": "nyc_038", "link_name": "W 36th St (7th-8th Ave)", "lat": 40.7530, "lng": -73.9910},
                {"link_id": "nyc_039", "link_name": "W 36th St (8th-9th Ave)", "lat": 40.7545, "lng": -73.9938},
                {"link_id": "nyc_040", "link_name": "W 38th St (7th-8th Ave)", "lat": 40.7555, "lng": -73.9910},
                {"link_id": "nyc_041", "link_name": "W 38th St (8th-9th Ave)", "lat": 40.7570, "lng": -73.9938},
                {"link_id": "nyc_042", "link_name": "W 40th St (7th-8th Ave)", "lat": 40.7566, "lng": -73.9908},
                {"link_id": "nyc_043", "link_name": "W 40th St (8th-9th Ave)", "lat": 40.7580, "lng": -73.9936},
                # Penn Station / Garment District
                {"link_id": "nyc_044", "link_name": "W 32nd St (7th-8th Ave)", "lat": 40.7476, "lng": -73.9910},
                {"link_id": "nyc_045", "link_name": "W 30th St (7th-8th Ave)", "lat": 40.7452, "lng": -73.9910},
                {"link_id": "nyc_046", "link_name": "W 30th St (8th-9th Ave)", "lat": 40.7467, "lng": -73.9938},
                # Chelsea
                {"link_id": "nyc_047", "link_name": "W 23rd St (7th-8th Ave)", "lat": 40.7432, "lng": -73.9958},
                {"link_id": "nyc_048", "link_name": "W 23rd St (8th-9th Ave)", "lat": 40.7448, "lng": -73.9986},
                {"link_id": "nyc_049", "link_name": "8th Ave (23rd-28th St)", "lat": 40.7455, "lng": -73.9985},
                {"link_id": "nyc_050", "link_name": "11th Ave (34th-38th St)", "lat": 40.7555, "lng": -74.0040},
            ]
        else:
            segments = [
                # Madhya Marg — main arterial (N-S spine)
                {"link_id": "chd_001", "link_name": "Madhya Marg (Sec 1-4)", "lat": 30.7620, "lng": 76.7775},
                {"link_id": "chd_002", "link_name": "Madhya Marg (Sec 4-8)", "lat": 30.7560, "lng": 76.7780},
                {"link_id": "chd_003", "link_name": "Madhya Marg (Sec 8-11)", "lat": 30.7490, "lng": 76.7785},
                {"link_id": "chd_004", "link_name": "Madhya Marg (Sec 11-17)", "lat": 30.7420, "lng": 76.7790},
                {"link_id": "chd_005", "link_name": "Madhya Marg (Sec 17-22)", "lat": 30.7370, "lng": 76.7792},
                {"link_id": "chd_006", "link_name": "Madhya Marg (Sec 22-26)", "lat": 30.7333, "lng": 76.7794},
                {"link_id": "chd_007", "link_name": "Madhya Marg (Sec 26-30)", "lat": 30.7280, "lng": 76.7796},
                {"link_id": "chd_008", "link_name": "Madhya Marg (Sec 30-35)", "lat": 30.7220, "lng": 76.7798},
                {"link_id": "chd_009", "link_name": "Madhya Marg (Sec 35-43)", "lat": 30.7140, "lng": 76.7800},
                # Jan Marg (E-W)
                {"link_id": "chd_010", "link_name": "Jan Marg (Sec 3-9)", "lat": 30.7554, "lng": 76.7875},
                {"link_id": "chd_011", "link_name": "Jan Marg (Sec 9-15)", "lat": 30.7554, "lng": 76.7950},
                {"link_id": "chd_012", "link_name": "Jan Marg (Sec 15-24)", "lat": 30.7554, "lng": 76.8040},
                {"link_id": "chd_013", "link_name": "Jan Marg (IT Park)", "lat": 30.7270, "lng": 76.8010},
                # Dakshin Marg (S-N)
                {"link_id": "chd_014", "link_name": "Dakshin Marg (Sec 18-20)", "lat": 30.7208, "lng": 76.7876},
                {"link_id": "chd_015", "link_name": "Dakshin Marg (Sec 20-23)", "lat": 30.7260, "lng": 76.7874},
                {"link_id": "chd_016", "link_name": "Dakshin Marg (Sec 23-27)", "lat": 30.7310, "lng": 76.7872},
                {"link_id": "chd_017", "link_name": "Dakshin Marg (Sec 27-33)", "lat": 30.7160, "lng": 76.7870},
                # Vidhya Path
                {"link_id": "chd_018", "link_name": "Vidhya Path (Sec 14-15)", "lat": 30.7516, "lng": 76.7738},
                {"link_id": "chd_019", "link_name": "Vidhya Path (Sec 15-16)", "lat": 30.7516, "lng": 76.7820},
                {"link_id": "chd_020", "link_name": "Vidhya Path (Sec 16-17)", "lat": 30.7516, "lng": 76.7900},
                # Himalaya Marg
                {"link_id": "chd_021", "link_name": "Himalaya Marg (Sec 35-37)", "lat": 30.7258, "lng": 76.7562},
                {"link_id": "chd_022", "link_name": "Himalaya Marg (Sec 37-38)", "lat": 30.7220, "lng": 76.7600},
                {"link_id": "chd_023", "link_name": "Himalaya Marg (Sec 40-43)", "lat": 30.7180, "lng": 76.7640},
                # Purv Marg / Industrial Area
                {"link_id": "chd_024", "link_name": "Purv Marg (Ind Area Phase 1)", "lat": 30.7095, "lng": 76.7905},
                {"link_id": "chd_025", "link_name": "Purv Marg (Ind Area Phase 2)", "lat": 30.7060, "lng": 76.7950},
                # Major chowks
                {"link_id": "chd_026", "link_name": "Sector 17 Chowk", "lat": 30.7412, "lng": 76.7788},
                {"link_id": "chd_027", "link_name": "Tribune Chowk", "lat": 30.7270, "lng": 76.7675},
                {"link_id": "chd_028", "link_name": "PGI Chowk", "lat": 30.7646, "lng": 76.7760},
                {"link_id": "chd_029", "link_name": "Sector 22 Chowk", "lat": 30.7320, "lng": 76.7780},
                {"link_id": "chd_030", "link_name": "IT Park Chowk", "lat": 30.7270, "lng": 76.8010},
                {"link_id": "chd_031", "link_name": "Aroma Light Point", "lat": 30.7315, "lng": 76.7845},
                {"link_id": "chd_032", "link_name": "Piccadily Chowk", "lat": 30.7246, "lng": 76.7621},
                {"link_id": "chd_033", "link_name": "Transport Chowk", "lat": 30.7212, "lng": 76.8040},
                {"link_id": "chd_034", "link_name": "Housing Board Chowk", "lat": 30.7135, "lng": 76.8202},
                {"link_id": "chd_035", "link_name": "Sector 43 ISBT Approach", "lat": 30.7226, "lng": 76.7511},
                {"link_id": "chd_036", "link_name": "Elante Mall Access Road", "lat": 30.7061, "lng": 76.8016},
                {"link_id": "chd_037", "link_name": "Punjab University Gate", "lat": 30.7602, "lng": 76.7681},
                {"link_id": "chd_038", "link_name": "Rose Garden Bypass", "lat": 30.7441, "lng": 76.7813},
                {"link_id": "chd_039", "link_name": "Rock Garden Road", "lat": 30.7523, "lng": 76.8078},
                {"link_id": "chd_040", "link_name": "Sukhna Lake Road", "lat": 30.7311, "lng": 76.7915},
                # Sector connector roads
                {"link_id": "chd_041", "link_name": "Sector 7-8 Road", "lat": 30.7480, "lng": 76.7850},
                {"link_id": "chd_042", "link_name": "Sector 9-10 Road", "lat": 30.7450, "lng": 76.7860},
                {"link_id": "chd_043", "link_name": "Sector 10-11 Road", "lat": 30.7430, "lng": 76.7870},
                {"link_id": "chd_044", "link_name": "Sector 11-12 Road", "lat": 30.7400, "lng": 76.7820},
                {"link_id": "chd_045", "link_name": "Sector 15-16 Road", "lat": 30.7370, "lng": 76.7755},
                {"link_id": "chd_046", "link_name": "Sector 16-17 Road", "lat": 30.7350, "lng": 76.7810},
                {"link_id": "chd_047", "link_name": "Sector 19-20 Road", "lat": 30.7290, "lng": 76.7830},
                {"link_id": "chd_048", "link_name": "Sector 20-21 Road", "lat": 30.7260, "lng": 76.7840},
                {"link_id": "chd_049", "link_name": "Sector 24-25 Service Road", "lat": 30.7185, "lng": 76.7760},
                {"link_id": "chd_050", "link_name": "Sector 32-33 Connector", "lat": 30.7148, "lng": 76.7700},
            ]
        
        frames = []
        base_time = datetime(2024, 3, 15, 8, 0, 0)
        np.random.seed(42)
        
        # Generate 60 frames (5 minutes of data at 5s intervals)
        for i in range(60):
            timestamp = base_time + timedelta(seconds=i * 5)
            frame = []
            for seg in segments:
                # Normal traffic for first 20 frames, then incident on first 2 segments
                if i < 20:
                    speed = np.random.uniform(20, 35)
                    status = "OK"
                elif seg["link_id"] in [segments[0]["link_id"], segments[1]["link_id"]]:
                    # Incident zone — speed drops progressively
                    drop_factor = max(0, 1 - (i - 20) * 0.08)
                    speed = max(0, np.random.uniform(20, 35) * drop_factor)
                    status = "BLOCKED" if speed < 2 else "SLOW" if speed < 15 else "OK"
                else:
                    # Adjacent segments slow down slightly
                    speed = np.random.uniform(12, 25)
                    status = "SLOW" if speed < 15 else "OK"
                
                frame.append({
                    "link_id": seg["link_id"],
                    "link_name": seg["link_name"],
                    "speed": round(speed, 1),
                    "travel_time": round(np.random.uniform(1, 8), 2),
                    "status": status,
                    "lat": seg["lat"],
                    "lng": seg["lng"],
                })
            frames.append(frame)
        
        logger.info(f"Generated {len(frames)} demo frames for {city}")
        return frames
    
    async def start(self, interval: float = 5.0):
        """Start the feed replay loop."""
        if self.is_running:
            return
        
        self.interval = interval
        if not self.frames:
            await self.load_city(self.active_city)
        
        self.is_running = True
        self._task = asyncio.create_task(self._replay_loop())
        logger.info(f"Feed simulator started for {self.active_city} at {interval}s intervals")
    
    async def stop(self):
        """Stop the feed replay loop."""
        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Feed simulator stopped")
    
    async def switch_city(self, city: str):
        """Switch to a different city's feed data."""
        was_running = self.is_running
        await self.stop()
        await self.load_city(city)
        if was_running:
            await self.start(self.interval)
    
    async def _replay_loop(self):
        """Main replay loop — emits one frame per interval."""
        first_iteration = True
        while self.is_running:
            if self.frames:
                idx = self.current_frame_idx % len(self.frames)

                # On wrap-around (not first run): reset detector + optionally refetch
                if idx == 0 and not first_iteration:
                    logger.info("Feed replay loop wrap — firing loop_end callbacks")
                    for cb in self._loop_end_callbacks:
                        try:
                            if asyncio.iscoroutinefunction(cb):
                                await cb()
                            else:
                                cb()
                        except Exception as e:
                            logger.error(f"Loop-end callback error: {e}")
                    # Try to refresh data from NYC API
                    if self.active_city == "nyc" and self.app_token:
                        fresh = await self._fetch_nyc_live()
                        if fresh:
                            self.frames = fresh
                            self.current_frame_idx = 0
                            logger.info(f"Refreshed NYC data: {len(fresh)} frames")

                first_iteration = False
                frame = self.frames[self.current_frame_idx % len(self.frames)]
                self._current_segments = frame
                
                # Notify all callbacks
                for callback in self._callbacks:
                    try:
                        if asyncio.iscoroutinefunction(callback):
                            await callback(frame)
                        else:
                            callback(frame)
                    except Exception as e:
                        logger.error(f"Feed callback error: {e}")
                
                self.current_frame_idx += 1
            
            await asyncio.sleep(self.interval)
