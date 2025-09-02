// routes/generateParallel.ts
import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";
import { getLastTileByCoordinates } from "../utils/s3";

const router = Router();

router.get("/generate-parallel", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string) || 14;

    // Manuális startX/startY
    let startX = req.query.startX ? parseInt(req.query.startX as string) : undefined;
    let startY = req.query.startY ? parseInt(req.query.startY as string) : undefined;

    // Ha nincs manuálisan megadva, kérdezzük le az utolsó tile-t
    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1; // a következő tile
        console.log(`Resuming from last uploaded tile: x=${startX}, y=${startY}`);
      }
    }

    console.log(`Starting tile generation for zoom=${zoom}, from x=${startX}, y=${startY}`);
    await generateTiles(zoom, startX, startY);

    res.send(`Tile generation completed for zoom ${zoom} from x=${startX}, y=${startY}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error starting parallel tile generation.");
  }
});

export default router;
