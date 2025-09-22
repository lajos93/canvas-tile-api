import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";
import { getLastTileByCoordinates } from "../utils/s3/s3Utils";
import { stopSignal, resetStopSignal, isStopped } from "../utils/stopControl";

const router = Router();

// START
router.get("/start", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) {
      return res.status(400).json({ error: "Invalid zoom level" });
    }

    resetStopSignal();

    let startX = req.query.startX ? parseInt(req.query.startX as string) : undefined;
    let startY = req.query.startY ? parseInt(req.query.startY as string) : undefined;
    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
      }
    }

    // start the generation in the background
    (async () => {
      try {
        await generateTiles(zoom, startX, startY);
        console.log(isStopped() ? "Tile process stopped." : "Tile process completed.");
      } catch (err) {
        console.error("Error during tile process:", err);
      }
    })();

    res.json({ status: "started", zoom, startX, startY, resumedFrom });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting tile process" });
  }
});

// STOP
router.get("/stop", (_, res) => {
  stopSignal();
  res.json({ status: "stop signal sent" });
});

export default router;
