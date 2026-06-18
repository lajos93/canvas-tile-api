import { Router } from "express";
import archiver from "archiver";
import sharp from "sharp";
import { renderTileToBuffer } from "../utils/tileUtils";
import {
  getLastTileByCoordinates,
  uploadToS3,
  getS3ObjectStream,
  listS3Objects,
} from "../utils/s3/s3Utils";
import { getLayerProgress } from "../utils/regenerateStatus";

const router = Router();
const payloadUrl = process.env.PAYLOAD_URL!;

/**
 * 🎨 Dynamic PNG render
 */
router.get("/:z/:x/:y.png", async (req, res) => {
  try {
    const { z, x, y } = req.params;
    if (!payloadUrl) {
      return res.status(500).send("PAYLOAD_URL environment variable not set");
    }

    const buffer = await renderTileToBuffer(Number(z), Number(x), Number(y), payloadUrl);
    const png256 = await sharp(buffer).resize(256, 256).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.send(png256);
  } catch (err) {
    console.error("Error rendering tile:", err);
    res.status(500).send("Internal Server Error");
  }
});

/**
 * 📍 Last regenerated tile (from status.json — fast; no full S3 list).
 * Query: ?categoryId=123 (omit for default layer)
 * ?source=s3 falls back to legacy full S3 scan (slow on large buckets).
 */
router.get("/last/:zoom", async (req, res) => {
  try {
    const zoom = parseInt(req.params.zoom);
    if (isNaN(zoom)) return res.status(400).json({ error: "Invalid zoom level" });

    const source = typeof req.query.source === "string" ? req.query.source : "status";
    const categoryRaw = req.query.categoryId;
    const categoryId =
      categoryRaw === undefined || categoryRaw === "null" || categoryRaw === ""
        ? null
        : parseInt(String(categoryRaw), 10);

    if (source !== "s3") {
      const fromStatus = await getLayerProgress(
        zoom,
        categoryId != null && Number.isFinite(categoryId) ? categoryId : null
      );
      if (fromStatus) {
        return res.json({
          zoom,
          x: fromStatus.x,
          y: fromStatus.y,
          source: "status.json",
          updatedAt: fromStatus.updatedAt,
          categoryId: categoryId ?? null,
        });
      }
      return res.status(404).json({
        error: "No regenerate progress in status.json for this zoom/layer",
        hint: "Use ?source=s3 for legacy S3 scan (slow) or run regenerate-region first",
      });
    }

    const lastTile = await getLastTileByCoordinates(
      zoom,
      categoryId != null && Number.isFinite(categoryId) ? String(categoryId) : undefined
    );
    if (!lastTile) return res.status(404).json({ error: "No tiles found in S3" });

    res.json({ zoom, ...lastTile, source: "s3" });
  } catch (err) {
    console.error("Error fetching last tile:", err);
    res.status(500).json({ error: "Error fetching last tile" });
  }
});

/**
 * ⬆️ Test upload (PNG)
 */
router.get("/test-upload", async (_req, res) => {
  try {
    const z = 6, x = 34, y = 42;
    const buffer = await renderTileToBuffer(z, x, y, payloadUrl);
    const png256 = await sharp(buffer).resize(256, 256).png().toBuffer();
    const url = await uploadToS3(`tiles/${z}/${x}/${y}.png`, png256, "image/png");

    res.json({ uploaded: url });
  } catch (err) {
    console.error("Error during test upload:", err);
    res.status(500).json({ error: "Error during test upload" });
  }
});

/**
 * ⬇️ Download all tiles as ZIP
 */
router.get("/download", async (_req, res) => {
  try {
    res.attachment("tiles.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    const keys = await listS3Objects("tiles/");
    for (const key of keys) {
      const stream = await getS3ObjectStream(key);
      if (!stream) continue;

      const entryName = key.replace(/^tiles\//, "");
      if (entryName) archive.append(stream, { name: entryName });
    }

    await archive.finalize();
  } catch (err) {
    console.error("Error creating ZIP:", err);
    res.status(500).send("Error creating ZIP from S3 tiles.");
  }
});

export default router;
