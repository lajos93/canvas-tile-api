import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";

const router = Router();

router.get("/generate", async (req, res) => {
  try {
    generateTiles(6, 12); // start asynchronously, don't block
    res.send("Tile generation has started, check logs.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error during tile generation.");
  }
});

export default router;
