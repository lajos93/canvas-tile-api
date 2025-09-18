import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";
import { getLastTileByCoordinates } from "../utils/s3";

const router = Router();

let isStopped = false;

export const shouldStop = () => isStopped;
export const resetStop = () => { isStopped = false; };

// START
// START
router.get("/start", async (req, res) => {
  try {
    if (!req.query.zoom) {
      return res.status(400).json({ error: "Zoom level missing" });
    }

    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) {
      return res.status(400).json({ error: "Invalid zoom level" });
    }

    resetStop();

    let startX = req.query.startX ? parseInt(req.query.startX as string) : undefined;
    let startY = req.query.startY ? parseInt(req.query.startY as string) : undefined;

    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
        console.log(`Resuming from last uploaded tile: x=${startX}, y=${startY}`);
      }
    }

    console.log(`Starting tile processing for zoom=${zoom}, from x=${startX}, y=${startY}`);

    // háttérben futtatjuk
    (async () => {
      try {
        await generateTiles(zoom, startX, startY);
        if (isStopped) {
          console.log("Tile process stopped by user.");
        } else {
          console.log(`Tile process completed for zoom=${zoom}, from x=${startX}, y=${startY}`);
        }
      } catch (err) {
        console.error("Error during tile process:", err);
      }
    })();

    // azonnali válasz
    res.json({
      status: "started",
      zoom,
      startX,
      startY,
      resumedFrom
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting tile process" });
  }
});


// STOP
router.get("/stop", (req, res) => {
  isStopped = true;
  console.log("Tile process STOP requested.");
  res.json({ status: "stop signal sent" });
});

export default router;
