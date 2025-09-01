import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";

const router = Router();

router.get("/generate-parallel", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string) || 14;
    const startX = req.query.startX ? parseInt(req.query.startX as string) : undefined;
    const startY = req.query.startY ? parseInt(req.query.startY as string) : undefined;

    console.log(`Starting tile generation for zoom=${zoom}, from x=${startX}, y=${startY}`);
    await generateTiles(zoom, startX, startY);

    res.send(`Tile generation completed for zoom ${zoom} from x=${startX}, y=${startY}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error starting parallel tile generation.");
  }
});

export default router;
