import { Router, Request, Response } from "express";
import sharp from "sharp";
import PQueue from "p-queue";
import { renderTileToBuffer, type PublishCutoff } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL, TILE_UPLOAD_CONCURRENCY } from "../utils/config";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";
import { parseIconScaleByZoom, type IconScaleByZoom } from "../utils/tileIconScale";
import {
  compareTilesRowMajor,
  filterTilesForResume,
  getAllFailedTiles,
  getLayerProgress,
  recordTileResults,
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
  /**
   * Re-render only tiles persisted in the failed-tile store (status.json).
   * Ignores `layers`/`resume`/`startAfter`; on success tiles are removed from
   * the store so repeated calls converge to zero remaining failures.
   */
  retryFailed?: boolean;
  /** Manual resume point (overrides status for matching layer when set). */
  startAfter?: StartAfterCoord;
  /** Redo this many tiles before the resume point (overlap for crashed runs). Default 0. */
  resumeBacktrack?: number;
  /** Per-zoom icon size multiplier (e.g. { "16": 0.7, "17": 0.7 }). */
  iconScaleByZoom?: IconScaleByZoom;
  /** 1-based index when the client splits a large plan into multiple requests. */
  chunkIndex?: number;
  /** Total chunk count for the same admin region run. */
  chunkTotal?: number;
  /** Only draw trees at or before this admin publish cutoff. */
  publishCutoff?: PublishCutoff;
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
    const retryFailed = body.retryFailed === true;

    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    let rawLayers: RegenerateRegionLayer[] = Array.isArray(body.layers) ? body.layers : [];

    if (retryFailed) {
      const stored = await getAllFailedTiles();
      rawLayers = stored.map((s) => ({ categoryId: s.categoryId, tiles: s.tiles }));
      const totalStored = stored.reduce((n, l) => n + l.tiles.length, 0);
      console.log(
        `[regenerate-region] retryFailed: ${totalStored} tile(s) across ${stored.length} layer(s)`
      );
      if (rawLayers.length === 0) {
        return res.json({
          ok: true,
          tilesRegenerated: 0,
          tilesPlanned: 0,
          tilesSkipped: 0,
          layers: 0,
          failedTilesRemaining: 0,
          message: "No failed tiles to retry",
        });
      }
    }

    if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
      return res.status(400).json({ error: "Body must include non-empty layers array" });
    }

    // retryFailed always re-renders the exact stored tiles — never skip via resume.
    const resume = !retryFailed && body.resume === true;
    const manualStartAfter = retryFailed ? null : parseStartAfter(body.startAfter);
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
    const iconScaleByZoom = parseIconScaleByZoom(body.iconScaleByZoom);
    const chunkIndex =
      typeof body.chunkIndex === "number" && body.chunkIndex >= 1
        ? Math.floor(body.chunkIndex)
        : null;
    const chunkTotal =
      typeof body.chunkTotal === "number" && body.chunkTotal >= 1
        ? Math.floor(body.chunkTotal)
        : null;
    const publishCutoff =
      body.publishCutoff &&
      typeof body.publishCutoff.createdAt === "string" &&
      typeof body.publishCutoff.treeId === "number"
        ? body.publishCutoff
        : undefined;
    const chunkLabel =
      chunkIndex != null && chunkTotal != null ? `${chunkIndex}/${chunkTotal}` : null;

    if (chunkIndex === 1 && chunkTotal != null) {
      console.log(`[regenerate-region] ${chunkTotal} chunk(s) planned`);
    }

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
      chunkLabel
        ? `[regenerate-region] chunk ${chunkLabel} start: ${tilesPlanned} tile(s) (${totalSkipped} skipped resume), superTileSize: ${resolvedSuperTileSize ?? 0}`
        : `[regenerate-region] start: ${layerPlans.length} layer(s), ${tilesPlanned} tile(s) (${totalSkipped} skipped resume), superTileSize: ${resolvedSuperTileSize ?? 0}, concurrency: ${TILE_UPLOAD_CONCURRENCY}`
    );

    let tilesRegenerated = 0;
    let completed = 0;
    const failedTiles: TileCoord[] = [];
    const succeededResults: Array<{ categoryId: number | null; tile: TileCoord }> = [];
    const failedResults: Array<{ categoryId: number | null; tile: TileCoord }> = [];
    const perZoomDone = new Map<number, number>();
    const perZoomFailed = new Map<number, number>();
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
                resolvedSuperTileSize,
                iconScaleByZoom,
                publishCutoff
              );
              const avifBuffer = await sharp(buffer).resize(256, 256).avif({ quality: 72 }).toBuffer();
              const s3Key =
                layer.categoryId != null && layer.categorySlug
                  ? `tiles/category/${layer.categorySlug}/${z}/${x}/${y}.avif`
                  : `tiles/${z}/${x}/${y}.avif`;
              await uploadToS3(s3Key, avifBuffer, "image/avif");
              tilesRegenerated++;
              perZoomDone.set(z, (perZoomDone.get(z) ?? 0) + 1);
              succeededResults.push({ categoryId: layer.categoryId, tile: { z, x, y } });
              await statusQueue.add(() => setLayerProgress(z, layer.categoryId, { z, x, y }));
            } catch (err) {
              console.error(`[regenerate-region] z${z} x${x} y${y} category=${catLabel} failed:`, err);
              failedTiles.push({ z, x, y });
              failedResults.push({ categoryId: layer.categoryId, tile: { z, x, y } });
              perZoomFailed.set(z, (perZoomFailed.get(z) ?? 0) + 1);
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

    // Persist the run outcome: clear tiles that just succeeded from the failed
    // store, add the ones that just failed. Enables `retryFailed` later.
    const resultsByCat = new Map<number | null, { succeeded: TileCoord[]; failed: TileCoord[] }>();
    for (const { categoryId, tile } of succeededResults) {
      const entry = resultsByCat.get(categoryId) ?? { succeeded: [], failed: [] };
      entry.succeeded.push(tile);
      resultsByCat.set(categoryId, entry);
    }
    for (const { categoryId, tile } of failedResults) {
      const entry = resultsByCat.get(categoryId) ?? { succeeded: [], failed: [] };
      entry.failed.push(tile);
      resultsByCat.set(categoryId, entry);
    }
    let failedTilesRemaining: number | undefined;
    try {
      await recordTileResults(
        Array.from(resultsByCat.entries()).map(([categoryId, v]) => ({
          categoryId,
          succeeded: v.succeeded,
          failed: v.failed,
        }))
      );
      const remaining = await getAllFailedTiles();
      failedTilesRemaining = remaining.reduce((n, l) => n + l.tiles.length, 0);
    } catch (err) {
      console.error("[regenerate-region] failed to persist failed-tile store:", err);
    }

    console.log(
      chunkLabel
        ? `[regenerate-region] chunk ${chunkLabel} done: ${tilesRegenerated}/${tilesPlanned} tiles, failed=${failedTiles.length}`
        : `[regenerate-region] done: ${tilesRegenerated}/${tilesPlanned} tiles, skipped=${totalSkipped}, failed=${failedTiles.length}`
    );

    const allZooms = Array.from(
      new Set<number>([...perZoomDone.keys(), ...perZoomFailed.keys()])
    ).sort((a, b) => a - b);
    const zoomSummary = allZooms
      .map((z) => {
        const done = perZoomDone.get(z) ?? 0;
        const failed = perZoomFailed.get(z) ?? 0;
        return failed > 0 ? `z${z}: ${done} ok / ${failed} failed` : `z${z}: ${done} ok`;
      })
      .join(", ");
    const fullyDone = failedTiles.length === 0;
    const banner = fullyDone ? "✅ FULLY DONE" : "⚠️ DONE WITH FAILURES";
    const scopeLabel = chunkLabel ? `chunk ${chunkLabel}` : "region run";
    console.log(
      `[regenerate-region] ${banner} — ${scopeLabel}: ${tilesRegenerated}/${tilesPlanned} tiles, failed=${failedTiles.length}` +
        (failedTilesRemaining != null ? `, stored-failures=${failedTilesRemaining}` : "") +
        `\n[regenerate-region] zoom levels — ${zoomSummary || "none"}`
    );

    res.json({
      ok: failedTiles.length === 0,
      tilesRegenerated,
      tilesPlanned,
      tilesSkipped: totalSkipped,
      layers: layerPlans.length,
      failedTiles: failedTiles.length > 0 ? failedTiles : undefined,
      failedTilesRemaining,
    });
  } catch (err) {
    console.error("[regenerate-region]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to regenerate region",
    });
  }
});

export default router;
