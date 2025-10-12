import { generateTilesBase } from "./generateTilesBase";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";
import { updateStatusFile } from "../utils/s3/updateStatusFile";
import { PAYLOAD_URL } from "../utils/config";
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

async function fetchAllTrees(categoryId?: number) {
  let all: any[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    let url = `${PAYLOAD_URL}/api/trees?limit=5000&page=${page}`;
    if (categoryId) url += `&where[species.category.id][equals]=${categoryId}`;
    const res = await fetch(url);
    const data = await res.json();
    all.push(...data.docs);
    hasNext = data.hasNextPage;
    page++;
  }

  return all;
}

export async function generateTilesOptimized(zoom: number, categoryId?: number) {
  const categoryName = categoryId ? await getCategoryNameById(categoryId) : undefined;
  const folderName = categoryName ? slugify(categoryName) : "all";

  await updateStatusFile({
    status: "running",
    startedAt: new Date().toISOString(),
    categoryId,
    zoom,
  });

  const trees = await fetchAllTrees(categoryId);
  const tilesMap = new Map<string, { x: number; y: number }>();

  for (const tree of trees) {
    const { lat, lon } = tree;
    if (lat < MIN_LAT || lat > MAX_LAT || lon < MIN_LON || lon > MAX_LON) continue;
    const x = lon2tile(lon, zoom);
    const y = lat2tile(lat, zoom);
    tilesMap.set(`${x}_${y}`, { x, y });
  }

  const tiles = Array.from(tilesMap.values());
  console.log(`🧩 ${tiles.length} tiles will be generated (optimized)`);

  await generateTilesBase(zoom, categoryId, folderName, tiles);
}
