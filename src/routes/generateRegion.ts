import { Router, Request, Response } from "express";
import sharp from "sharp";
import PQueue from "p-queue";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL } from "../utils/config";
import { lat2tile, lon2tile } from "../utils/geoBounds";
import { TILE_UPLOAD_CONCURRENCY } from "../utils/config";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";

const router = Router();

const BUDAPEST_ZOOM_LEVELS = [7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Budapest bounding box (approximate). */
const BUDAPEST_BBOX = {
  latMin: 47.43,
  latMax: 47.56,
  lonMin: 18.92,
  lonMax: 19.25,
};

/** POST body: generate tiles for a region (optionally filtered by category). */
interface GenerateRegionBody {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  zoomLevels?: number[];
  categoryId?: number;
}

/**
 * POST /generate-region
 * Body: { latMin, latMax, lonMin, lonMax, zoomLevels?, categoryId? }
 * Generates tiles for every tile that intersects the bbox, for each zoom level.
 * If categoryId is provided, generates category-filtered tiles.
 * Default zoomLevels: 7–15.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as GenerateRegionBody;
    const {
      latMin = BUDAPEST_BBOX.latMin,
      latMax = BUDAPEST_BBOX.latMax,
      lonMin = BUDAPEST_BBOX.lonMin,
      lonMax = BUDAPEST_BBOX.lonMax,
      zoomLevels = BUDAPEST_ZOOM_LEVELS,
      categoryId,
    } = body;

    if (
      typeof latMin !== "number" ||
      typeof latMax !== "number" ||
      typeof lonMin !== "number" ||
      typeof lonMax !== "number" ||
      latMin >= latMax ||
      lonMin >= lonMax
    ) {
      return res.status(400).json({
        error: "Invalid body: latMin < latMax, lonMin < lonMax (numbers) required",
      });
    }

    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    // Validate categoryId if provided
    let categoryName: string | undefined;
    let categorySlug: string | undefined;
    if (categoryId !== undefined) {
      if (typeof categoryId !== "number") {
        return res.status(400).json({ error: "Invalid categoryId: must be a number" });
      }
      categoryName = await getCategoryNameById(categoryId);
      if (!categoryName) {
        return res.status(400).json({ error: `Unknown categoryId: ${categoryId}` });
      }
      categorySlug = slugify(categoryName);
    }

    const levels = Array.isArray(zoomLevels)
      ? zoomLevels.filter((z) => typeof z === "number" && z >= 0 && z <= 22)
      : BUDAPEST_ZOOM_LEVELS;

    const allTiles: { z: number; x: number; y: number }[] = [];
    for (const z of levels) {
      const xMin = lon2tile(lonMin, z);
      const xMax = lon2tile(lonMax, z);
      const yMin = lat2tile(latMax, z); // lat max → y min
      const yMax = lat2tile(latMin, z);  // lat min → y max
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          allTiles.push({ z, x, y });
        }
      }
    }

    res.json({
      ok: true,
      message: "Generation started in background",
      totalTiles: allTiles.length,
      zoomLevels: levels,
      bbox: { latMin, latMax, lonMin, lonMax },
      categoryId: categoryId ?? null,
      categorySlug: categorySlug ?? null,
    });

    const queue = new PQueue({ concurrency: TILE_UPLOAD_CONCURRENCY });
    let count = 0;

    (async () => {
      for (const { z, x, y } of allTiles) {
        queue.add(async () => {
          try {
            const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, categoryId);
            const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
            
            // Upload to category path if categoryId provided, otherwise default path
            const s3Key = categoryId !== undefined && categorySlug
              ? `tiles/category/${categorySlug}/${z}/${x}/${y}.avif`
              : `tiles/${z}/${x}/${y}.avif`;
            
            await uploadToS3(s3Key, avifBuffer, "image/avif");
            count++;
            if (count % 50 === 0) {
              console.log(
                `[generate-region] ${count}/${allTiles.length} tiles${categoryId ? ` (categoryId=${categoryId})` : ""}`
              );
            }
          } catch (err) {
            console.error(`[generate-region] Tile z${z} x${x} y${y} failed:`, err);
          }
        });
      }
      await queue.onIdle();
      console.log(
        `[generate-region] Done. Uploaded ${count} tiles.${categoryId ? ` Category: ${categoryName} (id=${categoryId})` : ""}`
      );
    })();
  } catch (err) {
    console.error("[generate-region]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to start region generation",
    });
  }
});

export default router;
