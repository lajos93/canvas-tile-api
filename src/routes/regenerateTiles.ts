import { Router, Request, Response } from "express";
import sharp from "sharp";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL } from "../utils/config";
import { lat2tile, lon2tile, REGENERATE_ZOOM_LEVELS } from "../utils/geoBounds";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";

const router = Router();

/** Tree from Payload API (minimal shape for category) */
interface TreeDoc {
  id: number;
  species?: number | { id: number; category?: number | { id: number; name?: string } };
}

/** POST body: called by app after adding a new tree, after deleting one, or for admin "regenerate at point" */
interface RegenerateBody {
  treeId?: number;
  lat: number;
  lon: number;
  /** Optional zoom levels to regenerate (default: REGENERATE_ZOOM_LEVELS or env) */
  zoomLevels?: number[];
  /** When true, render 5×5 super-tile and crop center (icons at edges not cut off) */
  superTile?: boolean;
  /** When set, also regenerate tiles/category/{slug}/ for this category (e.g. from admin filter or target) */
  categoryId?: number;
}

function parseZoomLevels(): number[] {
  const raw = process.env.REGENERATE_ZOOM_LEVELS;
  if (!raw) return REGENERATE_ZOOM_LEVELS;
  const parsed = raw.split(",").map((s) => parseInt(s.trim(), 10));
  return parsed.filter((z) => !isNaN(z) && z >= 0 && z <= 22);
}

/** Fetch tree from Payload to get species.category.id */
async function fetchTreeCategoryId(treeId: number): Promise<number | undefined> {
  const url = `${PAYLOAD_URL}/api/trees/${treeId}?depth=2`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const doc = (await res.json()) as TreeDoc;
  const species = doc.species;
  if (typeof species === "number") return undefined;
  const category = species?.category;
  if (typeof category === "number") return category;
  return category?.id;
}

/**
 * POST /regenerate-tiles
 * Body: { treeId, lat, lon }
 * Regenerates only the tiles that contain this point (at configured zoom levels),
 * for both the default "all trees" tile and the tree's category tile.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as RegenerateBody;
    console.log(
      "[regenerate-tiles] request body:",
      JSON.stringify({
        treeId: body.treeId,
        lat: body.lat,
        lon: body.lon,
        zoomLevels: body.zoomLevels,
        superTile: body.superTile,
        categoryId: body.categoryId,
      })
    );
    const { treeId, lat, lon } = body;
    const useSuperTile = body.superTile === true;

    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return res.status(400).json({
        error: "Invalid body: lat (-90..90), lon (-180..180) required; treeId optional",
      });
    }

    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    const rawCat = body.categoryId;
    const categoryIdFromBody =
      typeof rawCat === "number" && !Number.isNaN(rawCat)
        ? rawCat
        : typeof rawCat === "string" && rawCat !== ""
          ? Number(rawCat)
          : undefined;
    const categoryId =
      typeof categoryIdFromBody === "number" && !Number.isNaN(categoryIdFromBody)
        ? categoryIdFromBody
        : typeof treeId === "number"
          ? await fetchTreeCategoryId(treeId)
          : undefined;
    const zoomLevels =
      Array.isArray(body.zoomLevels) && body.zoomLevels.length > 0
        ? body.zoomLevels.filter((z) => typeof z === "number" && z >= 7 && z <= 15)
        : parseZoomLevels();
    const zoomLevelsToUse = zoomLevels.length > 0 ? zoomLevels : parseZoomLevels();

    const tiles: { z: number; x: number; y: number }[] = [];
    for (const z of zoomLevelsToUse) {
      const x = lon2tile(lon, z);
      const y = lat2tile(lat, z);
      tiles.push({ z, x, y });
    }

    let count = 0;

    for (const { z, x, y } of tiles) {
      // Full regen only (no append): redraw tile from Payload, then upload.
      // 1) Default tile: all trees → tiles/{z}/{x}/{y}.avif
      try {
        const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, undefined, useSuperTile);
        const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
        const key = `tiles/${z}/${x}/${y}.avif`;
        await uploadToS3(key, avifBuffer, "image/avif");
        count++;
      } catch (err) {
        console.error(`[regenerate-tiles] Default tile z${z} x${x} y${y} failed:`, err);
      }

      // 2) Category tile (when categoryId from body or from treeId) → tiles/category/{slug}/{z}/{x}/{y}.avif
      if (categoryId != null) {
        try {
          const categoryName = await getCategoryNameById(categoryId);
          if (categoryName) {
            const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, categoryId, useSuperTile);
            const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
            const slug = slugify(categoryName);
            const key = `tiles/category/${slug}/${z}/${x}/${y}.avif`;
            await uploadToS3(key, avifBuffer, "image/avif");
            count++;
          }
        } catch (err) {
          console.error(
            `[regenerate-tiles] Category tile z${z} x${x} y${y} categoryId=${categoryId} failed:`,
            err
          );
        }
      }
    }

    console.log(
      `[regenerate-tiles] success: ${count} tiles, zoomLevels: [${zoomLevelsToUse.join(", ")}], superTile: ${useSuperTile}, categoryId: ${categoryId ?? "—"}`
    );
    res.json({ ok: true, tilesRegenerated: count, zoomLevels: zoomLevelsToUse, categoryId: categoryId ?? null });
  } catch (err) {
    console.error("[regenerate-tiles]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to regenerate tiles",
    });
  }
});

export default router;
