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
    resetStop();
    const zoom = parseInt(req.query.zoom as string) || 14;

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
      res.send("Tile process was stopped manually.");
    } else {
      res.send(`Tile process completed for zoom ${zoom} from x=${startX}, y=${startY}`);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error starting tile process.");
  }
});

// STOP
router.get("/stop", (req, res) => {
  isStopped = true;
  console.log("Tile process STOP requested.");
  res.send("Tile process stop signal sent.");
});

export default router;
