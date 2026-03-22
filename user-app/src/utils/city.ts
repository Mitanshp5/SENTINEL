export type CityCode = 'nyc' | 'chandigarh';

export const normalizeCityCode = (value: unknown): CityCode | null => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (
    v === 'nyc' ||
    v === 'new york' ||
    v === 'new york city' ||
    v === 'new_york' ||
    v === 'new-york' ||
    v === 'manhattan'
  ) {
    return 'nyc';
  }
  if (v === 'chandigarh' || v === 'chd' || v === 'tri-city' || v === 'tricity') {
    return 'chandigarh';
  }
  return null;
};

export const inferCityFromCoordinates = (lat: unknown, lng: unknown): CityCode | null => {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;

  // NYC bounding envelope
  if (latN >= 40.4 && latN <= 41.1 && lngN >= -74.35 && lngN <= -73.55) return 'nyc';
  // Chandigarh / Tricity envelope
  if (latN >= 30.55 && latN <= 30.9 && lngN >= 76.65 && lngN <= 76.95) return 'chandigarh';

  return null;
};

export const inferCityFromStreet = (street: unknown): CityCode | null => {
  const s = String(street || '').toLowerCase();
  if (!s) return null;
  if (
    s.includes('sector') ||
    s.includes('marg') ||
    s.includes('chowk') ||
    s.includes('tribune') ||
    s.includes('jan marg') ||
    s.includes('madhya') ||
    s.includes('himalaya')
  ) {
    return 'chandigarh';
  }
  if (
    s.includes('ave') ||
    s.includes('avenue') ||
    s.includes('st') ||
    s.includes('street') ||
    s.includes('broadway') ||
    s.includes('manhattan')
  ) {
    return 'nyc';
  }
  return null;
};

export const inferIncidentCity = (incident: any): CityCode | null => {
  const explicit = normalizeCityCode(incident?.city);
  const lng = incident?.location?.coordinates?.[0] ?? incident?.location?.lng;
  const lat = incident?.location?.coordinates?.[1] ?? incident?.location?.lat;
  const coord = inferCityFromCoordinates(lat, lng);
  const street = inferCityFromStreet(incident?.on_street || incident?.location_str);
  // Coordinate bounds are strongest when present.
  if (coord) return coord;
  // If city label conflicts with street naming and we have no coordinates,
  // prefer the street signal to avoid cross-city leaks in UI.
  if (street && explicit && street !== explicit) return street;
  return explicit ?? street ?? null;
};
