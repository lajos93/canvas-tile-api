import path from "path";
import sharp from "sharp";
import { renderTileToBuffer, tileBBox } from "./tileUtils";
import { uploadToS3, getS3ObjectBuffer } from "./s3/s3Utils";
import { PAYLOAD_URL } from "./config";
import { lat2tile, lon2tile } from "./geoBounds";
import { getCategoryNameById } from "./getCategoryNameById";
import { slugify } from "./slugify";
import { iconMap } from "./tileIcons";

export interface AppendIconInput {
  lat: number;
  lon: number;
  categoryId?: number;
  zoomLevels?: number[];
}

export interface AppendIconResult {
  tilesUpdated: number;
  zoomLevels: number[];
  categoryId: number | null;
  categorySlug?: string;
  keys: string[];
}

const TILE_SIZE = 256;
const APPEND_ICON_SIZE = 24;

function normalizeZoomLevels(raw?: number[]): number[] {
  // Default zoom levels: z7–z15 (same range as manual tile generation)
  const fallback = [7, 8, 9, 10, 11, 12, 13, 14, 15];
  if (!Array.isArray(raw) || raw.length === 0) return fallback;

  const parsed = raw
    .map((z) => Number(z))
    .filter((z) => Number.isFinite(z) && z >= 0 && z <= 22);

  return parsed.length > 0 ? parsed : fallback;
}

/** Load category icon from assets and resize to iconSize; returns PNG buffer for compositing. */
async function getIconBuffer(categoryId: number, iconSize: number): Promise<Buffer | null> {
  const iconFile = iconMap[String(categoryId)];
  if (!iconFile) return null;
  const iconPath = path.resolve(process.cwd(), "src/assets/icons", iconFile);
  try {
    return await sharp(iconPath).resize(iconSize, iconSize).png().toBuffer();
  } catch {
    return null;
  }
}

/**
 * Composite one icon onto an existing tile image. (lat, lon) is the tree position;
 * bbox is the tile's geo bounds. Returns new AVIF buffer.
 */
async function compositeIconOntoTile(
  tileBuffer: Buffer,
  iconBuffer: Buffer,
  lat: number,
  lon: number,
  bbox: { lon_left: number; lon_right: number; lat_top: number; lat_bottom: number },
  iconSize: number
): Promise<Buffer> {
  const px = ((lon - bbox.lon_left) / (bbox.lon_right - bbox.lon_left)) * TILE_SIZE;
  const py = ((bbox.lat_top - lat) / (bbox.lat_top - bbox.lat_bottom)) * TILE_SIZE;
  const half = iconSize / 2;
  const left = Math.round(px - half);
  const top = Math.round(py - half);
  // No clamp – use true position so appended icon aligns with dynamic overlay (may clip at tile edge)

  return sharp(tileBuffer)
    .composite([{ input: iconBuffer, left, top }])
    .avif({ quality: 72 })
    .toBuffer();
}

/**
 * Try to append one tree icon onto existing tile from S3. Returns new AVIF buffer if successful, null if we should fall back to full render.
 */
async function tryAppendOntoExistingTile(
  key: string,
  lat: number,
  lon: number,
  x: number,
  y: number,
  z: number,
  categoryId: number | undefined
): Promise<Buffer | null> {
  const existingBuffer = await getS3ObjectBuffer(key);
  if (!existingBuffer) return null;
  if (categoryId == null) return null;
  const iconBuffer = await getIconBuffer(categoryId, APPEND_ICON_SIZE);
  if (!iconBuffer) return null;

  const bbox = tileBBox(x, y, z);
  return compositeIconOntoTile(existingBuffer, iconBuffer, lat, lon, bbox, APPEND_ICON_SIZE);
}

export async function appendIconForPoint(input: AppendIconInput): Promise<AppendIconResult> {
  const { lat, lon } = input;
  let { categoryId } = input;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error("Invalid coordinates: lat (-90..90) and lon (-180..180) required");
  }

  if (!PAYLOAD_URL) {
    throw new Error("PAYLOAD_URL environment variable not set");
  }

  const zoomLevels = normalizeZoomLevels(input.zoomLevels);

  let categoryName: string | undefined;
  let categorySlug: string | undefined;

  if (typeof categoryId === "number") {
    categoryName = await getCategoryNameById(categoryId);
    if (!categoryName) {
      console.warn(`[append-icon] Unknown categoryId=${categoryId}, skipping category tiles`);
      categoryId = undefined;
    } else {
      categorySlug = slugify(categoryName);
    }
  }

  const tiles = zoomLevels.map((z) => ({
    z,
    x: lon2tile(lon, z),
    y: lat2tile(lat, z),
  }));

  let updatedCount = 0;
  const updatedKeys: string[] = [];

  for (const { z, x, y } of tiles) {
    // 1) Default tile: all trees → tiles/{z}/{x}/{y}.avif (try append onto existing, else full render)
    try {
      const defaultKey = `tiles/${z}/${x}/${y}.avif`;
      let avifBuffer: Buffer | null = await tryAppendOntoExistingTile(
        defaultKey,
        lat,
        lon,
        x,
        y,
        z,
        categoryId ?? undefined
      );
      if (!avifBuffer) {
        const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, undefined);
        avifBuffer = await sharp(buffer)
          .resize(TILE_SIZE, TILE_SIZE)
          .avif({ quality: 72 })
          .toBuffer();
      }
      await uploadToS3(defaultKey, avifBuffer, "image/avif");
      updatedCount++;
      updatedKeys.push(defaultKey);
    } catch (err) {
      console.error(`[append-icon] Default tile z${z} x${x} y${y} failed:`, err);
    }

    // 2) Category tile (if categoryId and category slug are available)
    if (categoryId != null && categorySlug) {
      try {
        const categoryKey = `tiles/category/${categorySlug}/${z}/${x}/${y}.avif`;
        let avifBuffer: Buffer | null = await tryAppendOntoExistingTile(
          categoryKey,
          lat,
          lon,
          x,
          y,
          z,
          categoryId
        );
        if (!avifBuffer) {
          const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, categoryId);
          avifBuffer = await sharp(buffer)
            .resize(TILE_SIZE, TILE_SIZE)
            .avif({ quality: 72 })
            .toBuffer();
        }
        await uploadToS3(categoryKey, avifBuffer, "image/avif");
        updatedCount++;
        updatedKeys.push(categoryKey);
      } catch (err) {
        console.error(
          `[append-icon] Category tile z${z} x${x} y${y} categoryId=${categoryId} failed:`,
          err
        );
      }
    }
  }

  return {
    tilesUpdated: updatedCount,
    zoomLevels,
    categoryId: categoryId ?? null,
    ...(categorySlug ? { categorySlug } : {}),
    keys: updatedKeys,
  };
}

