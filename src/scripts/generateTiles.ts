import { generateTilesBase } from "./generateTilesBase";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";
import { updateStatusFile } from "../utils/s3/updateStatusFile";
import { HUNGARY_BOUNDS } from "../utils/geoBounds";

const { MIN_LAT, MAX_LAT, MIN_LON, MAX_LON } = HUNGARY_BOUNDS;

function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function lat2tile(lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

export async function generateTiles(
  zoom: number,
  startX?: number,
  startY?: number,
  categoryId?: number
) {
  const categoryName = categoryId ? await getCategoryNameById(categoryId) : undefined;
  const folderName = categoryName ? slugify(categoryName) : "all";

  await updateStatusFile({
    status: "running",
    startedAt: new Date().toISOString(),
    categoryId,
    zoom,
  });

  const xMin = lon2tile(MIN_LON, zoom);
  const xMax = lon2tile(MAX_LON, zoom);
  const yMin = lat2tile(MAX_LAT, zoom);
  const yMax = lat2tile(MIN_LAT, zoom);

  const tiles = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      if (startX && startY && (x < startX || (x === startX && y < startY))) continue;
      tiles.push({ x, y });
    }
  }

  await generateTilesBase(zoom, categoryId, folderName, tiles);
}
