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
    const minZoom = parseInt(req.query.minZoom as string) || 14;
    const maxZoom = parseInt(req.query.maxZoom as string) || 14;

    console.log(`Starting parallel tile generation for zoom ${minZoom} to ${maxZoom}...`);

    // Queue tile-szintű párhuzamosításhoz
    const queue = new PQueue({ concurrency: 5 }); // max 5 párhuzamos tile

    // Wrapper a meglévő generateTiles hívására, tile-szinten párhuzamosítva
    for (let z = minZoom; z <= maxZoom; z++) {
      queue.add(async () => {
        console.log(`Starting generation for zoom ${z}...`);
        await generateTiles(z, z); // a meglévő függvényt hívjuk
        console.log(`Finished generation for zoom ${z}`);
      });
    }

    // Aszinkron indítás, response azonnal visszamegy
    queue.onIdle().then(() => console.log("All parallel tile generation finished!"));

    res.send(`Parallel tile generation started for zoom levels ${minZoom} to ${maxZoom}. Check logs.`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error starting parallel tile generation.");
  }
});

export default router;
