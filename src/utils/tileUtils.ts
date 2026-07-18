import { createCanvas } from "canvas";
import { loadCategoryIconImage, preloadAllCategoryIcons } from "./categoryIcons";
import { scaledIconSize, type IconScaleByZoom } from "./tileIconScale";

export interface Tree {
  id?: number;
  createdAt?: string;
  lat: number;
  lon: number;
  species?: {
    category?: {
      id: number;
      name: string;
    };
  };
}

export type PublishCutoff = {
  createdAt: string;
  treeId: number;
};

function treeWithinPublishCutoff(doc: Tree, cutoff: PublishCutoff): boolean {
  const id = typeof doc.id === "number" ? doc.id : Number(doc.id);
  if (!Number.isFinite(id)) return false;
  const created = doc.createdAt ? new Date(doc.createdAt) : new Date(NaN);
  const cutoffCreated = new Date(cutoff.createdAt);
  if (Number.isNaN(created.getTime()) || Number.isNaN(cutoffCreated.getTime())) return false;
  if (created.getTime() < cutoffCreated.getTime()) return true;
  if (created.getTime() > cutoffCreated.getTime()) return false;
  return id <= cutoff.treeId;
}

// Tile bounding box
export function tileBBox(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon_left = (x / n) * 360 - 180;
  const lon_right = ((x + 1) / n) * 360 - 180;
  const lat_top = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const lat_bottom = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { lon_left, lon_right, lat_top, lat_bottom };
}

/** Web Mercator max latitude (EPSG:3857 / Leaflet). */
const MERCATOR_MAX_LAT = 85.05112878;

/** Web Mercator normalized Y in [0, 1] (north → 0). Matches Leaflet CRS.EPSG3857. */
export function latToMercatorY(lat: number): number {
  const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const latRad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
}

export type TileGeoBBox = {
  lon_left: number;
  lon_right: number;
  lat_top: number;
  lat_bottom: number;
};

/**
 * Project lon/lat into pixel space for a tile (or super-tile) bbox.
 * Lon→X is linear (correct for Web Mercator). Lat→Y uses Mercator Y, not linear
 * latitude — so baked icons align with Leaflet markers. Works for single tiles
 * and N×N super-tile blocks whose bbox spans multiple tile indices.
 */
export function latLonToPixel(
  lat: number,
  lon: number,
  bbox: TileGeoBBox,
  tileSize: number
): { px: number; py: number } {
  const px = ((lon - bbox.lon_left) / (bbox.lon_right - bbox.lon_left)) * tileSize;
  const yTop = latToMercatorY(bbox.lat_top);
  const yBottom = latToMercatorY(bbox.lat_bottom);
  const py = ((latToMercatorY(lat) - yTop) / (yBottom - yTop)) * tileSize;
  return { px, py };
}

/**
 * Expand a tile bbox in all directions by a pixel margin (converted to lat/lon).
 * This lets us fetch trees that live just outside the tile, so that icons/clusters
 * which cross tile borders can be drawn on neighbouring tiles as well.
 *
 * We still render using the ORIGINAL tile bbox, so coordinates stay consistent.
 */
export function expandTileBBoxForMargin(
  bbox: ReturnType<typeof tileBBox>,
  pixelMargin: number,
  renderSize: number
) {
  const lonPerPx = (bbox.lon_right - bbox.lon_left) / renderSize;
  const latPerPx = (bbox.lat_top - bbox.lat_bottom) / renderSize;

  const lon_left = bbox.lon_left - lonPerPx * pixelMargin;
  const lon_right = bbox.lon_right + lonPerPx * pixelMargin;
  const lat_top = bbox.lat_top + latPerPx * pixelMargin;
  const lat_bottom = bbox.lat_bottom - latPerPx * pixelMargin;

  return {
    lon_left: Math.max(-180, Math.min(180, lon_left)),
    lon_right: Math.max(-180, Math.min(180, lon_right)),
    lat_top: Math.max(-90, Math.min(90, lat_top)),
    lat_bottom: Math.max(-90, Math.min(90, lat_bottom)),
  };
}

/**
 * Fetches trees inside a tile bounding box from the Payload API.
 * If categoryId is provided, filters by that category.
 */

