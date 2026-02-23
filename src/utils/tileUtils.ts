import path from "path";
import { createCanvas, loadImage, Image } from "canvas";
import { iconMap } from "../utils/tileIcons";

export interface Tree {
  lat: number;
  lon: number;
  species?: {
    category?: {
      id: number;
      name: string;
    };
  };
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
  categoryId?: number
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
    allDocs.push(...data.docs);
    hasNext = data.hasNextPage;
    page++;
  }

  return allDocs;
}

// cache for loaded icons
const iconCache: Record<string, Image> = {};

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
    const px = ((tree.lon - bbox.lon_left) / (bbox.lon_right - bbox.lon_left)) * tileSize;
    const py = ((bbox.lat_top - tree.lat) / (bbox.lat_top - bbox.lat_bottom)) * tileSize;
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
    const cx =
      ((entry.lons.reduce((a, b) => a + b, 0) / entry.lons.length - bbox.lon_left) /
        (bbox.lon_right - bbox.lon_left)) *
      tileSize;
    const cy =
      ((bbox.lat_top - entry.lats.reduce((a, b) => a + b, 0) / entry.lats.length) /
        (bbox.lat_top - bbox.lat_bottom)) *
      tileSize;
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
  tileSize: number = RENDER_SIZE
) {
  const canvas = createCanvas(tileSize, tileSize);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, tileSize, tileSize);

  ctx.imageSmoothingEnabled = true;

  const useClustering = z <= CLUSTER_ZOOM_MAX;

  if (useClustering && trees.length > 0) {
    // z 7–14: one icon per cluster + count badge
    const clusters = clusterTrees(trees, bbox, tileSize, z);
    const clusterIconSize = 44; // one larger icon per cluster on (super-)tile canvas
    const half = clusterIconSize / 2;

    for (const cluster of clusters) {
      // Icon position centered on cluster
      const rawDrawX = cluster.cx - half;
      const rawDrawY = cluster.cy - half;
      // Clamp to the (super-)tile canvas edge with a small margin so icons are not cut off at tile borders.
      const edgeMargin = clusterIconSize * 0.5;
      const drawX = Math.max(
        edgeMargin,
        Math.min(tileSize - clusterIconSize - edgeMargin, rawDrawX)
      );
      const drawY = Math.max(
        edgeMargin,
        Math.min(tileSize - clusterIconSize - edgeMargin, rawDrawY)
      );

      if (cluster.categoryId != null) {
        const iconFile = iconMap[String(cluster.categoryId)];
        if (iconFile) {
          if (!iconCache[iconFile]) {
            const iconPath = path.resolve(process.cwd(), "src/assets/icons", iconFile);
            iconCache[iconFile] = await loadImage(iconPath);
          }
          ctx.drawImage(iconCache[iconFile], drawX, drawY, clusterIconSize, clusterIconSize);
        } else {
          ctx.fillStyle = "green";
          ctx.beginPath();
          ctx.arc(cluster.cx, cluster.cy, 8, 0, 2 * Math.PI);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "green";
        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, 8, 0, 2 * Math.PI);
        ctx.fill();
      }

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
    // Zoom 15: use slightly smaller icons (60% of the previous size)
    const clusterIconSize = 26; // ~60% of 44
    const halfIcon = clusterIconSize / 2;
    const iconSizeSingle = 36; // ~60% of 60 for single tree at z 15
    const halfSingle = iconSizeSingle / 2;

    for (const cluster of clusters) {
      if (cluster.count >= CLUSTER_ZOOM15_DENSE_THRESHOLD && cluster.trees) {
        // Same principle: clamp to the large canvas with a small edge margin.
        const rawDrawX = cluster.cx - halfIcon;
        const rawDrawY = cluster.cy - halfIcon;
        const edgeMargin = clusterIconSize * 0.5;
        const drawX = Math.max(
          edgeMargin,
          Math.min(tileSize - clusterIconSize - edgeMargin, rawDrawX)
        );
        const drawY = Math.max(
          edgeMargin,
          Math.min(tileSize - clusterIconSize - edgeMargin, rawDrawY)
        );
        const categoryId = cluster.categoryId;
        const iconFile = categoryId ? iconMap[String(categoryId)] : undefined;
        if (iconFile) {
          if (!iconCache[iconFile]) {
            const iconPath = path.resolve(process.cwd(), "src/assets/icons", iconFile);
            iconCache[iconFile] = await loadImage(iconPath);
          }
          ctx.drawImage(iconCache[iconFile], drawX, drawY, clusterIconSize, clusterIconSize);
        } else {
          ctx.fillStyle = "green";
          ctx.beginPath();
          ctx.arc(cluster.cx, cluster.cy, 8, 0, 2 * Math.PI);
          ctx.fill();
        }
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
          const px = ((tree.lon - bbox.lon_left) / (bbox.lon_right - bbox.lon_left)) * tileSize;
          const py = ((bbox.lat_top - tree.lat) / (bbox.lat_top - bbox.lat_bottom)) * tileSize;
          const categoryId = tree.species?.category?.id;
          const iconFile = categoryId ? iconMap[String(categoryId)] : undefined;
          if (iconFile) {
            if (!iconCache[iconFile]) {
              const iconPath = path.resolve(process.cwd(), "src/assets/icons", iconFile);
              iconCache[iconFile] = await loadImage(iconPath);
            }
            const rawDrawX = px - halfSingle;
            const rawDrawY = py - halfSingle;
            const edgeMargin = iconSizeSingle * 0.5;
            const drawX = Math.max(
              edgeMargin,
              Math.min(tileSize - iconSizeSingle - edgeMargin, rawDrawX)
            );
            const drawY = Math.max(
              edgeMargin,
              Math.min(tileSize - iconSizeSingle - edgeMargin, rawDrawY)
            );
            ctx.drawImage(iconCache[iconFile], drawX, drawY, iconSizeSingle, iconSizeSingle);
          } else {
            ctx.fillStyle = "green";
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
      }
    }
    return canvas;
  }

  // z ≥ 16: draw every tree individually
  for (const tree of trees) {
    const px = ((tree.lon - bbox.lon_left) / (bbox.lon_right - bbox.lon_left)) * tileSize;
    const py = ((bbox.lat_top - tree.lat) / (bbox.lat_top - bbox.lat_bottom)) * tileSize;

    const categoryId = tree.species?.category?.id;
    const iconFile = categoryId ? iconMap[String(categoryId)] : undefined;

    if (iconFile) {
      if (!iconCache[iconFile]) {
        const iconPath = path.resolve(process.cwd(), "src/assets/icons", iconFile);
        iconCache[iconFile] = await loadImage(iconPath);
      }
      const icon = iconCache[iconFile];

      const size = 72 + (z - 15) * 12;
      const half = size / 2;
      const rawDrawX = px - half;
      const rawDrawY = py - half;
      const edgeMargin = size * 0.5;
      const drawX = Math.max(
        edgeMargin,
        Math.min(tileSize - size - edgeMargin, rawDrawX)
      );
      const drawY = Math.max(
        edgeMargin,
        Math.min(tileSize - size - edgeMargin, rawDrawY)
      );

      ctx.drawImage(icon, drawX, drawY, size, size);
    } else {
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  return canvas;
}

// high-level: render tile buffer
// useSuperTile: when true, render 10×10 block and crop (smoother clusters across edges); when false, render single tile only (faster).
export async function renderTileToBuffer(
  z: number,
  x: number,
  y: number,
  payloadUrl: string,
  categoryId?: number,
  useSuperTile: boolean = false
): Promise<Buffer> {
  if (!useSuperTile) {
    // Single-tile: fetch and render only this tile's bbox (faster, no cross-tile clustering).
    const bbox = tileBBox(x, y, z);
    const trees = await fetchTreesInBBox(payloadUrl, bbox, categoryId);
    const canvas = await drawTreesOnCanvas(trees, bbox, z, RENDER_SIZE);
    return canvas.toBuffer();
  }

  // Super-tile: render a larger block then crop to the requested tile so cluster bubbles and counts continue across neighbouring tiles.
  const BLOCK_SIZE = 10; // 10×10 tiles per super-tile

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
      `[super-tile] start z${z} blockX=${blockX}..${
        blockX + BLOCK_SIZE - 1
     } blockY=${blockY}..${blockY + BLOCK_SIZE - 1} (canvas=${RENDER_SIZE * BLOCK_SIZE}x${
        RENDER_SIZE * BLOCK_SIZE
      })`
    );
  }

  const trees = await fetchTreesInBBox(payloadUrl, blockBBox, categoryId);
  const blockRenderSize = RENDER_SIZE * BLOCK_SIZE;
  const bigCanvas = await drawTreesOnCanvas(trees, blockBBox, z, blockRenderSize);

  const tileCanvas = createCanvas(RENDER_SIZE, RENDER_SIZE);
  const ctx = tileCanvas.getContext("2d");
  const offsetX = (x - blockX) * RENDER_SIZE;
  const offsetY = (y - blockY) * RENDER_SIZE;
  ctx.drawImage(
    bigCanvas,
    offsetX,
    offsetY,
    RENDER_SIZE,
    RENDER_SIZE,
    0,
    0,
    RENDER_SIZE,
    RENDER_SIZE
  );

  return tileCanvas.toBuffer();
}
