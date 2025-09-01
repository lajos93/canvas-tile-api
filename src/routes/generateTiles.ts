import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";

const router = Router();

router.get("/generate", async (req, res) => {
  try {
    // Parse query params
    const minZoomQuery = parseInt(req.query.minZoom as string);
    const maxZoomQuery = parseInt(req.query.maxZoom as string);

    // default value
    let minZoom = 6;
    let maxZoom = 12;

    // if the query params are valid numbers, override the defaults
    if (!isNaN(minZoomQuery)) minZoom = minZoomQuery;
    if (!isNaN(maxZoomQuery)) maxZoom = maxZoomQuery;

    // Call the tile generation function
    generateTiles(minZoom, maxZoom);

    res.send(`Tile generation started for zoom levels ${minZoom} to ${maxZoom}. Check logs.`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error during tile generation.");
  }
});

export default router;
