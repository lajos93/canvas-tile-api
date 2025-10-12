/**
 * API-alapú ellenőrzés, hogy van-e fa az adott tile-ban.
 */
export async function hasTreesInTileViaAPI(
  zoom: number,
  x: number,
  y: number,
  apiBaseUrl: string,
  categoryId?: number
): Promise<boolean> {
  const n = 2 ** zoom;
  const lon_min = (x / n) * 360 - 180;
  const lon_max = ((x + 1) / n) * 360 - 180;
  const lat_rad_min = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const lat_rad_max = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat_min = (lat_rad_min * 180) / Math.PI;
  const lat_max = (lat_rad_max * 180) / Math.PI;

  const centerLat = (lat_min + lat_max) / 2;
  const centerLon = (lon_min + lon_max) / 2;
  const radiusKm = ((lat_max - lat_min) * 111) / 2; // 1 fok ≈ 111 km

  const url = new URL(`${apiBaseUrl}/api/trees/in-radius`);
  url.searchParams.set("lat", centerLat.toString());
  url.searchParams.set("lon", centerLon.toString());
  url.searchParams.set("radius", radiusKm.toFixed(3));
  url.searchParams.set("pageSize", "1");

  if (categoryId) url.searchParams.set("categoryId", categoryId.toString());

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`⚠️ API returned ${res.status}: ${url}`);
      return false;
    }

    const data = await res.json();
    return (data?.total ?? 0) > 0;
  } catch (err) {
    console.error("🌐 Error checking trees in tile via API:", err);
    return false;
  }
}
