// routes/lastTile.ts
import { Router } from "express";
import { getLastTileFolderForZoom } from "../utils/s3";


const router = Router();

router.get("/last-tile", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) return res.status(400).send({ error: "Missing or invalid 'zoom' query parameter" });

    const lastTile = await getLastTileFolderForZoom(zoom);
    if (!lastTile) return res.json({ message: `No tiles found for zoom ${zoom}` });

    res.json({ lastTile });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Error fetching last tile" });
  }
});

export default router;
