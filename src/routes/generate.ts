import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";
import { generateTilesWithWorkers } from "../scripts/generateTiltesWithWorkers";
import { getLastTileByCoordinates } from "../utils/s3/s3Utils";
import { resetStopSignal, stopSignal, isStopped } from "../utils/stopControl";

const router = Router();

// parseInt or undefined helper
function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * classic generator
 */
router.get("/start", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) {
      return res.status(400).json({ error: "Invalid zoom level" });
    }

    resetStopSignal();

    let startX = parseIntOrUndefined(req.query.startX as string);
    let startY = parseIntOrUndefined(req.query.startY as string);
    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
      }
    }

    const categoryName = req.query.type as string | undefined;

    (async () => {
      try {
        await generateTiles(zoom, startX, startY, categoryName);
        console.log(
          isStopped() ? "⏹️ Classic process stopped." : "✅ Classic process complete."
        );
      } catch (err) {
        console.error("Error during classic generation:", err);
      }
    })();

    res.json({ status: "started-classic", zoom, startX, startY, resumedFrom, categoryName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting classic generation" });
  }
});

/**
 * Worker based generator
 */
router.get("/start-workers", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) {
      return res.status(400).json({ error: "Invalid zoom level" });
    }

    resetStopSignal();

    let startX = parseIntOrUndefined(req.query.startX as string);
    let startY = parseIntOrUndefined(req.query.startY as string);
    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
      }
    }

    const categoryName = req.query.type as string | undefined;

    (async () => {
      try {
        await generateTilesWithWorkers(zoom, startX, startY, categoryName);
        console.log(
          isStopped() ? "⏹️ Worker process stopped." : "✅ Worker process complete."
        );
      } catch (err) {
        console.error("Error during worker generation:", err);
      }
    })();

    res.json({ status: "started-workers", zoom, startX, startY, resumedFrom, categoryName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting worker generation" });
  }
});

/**
 * ⏹️ Stop jelzés
 */
router.get("/stop", (_req, res) => {
  stopSignal();
  res.json({ status: "stop signal sent" });
});

export default router;