async function fetchJsonWithRetry(url: string, maxRetries: number = 3): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Payload API error: ${resp.status} - ${text}`);
      }
      return await resp.json();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[tileUtils] fetchJsonWithRetry attempt ${attempt}/${maxRetries} failed for ${url}: ${msg}`
      );
      if (attempt === maxRetries) break;
      // Simple linear backoff to avoid hammering the API
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchTreesInBBox(
  payloadUrl: string,
  bbox: ReturnType<typeof tileBBox>,
  categoryId?: number,
  publishCutoff?: PublishCutoff
): Promise<Tree[]> {
  let allDocs: Tree[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    let url =
      `${payloadUrl}/api/trees?limit=5000&page=${page}` +
      `&where[lat][greater_than_equal]=${bbox.lat_bottom}` +
      `&where[lat][less_than_equal]=${bbox.lat_top}` +
      `&where[lon][greater_than_equal]=${bbox.lon_left}` +
      `&where[lon][less_than_equal]=${bbox.lon_right}`;

    if (categoryId) {
      url += `&where[species.category.id][equals]=${categoryId}`;
    }

    const data = await fetchJsonWithRetry(url);
    const docs = (data.docs ?? []) as Tree[];
    allDocs.push(...(publishCutoff ? docs.filter((d) => treeWithinPublishCutoff(d, publishCutoff)) : docs));
    hasNext = data.hasNextPage;
    page++;
  }

  return allDocs;
}

async function drawCategoryIconAt(
  ctx: any,
  categoryId: number | undefined,
  centerX: number,
  centerY: number,
  size: number,
  fallbackRadius: number
) {
  if (categoryId == null) {
    ctx.fillStyle = "green";
    ctx.beginPath();
    ctx.arc(centerX, centerY, fallbackRadius, 0, 2 * Math.PI);
    ctx.fill();
    return;
  }

  const icon = await loadCategoryIconImage(categoryId);
  if (icon) {
    const half = size / 2;
    ctx.drawImage(icon as any, centerX - half, centerY - half, size, size);
    return;
  }

  ctx.fillStyle = "green";
  ctx.beginPath();
  ctx.arc(centerX, centerY, fallbackRadius, 0, 2 * Math.PI);
  ctx.fill();
}

/** Render at 2x resolution (512) then downscale to 256 for crisper icons. */
const RENDER_SCALE = 2;
const OUTPUT_SIZE = 256;
const RENDER_SIZE = OUTPUT_SIZE * RENDER_SCALE; // 512

/** Zoom ≤ 14: full clustering. Zoom 15: hybrid (cluster only when count ≥ this). */
const CLUSTER_ZOOM_MAX = 14;
const CLUSTER_ZOOM15_DENSE_THRESHOLD = 5;
const CLUSTER_GRID_CELL = 64; // px on 512 canvas for z ≤ 12 → 8×8 grid
const CLUSTER_GRID_CELL_Z13_14 = 96; // coarser for z 13–14 → fewer clusters
const CLUSTER_GRID_CELL_Z15 = 64; // for z 15 hybrid

/** Pixel gutter so icons centered on tile edges are not clipped (constant memory vs huge super-tiles). */
export function iconBleedPixels(z: number, iconScaleByZoom?: IconScaleByZoom): number {
  if (z >= 16) {
    return Math.ceil(scaledIconSize(72 + (z - 15) * 12, z, iconScaleByZoom) / 2) + 8;
  }
  if (z === 15) {
    return Math.ceil(scaledIconSize(36, 15, iconScaleByZoom) / 2) + 8;
  }
  return Math.ceil(scaledIconSize(44, z, iconScaleByZoom) / 2) + 10;
}

function cropCanvasRegion(
  source: ReturnType<typeof createCanvas>,
  sx: number,
  sy: number,
  size: number
): Buffer {
  const out = createCanvas(size, size);
  out.getContext("2d")!.drawImage(source as any, sx, sy, size, size, 0, 0, size, size);
  return out.toBuffer();
}

interface Cluster {
  cx: number;
  cy: number;
  categoryId: number | undefined;
  count: number;
  trees?: Tree[]; // set when z === 15 for hybrid draw
}

