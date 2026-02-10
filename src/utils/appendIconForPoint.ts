import sharp from "sharp";
import { renderTileToBuffer } from "./tileUtils";
import { uploadToS3 } from "./s3/s3Utils";
import { PAYLOAD_URL } from "./config";
import { lat2tile, lon2tile } from "./geoBounds";
import { getCategoryNameById } from "./getCategoryNameById";
import { slugify } from "./slugify";

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

function normalizeZoomLevels(raw?: number[]): number[] {
  // Default zoom levels match the UI options in the app (13–16)
  const fallback = [13, 14, 15, 16];
  if (!Array.isArray(raw) || raw.length === 0) return fallback;

  const parsed = raw
    .map((z) => Number(z))
    .filter((z) => Number.isFinite(z) && z >= 0 && z <= 22);

  return parsed.length > 0 ? parsed : fallback;
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
    // 1) Default tile: all trees → tiles/{z}/{x}/{y}.avif
    try {
      const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, undefined);
      const avifBuffer = await sharp(buffer)
        .resize(256, 256)
        .avif({ quality: 72 })
        .toBuffer();
      const key = `tiles/${z}/${x}/${y}.avif`;
      await uploadToS3(key, avifBuffer, "image/avif");
      updatedCount++;
      updatedKeys.push(key);
    } catch (err) {
      console.error(`[append-icon] Default tile z${z} x${x} y${y} failed:`, err);
    }

    // 2) Category tile (if categoryId and category slug are available)
    if (categoryId != null && categorySlug) {
      try {
        const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, categoryId);
        const avifBuffer = await sharp(buffer)
          .resize(256, 256)
          .avif({ quality: 72 })
          .toBuffer();
        const key = `tiles/category/${categorySlug}/${z}/${x}/${y}.avif`;
        await uploadToS3(key, avifBuffer, "image/avif");
        updatedCount++;
        updatedKeys.push(key);
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

