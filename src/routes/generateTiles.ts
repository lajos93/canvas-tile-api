import { Router } from "express";
import PQueue from "p-queue";
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

router.get("/generate-parallel", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string) || 14; // fix zoom 14
    console.log(`Starting parallel tile generation for zoom ${zoom}...`);

    const queue = new PQueue({ concurrency: 5 }); // max 5 párhuzamos tile

    // Wrapper a meglévő generateTiles hívására, tile-szinten párhuzamosítva
    queue.add(async () => {
      console.log(`Starting generation for zoom ${zoom}...`);
      await generateTiles(zoom, zoom); // a meglévő függvényt hívjuk
      console.log(`Finished generation for zoom ${zoom}`);
    });

    queue.onIdle().then(() => console.log("All parallel tile generation finished!"));

    res.send(`Parallel tile generation started for zoom ${zoom}. Check logs.`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error starting parallel tile generation.");
  }
});

export default router;
