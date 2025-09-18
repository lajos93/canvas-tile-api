import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";
import { getLastTileByCoordinates } from "../utils/s3";

const router = Router();

let isStopped = false;

export const shouldStop = () => isStopped;
export const resetStop = () => { isStopped = false; };

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

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        console.log(`Resuming from last uploaded tile: x=${startX}, y=${startY}`);
      }
    }

    console.log(`Starting tile processing for zoom=${zoom}, from x=${startX}, y=${startY}`);
    await generateTiles(zoom, startX, startY);

    if (isStopped) {
      res.json({ status: "stopped" });
    } else {
      res.json({ status: "completed", zoom, startX, startY });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting tile process" });
  }
});

// STOP
router.get("/stop", (req, res) => {
  isStopped = true;
  console.log("Tile process STOP requested.");
  res.send("Tile process stop signal sent.");
});

export default router;
