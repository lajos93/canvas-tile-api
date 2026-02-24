import { Router, Request, Response } from "express";
import { appendIconForPoint } from "../utils/appendIconForPoint";

const router = Router();

interface AppendIconBody {
  lat: number;
  lon: number;
  categoryId?: number;
  zoomLevels?: number[];
}

/**
 * POST /append-icon
 *
 * Body: { lat, lon, categoryId?, zoomLevels? }
 *
 * Conceptually this "appends" a tree icon to the tiles that contain
 * the given point. In practice we re-render the affected tiles using
 * the normal tile rendering pipeline:
 *
 * - default tile (all trees)      → tiles/{z}/{x}/{y}.avif
 * - category tile (if categoryId) → tiles/category/{slug}/{z}/{x}/{y}.avif
 *
 * The clustering / grouping logic is handled inside renderTileToBuffer:
 * when a new tree has been saved in Payload, regenerating the tile
 * automatically increases the cluster count or creates a new icon at
 * the appropriate zoom level.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as AppendIconBody;
    console.log("[append-icon] request body:", {
      lat: body.lat,
      lon: body.lon,
      categoryId: body.categoryId,
      zoomLevels: body.zoomLevels,
    });
    const result = await appendIconForPoint({
      lat: body.lat,
      lon: body.lon,
      categoryId: body.categoryId,
      zoomLevels: body.zoomLevels,
    });

    console.log(
      `[append-icon] success: ${result.tilesUpdated} tiles updated, zoomLevels: [${result.zoomLevels.join(", ")}]`
    );
    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("[append-icon]", err);
    return res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : "Failed to append icon / regenerate tiles",
    });
  }
});

export default router;

