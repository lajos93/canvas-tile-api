export const HUNGARY_BOUNDS = {
  MIN_LAT: 45.7,
  MAX_LAT: 48.6,
  MIN_LON: 16.0,
  MAX_LON: 22.9,
};

/** Web mercator: longitude → tile X at zoom z */
export function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

/** Web mercator: latitude → tile Y at zoom z */
export function lat2tile(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

/**
 * Zoom levels used when regenerating tiles for a specific point
 * (e.g. after add-tree or delete-tree).
 *
 * These are aligned with the manual append-icon workflow, which focuses
 * on the more detailed, interactive zooms.
 */
export const REGENERATE_ZOOM_LEVELS = [13, 14, 15, 16];