# SENTINEL — Database Reference

MongoDB database: **`traffic_copilot`**

---

## Collections & Fields

### `incidents`
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto-generated |
| `city` | string | `nyc` \| `chandigarh` |
| `status` | string | `active` \| `resolved` |
| `severity` | string | `low` \| `medium` \| `high` \| `critical` |
| `location` | GeoJSON Point | `{ type: "Point", coordinates: [lng, lat] }` |
| `on_street` | string | Primary street name |
| `cross_street` | string | Cross street name |
| `affected_segment_ids` | string[] | Link IDs from feed |
| `detected_at` | datetime | UTC |
| `resolved_at` | datetime \| null | UTC, null if still active |
| `source` | string | `feed` \| `manual` \| `cctv` |
| `crash_record_id` | string \| null | NYC Open Data collision ID |
| `police_dispatched` | bool | |
| `police_dispatched_by` | string \| null | Operator name |
| `police_dispatched_at` | datetime \| null | UTC |

**Indexes:** `(city, status)`, `location` (2dsphere)

---

### `llm_outputs`
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `version` | string | `v2` |
| `incident_id` | string | Ref → `incidents._id` |
| `signal_retiming` | object | Array of intersections with `name`, `current_ns_green`, `current_ew_green`, `recommended_ns_green`, `recommended_ew_green`, `reasoning` |
| `diversions` | object | Array of routes with `priority`, `name`, `path[]`, `estimated_absorption_pct`, `activate_condition` |
| `alerts.vms` | string | Variable Message Sign text |
| `alerts.radio` | string | Radio broadcast text |
| `alerts.social_media` | string | Social post text |
| `narrative_update` | string | LLM-generated incident narrative |
| `cctv_summary` | string | YOLO/camera analysis summary |
| `sections_present` | string[] | Which sections the LLM returned |
| `created_at` | datetime | UTC |

**Indexes:** `(incident_id)`, `(version, incident_id)`

---

### `feed_snapshots`
| Field | Type | Notes |
|---|---|---|
| `city` | string | |
| `snapshot_time` | datetime | TTL index — expires after 2 hours |
| `incident_id` | string \| null | |
| `segments[]` | array | Each entry: `link_id`, `link_name`, `speed`, `travel_time`, `status` (`free`\|`slow`\|`blocked`), `lat`, `lng` |

**Indexes:** `snapshot_time` (TTL 7200s)

---

### `chat_history`
| Field | Type | Notes |
|---|---|---|
| `incident_id` | string | Ref → `incidents._id` |
| `city` | string | |
| `session_start` | datetime | |
| `messages[]` | array | Each: `role` (`user`\|`assistant`\|`system`), `content`, `timestamp`, `model_used` |

**Indexes:** `(incident_id)`

---

### `cctv_events`
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `version` | string | `v2` |
| `city` | string | |
| `incident_id` | string \| null | |
| `camera_id` | string | e.g. `cam_abc123` |
| `camera_location` | GeoJSON Point | |
| `event_type` | string | `incident_confirmed` \| `congestion` \| `accident` \| `vehicle_stopped` \| `pedestrian_risk` |
| `confidence` | float | 0.0 – 1.0 |
| `detected_at` | datetime | UTC |
| `frame_url` | string \| null | |
| `metadata` | object | `source`, `intersection_name`, `frames_processed` |

**Indexes:** `(city, incident_id)`, `camera_location` (2dsphere), `(event_type, detected_at)`

---

### `congestion_zones`
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `city` | string | |
| `status` | string | `active` \| `cleared` |
| `location` | GeoJSON Point | |
| `detected_at` | datetime | UTC |

**Indexes:** `(city, status)`, `location` (2dsphere), `(detected_at)`

---

### `diversion_routes`
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `city` | string | |
| `blocked_segment_id` | string | |
| `incident_id` | string | |
| `schema_version` | string | |
| `routes[]` | array | Each: `priority`, `name`, `segment_names[]`, `geometry` (GeoJSON LineString), `total_length_km`, `estimated_minutes`, `estimated_extra_minutes`, `estimated_actual_minutes`, `estimated_actual_extra_minutes` |

**Indexes:** `(city, blocked_segment_id)`, `(incident_id, schema_version)`

---

### `signal_baselines`
| Field | Type | Notes |
|---|---|---|
| `city` | string | |
| `intersection_name` | string | |
| `osm_node_id` | int \| null | OpenStreetMap node |
| `lat` | float | |
| `lng` | float | |
| `ns_green_seconds` | int | North-South green phase |
| `ew_green_seconds` | int | East-West green phase |
| `cycle_length_seconds` | int | Full signal cycle |
| `source` | string | `static` \| `survey` \| `adaptive` |

**Indexes:** `(city, intersection_name)`

---

### `intersections`
| Field | Type | Notes |
|---|---|---|
| `city` | string | |
| `name` | string | Intersection label |
| *(additional fields seeded from `data/intersections.py`)* | | |

**Indexes:** `(city, name)`

---

### `road_segments`
| Field | Type | Notes |
|---|---|---|
| `city` | string | |
| `segment_id` | string | |
| *(additional fields seeded from `data/road_segments.py`)* | | |

**Indexes:** `(city, segment_id)`

---

### `user_profiles`
| Field | Type | Notes |
|---|---|---|
| `city` | string | |
| `name` | string | Unique per city |
| *(additional fields from `data/social_users.py`)* | | |

**Indexes:** `(city, name)` unique

---

### `social_alerts`
| Field | Type | Notes |
|---|---|---|
| `city` | string | |
| `published_at` | datetime | UTC |
| `recipients` | string[] | User names |
| *(message/content fields)* | | |

**Indexes:** `(city, published_at)`, `(recipients, published_at)`

---
