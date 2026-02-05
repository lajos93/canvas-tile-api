import { Router, Request, Response } from "express";
import sharp from "sharp";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL } from "../utils/config";
import { lat2tile, lon2tile } from "../utils/geoBounds";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";

const router = Router();

/** Zoom levels for manual single-point tile generation (one tile per level). */
const MANUAL_ZOOM_LEVELS = [7, 8, 9, 10, 11, 12, 13, 14, 15];

/** POST body: manual tile generation by lat, lon, category (no treeId). */
interface GenerateTileBody {
  lat: number;
  lon: number;
  categoryId: number;
}

/** POST body: default-only tile generation (no category). */
interface GenerateTileDefaultBody {
  lat: number;
  lon: number;
}

/**
 * POST /generate-tile
 * Body: { lat, lon, categoryId }
 * Generates one tile per zoom level (10–15) that contains the point:
 * - default tile (all trees): tiles/{z}/{x}/{y}.avif
 * - category tile: tiles/category/{slug}/{z}/{x}/{y}.avif
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as GenerateTileBody;
    const { lat, lon, categoryId } = body;

    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      typeof categoryId !== "number" ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return res.status(400).json({
        error: "Invalid body: lat (-90..90), lon (-180..180), categoryId (number) required",
      });
    }

    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    const categoryName = await getCategoryNameById(categoryId);
    if (!categoryName) {
      return res.status(400).json({ error: `Unknown categoryId: ${categoryId}` });
    }

    const slug = slugify(categoryName);
    let count = 0;

    for (const z of MANUAL_ZOOM_LEVELS) {
      const x = lon2tile(lon, z);
      const y = lat2tile(lat, z);

      // 1) Default tile: all trees → tiles/{z}/{x}/{y}.avif
      try {
        const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, undefined);
        const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
        await uploadToS3(`tiles/${z}/${x}/${y}.avif`, avifBuffer, "image/avif");
        count++;
      } catch (err) {
        console.error(`[generate-tile] Default z${z} x${x} y${y} failed:`, err);
      }

      // 2) Category tile → tiles/category/{slug}/{z}/{x}/{y}.avif
      try {
        const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, categoryId);
        const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
        await uploadToS3(`tiles/category/${slug}/${z}/${x}/${y}.avif`, avifBuffer, "image/avif");
        count++;
      } catch (err) {
        console.error(`[generate-tile] Category z${z} x${x} y${y} failed:`, err);
      }
    }

    res.json({
      ok: true,
      tilesRegenerated: count,
      zoomLevels: MANUAL_ZOOM_LEVELS,
      categoryId,
      categorySlug: slug,
    });
  } catch (err) {
    console.error("[generate-tile]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate tiles",
    });
  }
});

/**
 * POST /generate-tile/default
 * Body: { lat, lon }
 * Generates only default tiles (all trees, no category) for zoom 7–15 at this point.
 */
router.post("/default", async (req: Request, res: Response) => {
  try {
    const body = req.body as GenerateTileDefaultBody;
    const { lat, lon } = body;

    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return res.status(400).json({
        error: "Invalid body: lat (-90..90), lon (-180..180) required",
      });
    }

    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    let count = 0;

    for (const z of MANUAL_ZOOM_LEVELS) {
      const x = lon2tile(lon, z);
      const y = lat2tile(lat, z);

      try {
        const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, undefined);
        const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
        await uploadToS3(`tiles/${z}/${x}/${y}.avif`, avifBuffer, "image/avif");
        count++;
      } catch (err) {
        console.error(`[generate-tile/default] z${z} x${x} y${y} failed:`, err);
      }
    }

    res.json({
      ok: true,
      tilesRegenerated: count,
      zoomLevels: MANUAL_ZOOM_LEVELS,
    });
  } catch (err) {
    console.error("[generate-tile/default]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate default tiles",
    });
  }
});

export default router;
