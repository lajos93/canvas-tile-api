import { Router, Request, Response } from "express";
import sharp from "sharp";
import PQueue from "p-queue";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL, TILE_UPLOAD_CONCURRENCY } from "../utils/config";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";
import {
  compareTilesRowMajor,
  filterTilesForResume,
  getLayerProgress,
  setLayerProgress,
  type TileCoord,
} from "../utils/regenerateStatus";

const router = Router();

interface RegenerateRegionLayer {
  categoryId?: number | null;
  tiles: TileCoord[];
}

interface StartAfterCoord {
  z?: number;
  x: number;
  y: number;
  categoryId?: number | null;
}

interface RegenerateRegionBody {
  layers: RegenerateRegionLayer[];
  superTile?: boolean;
  superTileSize?: number;
  /** Read last progress from status.json per layer and skip completed tiles. */
  resume?: boolean;
  /** Manual resume point (overrides status for matching layer when set). */
  startAfter?: StartAfterCoord;
  /** Redo this many tiles before the resume point (overlap for crashed runs). Default 0. */
  resumeBacktrack?: number;
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

function parseStartAfter(raw: unknown): StartAfterCoord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as StartAfterCoord;
  if (typeof o.x !== "number" || typeof o.y !== "number") return null;
  return o;
}

/**
 * POST /regenerate-region
 * Body: { layers, resume?, startAfter?, resumeBacktrack?, superTile?, superTileSize? }
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

    const resume = body.resume === true;
    const manualStartAfter = parseStartAfter(body.startAfter);
    const backtrack =
      typeof body.resumeBacktrack === "number" && body.resumeBacktrack >= 0
        ? Math.floor(body.resumeBacktrack)
        : 0;

    const resolvedSuperTileSize =
      typeof body.superTileSize === "number" && body.superTileSize > 1
        ? Math.min(Math.floor(body.superTileSize), 9)
        : body.superTile === true
          ? 3
          : undefined;

    let totalSkipped = 0;
    let tilesPlanned = 0;
    const layerPlans: Array<{
      categoryId: number | null;
      categorySlug?: string;
      tiles: TileCoord[];
      resumeFrom: TileCoord | null;
    }> = [];

    for (const layer of rawLayers) {
      const categoryId = layer.categoryId ?? null;
      const deduped = dedupeTiles(Array.isArray(layer.tiles) ? layer.tiles : []);
      if (deduped.length === 0) continue;

      const z = deduped[0]!.z;
      let resumePoint: TileCoord | null = null;

      if (manualStartAfter) {
        const matchCategory =
          manualStartAfter.categoryId === undefined ||
          manualStartAfter.categoryId === categoryId;
        if (matchCategory) {
          resumePoint = {
            z: typeof manualStartAfter.z === "number" ? manualStartAfter.z : z,
            x: manualStartAfter.x,
            y: manualStartAfter.y,
          };
        }
      } else if (resume) {
        const saved = await getLayerProgress(z, categoryId);
        if (saved) {
          resumePoint = { z: saved.z, x: saved.x, y: saved.y };
        }
      }

      const { tiles, skipped, resumeFrom } = filterTilesForResume(deduped, resumePoint, backtrack);
      totalSkipped += skipped;
      tilesPlanned += tiles.length;

      let categorySlug: string | undefined;
      if (categoryId != null) {
        const categoryName = await getCategoryNameById(categoryId);
        if (!categoryName) {
          console.warn(`[regenerate-region] unknown categoryId=${categoryId}, skipping layer`);
          continue;
        }
        categorySlug = slugify(categoryName);
      }

      layerPlans.push({ categoryId, categorySlug, tiles, resumeFrom });
    }

    if (tilesPlanned === 0) {
      return res.json({
        ok: true,
        tilesRegenerated: 0,
        tilesPlanned: 0,
        tilesSkipped: totalSkipped,
        layers: layerPlans.length,
        message: "All tiles already completed for this plan (resume)",
      });
    }

    console.log(
      `[regenerate-region] start: ${layerPlans.length} layer(s), ${tilesPlanned} tile(s) (${totalSkipped} skipped resume), superTileSize: ${resolvedSuperTileSize ?? 0}, concurrency: ${TILE_UPLOAD_CONCURRENCY}`
    );

    let tilesRegenerated = 0;
    let completed = 0;
    const failedTiles: TileCoord[] = [];
    const queue = new PQueue({ concurrency: TILE_UPLOAD_CONCURRENCY });
    const statusQueue = new PQueue({ concurrency: 1 });
    const jobs: Array<Promise<void>> = [];

    for (const layer of layerPlans) {
      const catLabel = layer.categoryId ?? "default";
      if (layer.resumeFrom) {
        console.log(
          `[regenerate-region] layer ${catLabel} resume from z${layer.resumeFrom.z}/${layer.resumeFrom.x}/${layer.resumeFrom.y} (${layer.tiles.length} tiles)`
        );
      }

      for (const { z, x, y } of layer.tiles) {
        jobs.push(
          queue.add(async () => {
            try {
              const buffer = await renderTileToBuffer(
                z,
                x,
                y,
                PAYLOAD_URL,
                layer.categoryId ?? undefined,
                resolvedSuperTileSize
              );
              const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
              const s3Key =
                layer.categoryId != null && layer.categorySlug
                  ? `tiles/category/${layer.categorySlug}/${z}/${x}/${y}.avif`
                  : `tiles/${z}/${x}/${y}.avif`;
              await uploadToS3(s3Key, avifBuffer, "image/avif");
              tilesRegenerated++;
              await statusQueue.add(() => setLayerProgress(z, layer.categoryId, { z, x, y }));
            } catch (err) {
              console.error(`[regenerate-region] z${z} x${x} y${y} category=${catLabel} failed:`, err);
              failedTiles.push({ z, x, y });
            } finally {
              completed++;
              if (completed % 50 === 0 || completed === tilesPlanned) {
                console.log(`[regenerate-region] progress ${completed}/${tilesPlanned}`);
              }
            }
          })
        );
      }
    }

    await Promise.all(jobs);

    console.log(
      `[regenerate-region] done: ${tilesRegenerated}/${tilesPlanned} tiles, skipped=${totalSkipped}, failed=${failedTiles.length}`
    );

    res.json({
      ok: failedTiles.length === 0,
      tilesRegenerated,
      tilesPlanned,
      tilesSkipped: totalSkipped,
      layers: layerPlans.length,
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
