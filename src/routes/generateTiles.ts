import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";

const router = Router();

/* router.get("/generate", async (req, res) => {
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
}); */

router.get("/generate-parallel", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string) || 14; // fix zoom 14
    console.log(`Starting parallel tile generation for zoom ${zoom}...`);

    await generateTiles(zoom, zoom); // már maga a függvény párhuzamosít

    console.log(`Finished generation for zoom ${zoom}`);
    res.send(`Parallel tile generation completed for zoom ${zoom}. Check logs.`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error starting parallel tile generation.");
  }
});


export default router;