function clusterTrees(
  trees: Tree[],
  bbox: ReturnType<typeof tileBBox>,
  tileSize: number,
  z: number
): Cluster[] {
  const cellSize =
    z === 15 ? CLUSTER_GRID_CELL_Z15 : z === 13 || z === 14 ? CLUSTER_GRID_CELL_Z13_14 : CLUSTER_GRID_CELL;
  const storeTrees = z === 15;
  const map = new Map<
    string,
    { lons: number[]; lats: number[]; categoryId: number | undefined; trees?: Tree[] }
  >();

  for (const tree of trees) {
    const { px, py } = latLonToPixel(tree.lat, tree.lon, bbox, tileSize);
    const gx = Math.floor(px / cellSize);
    const gy = Math.floor(py / cellSize);
    const categoryId = tree.species?.category?.id;
    const key = `${gx},${gy},${categoryId ?? "n"}`;

    if (!map.has(key))
      map.set(key, {
        lons: [],
        lats: [],
        categoryId: categoryId ?? undefined,
        ...(storeTrees && { trees: [] }),
      });
    const entry = map.get(key)!;
    entry.lons.push(tree.lon);
    entry.lats.push(tree.lat);
    if (storeTrees && entry.trees) entry.trees.push(tree);
  }

  const clusters: Cluster[] = [];
  for (const entry of map.values()) {
    const meanLon = entry.lons.reduce((a, b) => a + b, 0) / entry.lons.length;
    const meanLat = entry.lats.reduce((a, b) => a + b, 0) / entry.lats.length;
    const { px: cx, py: cy } = latLonToPixel(meanLat, meanLon, bbox, tileSize);
    clusters.push({
      cx,
      cy,
      categoryId: entry.categoryId,
      count: entry.lons.length,
      ...(entry.trees && { trees: entry.trees }),
    });
  }
  return clusters;
}

// draw trees on a canvas (default: 512x512 for supersampling, caller resizes to 256)
export async function drawTreesOnCanvas(
  trees: Tree[],
  bbox: ReturnType<typeof tileBBox>,
  z: number,
  tileSize: number = RENDER_SIZE,
  iconScaleByZoom?: IconScaleByZoom,
  iconBleedPx = 0
) {
  const bleed = Math.max(0, Math.floor(iconBleedPx));
  const canvas = createCanvas(tileSize + 2 * bleed, tileSize + 2 * bleed);
  const ctx = canvas.getContext("2d");
  if (bleed > 0) ctx.translate(bleed, bleed);
  ctx.clearRect(-bleed, -bleed, tileSize + 2 * bleed, tileSize + 2 * bleed);

  ctx.imageSmoothingEnabled = true;

  const useClustering = z <= CLUSTER_ZOOM_MAX;

  if (useClustering && trees.length > 0) {
    // z 7–14: one icon per cluster + count badge
    const clusters = clusterTrees(trees, bbox, tileSize, z);
    const clusterIconSize = scaledIconSize(44, z, iconScaleByZoom);
    const half = clusterIconSize / 2;

    for (const cluster of clusters) {
      // Icon position centered on cluster (no clamp – true position so tile aligns with dynamic overlay)
      const drawX = cluster.cx - half;
      const drawY = cluster.cy - half;

      await drawCategoryIconAt(
        ctx,
        cluster.categoryId,
        cluster.cx,
        cluster.cy,
        clusterIconSize,
        8
      );

      // Count badge: only show number when count > 1 (never show "1")
      if (cluster.count > 1) {
        const badgeR = 14;

        // Badge position relative to cluster; for super-tile the large canvas coordinates are used.
        const badgeX = drawX + clusterIconSize - 4;
        const badgeY = drawY + 4;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeR, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#333";
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = cluster.count > 99 ? "99+" : String(cluster.count);
        ctx.fillText(label, badgeX, badgeY);
      }
    }
    return canvas;
  }

  // z 15: hybrid – cluster only when dense (count ≥ 5), else draw trees individually
  if (z === 15 && trees.length > 0) {
    const clusters = clusterTrees(trees, bbox, tileSize, 15);
    const clusterIconSize = scaledIconSize(26, 15, iconScaleByZoom);
    const halfIcon = clusterIconSize / 2;
    const iconSizeSingle = scaledIconSize(36, 15, iconScaleByZoom);

    for (const cluster of clusters) {
      if (cluster.count >= CLUSTER_ZOOM15_DENSE_THRESHOLD && cluster.trees) {
        const drawX = cluster.cx - halfIcon;
        const drawY = cluster.cy - halfIcon;
        await drawCategoryIconAt(
          ctx,
          cluster.categoryId,
          cluster.cx,
          cluster.cy,
          clusterIconSize,
          8
        );
        const badgeX = drawX + clusterIconSize - 4;
        const badgeY = drawY + 4;
        const badgeR = 14;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeR, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#333";
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = cluster.count > 99 ? "99+" : String(cluster.count);
        ctx.fillText(label, badgeX, badgeY);
      } else if (cluster.trees) {
        for (const tree of cluster.trees) {
          const { px, py } = latLonToPixel(tree.lat, tree.lon, bbox, tileSize);
          await drawCategoryIconAt(
            ctx,
            tree.species?.category?.id,
            px,
            py,
            iconSizeSingle,
            4
          );
        }
      }
    }
    return canvas;
  }

  // z ≥ 16: draw every tree individually
  for (const tree of trees) {
    const { px, py } = latLonToPixel(tree.lat, tree.lon, bbox, tileSize);

    const size = scaledIconSize(72 + (z - 15) * 12, z, iconScaleByZoom);
    await drawCategoryIconAt(ctx, tree.species?.category?.id, px, py, size, 4);
  }

  return canvas;
}

