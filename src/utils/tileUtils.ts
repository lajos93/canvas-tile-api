import path from "path";

import { createCanvas, loadImage, Image } from "canvas";
import { iconMap } from "../utils/tileIcons"; //

export interface Tree {
  lat: number;
  lon: number;
  species?: {
    category?: {
      name: string;
    };
  };
}

// Tile bounding box
export function tileBBox(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon_left = (x / n) * 360 - 180;
  const lon_right = ((x + 1) / n) * 360 - 180;
  const lat_top =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const lat_bottom =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;

  return { lon_left, lon_right, lat_top, lat_bottom };
}

// Fetch trees from Payload CMS
export async function fetchTreesInBBox(
  payloadUrl: string,
  bbox: ReturnType<typeof tileBBox>,
  categoryName?: string
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

    if (categoryName) {
      url += `&where[species.category.name][equals]=${encodeURIComponent(
        categoryName
      )}`;
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Payload API error: ${resp.status} - ${text}`);
    }

    const data = await resp.json();
    allDocs.push(...data.docs);
    hasNext = data.hasNextPage;
    page++;
  }

  return allDocs;
}

// cache for loaded icons
const iconCache: Record<string, Image> = {};

// Draw trees on canvas
export async function drawTreesOnCanvas(
  trees: Tree[],
  bbox: ReturnType<typeof tileBBox>
) {
  const tileSize = 256;
  const canvas = createCanvas(tileSize, tileSize);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, tileSize, tileSize);

  for (const tree of trees) {
    const px =
      ((tree.lon - bbox.lon_left) / (bbox.lon_right - bbox.lon_left)) *
      tileSize;
    const py =
      ((bbox.lat_top - tree.lat) / (bbox.lat_top - bbox.lat_bottom)) * tileSize;

    const categoryName = tree.species?.category?.name;
    const iconFile = categoryName ? iconMap[categoryName] : undefined;

    if (iconFile) {
      if (!iconCache[iconFile]) {
        const iconPath = path.resolve(__dirname, "../assets/icons", iconFile);
        iconCache[iconFile] = await loadImage(iconPath);
      }
      const icon = iconCache[iconFile];
      const size = 16; // icon size in px
      ctx.drawImage(icon, px - size / 2, py - size / 2, size, size);
    } else {
      // fallback: green dot
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  return canvas;
}

// High-level: render full tile buffer
export async function renderTileToBuffer(
  z: number,
  x: number,
  y: number,
  payloadUrl: string,
  categoryName?: string
): Promise<Buffer> {
  const bbox = tileBBox(x, y, z);
  const trees = await fetchTreesInBBox(payloadUrl, bbox, categoryName);
  const canvas = await drawTreesOnCanvas(trees, bbox);
  return canvas.toBuffer();
}
