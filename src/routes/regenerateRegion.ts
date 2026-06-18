import { Router, Request, Response } from "express";
import sharp from "sharp";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL } from "../utils/config";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";

const router = Router();

type TileCoord = { z: number; x: number; y: number };

interface RegenerateRegionLayer {
  /** Omit or null = default all-trees layer */
  categoryId?: number | null;
  tiles: TileCoord[];
}

interface RegenerateRegionBody {
  layers: RegenerateRegionLayer[];
  /** When true, render BLOCK_SIZE×BLOCK_SIZE tile blocks and crop (prevents edge clipping). */
  superTile?: boolean;
  /** Block size (e.g. 3 → 3×3). Defaults to 3 when superTile=true. */
  superTileSize?: number;
}

function tileKey(t: TileCoord): string {
  return `${t.z}/${t.x}/${t.y}`;
}

function dedupeTiles(tiles: TileCoord[]): TileCoord[] {
  const seen = new Set<string>();
  const out: TileCoord[] = [];
  for (const t of tiles) {
    if (typeof t.z !== "number" || typeof t.x !== "number" || typeof t.y !== "number") continue;
    if (t.z < 0 || t.z > 22) continue;
    const key = tileKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ z: t.z, x: t.x, y: t.y });
  }
  return out;
}

async function renderAndUploadOne(
  z: number,
  x: number,
  y: number,
  categoryId: number | null | undefined,
  superTileSize?: number
): Promise<boolean> {
  if (categoryId != null) {
    const categoryName = await getCategoryNameById(categoryId);
    if (!categoryName) {
      console.warn(`[regenerate-region] unknown categoryId=${categoryId} z${z}/${x}/${y}`);
      return false;
    }
    const slug = slugify(categoryName);
    const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, categoryId, superTileSize);
    const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
    await uploadToS3(`tiles/category/${slug}/${z}/${x}/${y}.avif`, avifBuffer, "image/avif");
    return true;
  }

  const buffer = await renderTileToBuffer(z, x, y, PAYLOAD_URL, undefined, superTileSize);
  const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
  await uploadToS3(`tiles/${z}/${x}/${y}.avif`, avifBuffer, "image/avif");
  return true;
}

/**
 * POST /regenerate-region
 * Body: { layers: [{ categoryId?: number|null, tiles: [{ z, x, y }] }] }
 * Synchronous batch regen — waits until all tiles are rendered (admin pending publish).
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as RegenerateRegionBody;
    const rawLayers = body.layers;

    if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
      return res.status(400).json({ error: "Body must include non-empty layers array" });
    }

    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    const layers = rawLayers.map((layer) => ({
      categoryId: layer.categoryId ?? null,
      tiles: dedupeTiles(Array.isArray(layer.tiles) ? layer.tiles : []),
    }));

    const tilesPlanned = layers.reduce((n, l) => n + l.tiles.length, 0);
    if (tilesPlanned === 0) {
      return res.status(400).json({ error: "No valid tiles in layers" });
    }

    const resolvedSuperTileSize =
      typeof body.superTileSize === "number" && body.superTileSize > 1
        ? Math.min(Math.floor(body.superTileSize), 9)
        : body.superTile === true
          ? 3
          : undefined;

    console.log(
      `[regenerate-region] start: ${layers.length} layer(s), ${tilesPlanned} tile(s), superTileSize: ${resolvedSuperTileSize ?? 0}`
    );

    let tilesRegenerated = 0;
    let step = 0;
    const failedTiles: TileCoord[] = [];

    for (const layer of layers) {
      const catLabel = layer.categoryId ?? "default";
      for (const { z, x, y } of layer.tiles) {
        step++;
        if (step % 25 === 0 || step === tilesPlanned) {
          console.log(
            `[regenerate-region] progress ${step}/${tilesPlanned} (${catLabel} z${z}/${x}/${y})`
          );
        }
        try {
          const ok = await renderAndUploadOne(z, x, y, layer.categoryId, resolvedSuperTileSize);
          if (ok) tilesRegenerated++;
          else failedTiles.push({ z, x, y });
        } catch (err) {
          console.error(`[regenerate-region] z${z} x${x} y${y} category=${catLabel} failed:`, err);
          failedTiles.push({ z, x, y });
        }
      }
    }

    console.log(
      `[regenerate-region] done: ${tilesRegenerated}/${tilesPlanned} tiles, failed=${failedTiles.length}`
    );

    res.json({
      ok: failedTiles.length === 0,
      tilesRegenerated,
      tilesPlanned,
      layers: layers.length,
      failedTiles: failedTiles.length > 0 ? failedTiles : undefined,
    });
  } catch (err) {
    console.error("[regenerate-region]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to regenerate region",
    });
  }
});

export default router;