// high-level: render tile buffer
// superTileSize: when > 1, render a BLOCK_SIZE×BLOCK_SIZE multi-tile block and crop (smoother clusters across edges);
// when undefined or ≤ 1, render single tile only (faster).
export async function renderTileToBuffer(
  z: number,
  x: number,
  y: number,
  payloadUrl: string,
  categoryId?: number,
  superTileSize?: number,
  iconScaleByZoom?: IconScaleByZoom,
  publishCutoff?: PublishCutoff
): Promise<Buffer> {
  await preloadAllCategoryIcons();

  const BLOCK_SIZE =
    typeof superTileSize === "number" && superTileSize > 1 ? Math.floor(superTileSize) : 0;

  if (!BLOCK_SIZE) {
    const bbox = tileBBox(x, y, z);
    const bleed = iconBleedPixels(z, iconScaleByZoom);
    const fetchBBox = expandTileBBoxForMargin(bbox, bleed, RENDER_SIZE);
    const trees = await fetchTreesInBBox(payloadUrl, fetchBBox, categoryId, publishCutoff);
    const canvas = await drawTreesOnCanvas(trees, bbox, z, RENDER_SIZE, iconScaleByZoom, bleed);
    if (bleed > 0) {
      return cropCanvasRegion(canvas, bleed, bleed, RENDER_SIZE);
    }
    return canvas.toBuffer();
  }

  const blockX = Math.floor(x / BLOCK_SIZE) * BLOCK_SIZE;
  const blockY = Math.floor(y / BLOCK_SIZE) * BLOCK_SIZE;

  const topLeft = tileBBox(blockX, blockY, z);
  const bottomRight = tileBBox(blockX + BLOCK_SIZE - 1, blockY + BLOCK_SIZE - 1, z);
  const blockBBox = {
    lon_left: topLeft.lon_left,
    lon_right: bottomRight.lon_right,
    lat_top: topLeft.lat_top,
    lat_bottom: bottomRight.lat_bottom,
  };

  if (x === blockX && y === blockY) {
    console.log(
      `[super-tile] z${z} ${BLOCK_SIZE}×${BLOCK_SIZE} block (${blockX},${blockY}) canvas=${RENDER_SIZE * BLOCK_SIZE}x${RENDER_SIZE * BLOCK_SIZE}`
    );
  }

  const blockRenderSize = RENDER_SIZE * BLOCK_SIZE;
  const bleed = iconBleedPixels(z, iconScaleByZoom);
  const fetchBBox = expandTileBBoxForMargin(blockBBox, bleed, blockRenderSize);
  const trees = await fetchTreesInBBox(payloadUrl, fetchBBox, categoryId, publishCutoff);
  const bigCanvas = await drawTreesOnCanvas(
    trees,
    blockBBox,
    z,
    blockRenderSize,
    iconScaleByZoom,
    bleed
  );

  const offsetX = (x - blockX) * RENDER_SIZE;
  const offsetY = (y - blockY) * RENDER_SIZE;

  return cropCanvasRegion(bigCanvas, bleed + offsetX, bleed + offsetY, RENDER_SIZE);
}
