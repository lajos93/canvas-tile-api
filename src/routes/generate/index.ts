import { Router } from "express";
import { generateTiles } from "../../scripts/generateTiles";
import { generateTilesOptimized } from "../../scripts/generateTilesOptimized";
import { generateTilesWithWorkers } from "../../scripts/generateTiltesWithWorkers";
import { getLastTileByCoordinates } from "../../utils/s3/s3Utils";
import { resetStopSignal, stopSignal, isStopped } from "../../utils/stopControl";
import { checkCategoryIcon } from "../../utils/checkCategoryIcon";

const router = Router();

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * 🧱 Classic generator
 */
router.get("/start", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) return res.status(400).json({ error: "Invalid zoom level" });

    resetStopSignal();
    const categoryId = parseIntOrUndefined(req.query.type as string);

    if (categoryId) {
      const { ok, error } = await checkCategoryIcon(categoryId.toString());
      if (!ok) return res.status(400).json({ error });
    }

    let startX = parseIntOrUndefined(req.query.startX as string);
    let startY = parseIntOrUndefined(req.query.startY as string);
    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom, categoryId?.toString());
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
      }
    }

    (async () => {
      try {
        await generateTiles(zoom, startX, startY, categoryId);
        console.log(
          isStopped() ? "⏹️ Classic stopped" : "✅ Classic complete"
        );
      } catch (err) {
        console.error("Error during classic generation:", err);
      }
    })();

    res.json({ status: "started-classic", zoom, startX, startY, resumedFrom, categoryId });
  } catch (err) {
    res.status(500).json({ error: "Error starting classic generation" });
  }
});

/**
 * ⚡ Optimized generator
 */
router.get("/start-optimized", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) return res.status(400).json({ error: "Invalid zoom level" });

    resetStopSignal();
    const categoryId = parseIntOrUndefined(req.query.type as string);

    (async () => {
      try {
        await generateTilesOptimized(zoom, categoryId);
        console.log(
          isStopped() ? "⏹️ Optimized stopped" : "✅ Optimized complete"
        );
      } catch (err) {
        console.error("Error during optimized generation:", err);
      }
    })();

    res.json({ status: "started-optimized", zoom, categoryId });
  } catch (err) {
    res.status(500).json({ error: "Error starting optimized generation" });
  }
});

/**
 * 🧵 Worker generator
 */
router.get("/start-workers", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) return res.status(400).json({ error: "Invalid zoom level" });

    resetStopSignal();
    const categoryId = parseIntOrUndefined(req.query.type as string);

    (async () => {
      try {
        await generateTilesWithWorkers(zoom, undefined, undefined, categoryId);
        console.log(
          isStopped() ? "⏹️ Worker stopped" : "✅ Worker complete"
        );
      } catch (err) {
        console.error("Error during worker generation:", err);
      }
    })();

    res.json({ status: "started-workers", zoom, categoryId });
  } catch (err) {
    res.status(500).json({ error: "Error starting worker generation" });
  }
});

/**
 * ⏹️ Stop signal
 */
router.get("/stop", (_req, res) => {
  stopSignal();
  res.json({ status: "stop signal sent" });
});

export default router;
