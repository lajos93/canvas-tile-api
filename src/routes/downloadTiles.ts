import { Router } from "express";
import path from "path";
import fs from "fs";
import archiver from "archiver";

const router = Router();

// /admin/download-tiles
router.get("/download-tiles", async (req, res) => {
  try {
    const tilesFolder = path.resolve("./tiles"); // a lokális tiles mappa
    const zipPath = path.resolve("./tiles.zip");

    // ZIP létrehozása
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`ZIP created: ${archive.pointer()} bytes`);
      res.download(zipPath, "tiles.zip", (err) => {
        if (err) console.error(err);
        fs.unlinkSync(zipPath);
      });
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(output);
    archive.directory(tilesFolder, false); // mappa tartalmát ZIP-be
    await archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating ZIP of tiles.");
  }
});

export default router;
