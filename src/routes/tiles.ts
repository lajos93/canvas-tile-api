import { Router } from "express";
import { tileBBox, fetchTreesInBBox, drawTreesOnCanvas } from "../utils/utils";

const router = Router();

router.get("/:z/:x/:y.png", async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const payloadUrl = process.env.PAYLOAD_URL;
    if (!payloadUrl) return res.status(500).send("PAYLOAD_URL environment variable not set");

    const bbox = tileBBox(Number(x), Number(y), Number(z));
    const trees = await fetchTreesInBBox(payloadUrl, bbox);
    const canvas = drawTreesOnCanvas(trees, bbox);

    res.setHeader("Content-Type", "image/png");
    res.send(canvas.toBuffer());
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
