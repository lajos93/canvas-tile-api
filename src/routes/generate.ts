import { Router } from "express";
import { generateTiles } from "../scripts/generateTiles";
import { generateTilesWithWorkers } from "../scripts/generateTiltesWithWorkers";
import { getLastTileByCoordinates } from "../utils/s3/s3Utils";
import { resetStopSignal, stopSignal, isStopped } from "../utils/stopControl";
import { checkCategoryIcon } from "../utils/checkCategoryIcon";

const router = Router();

// parseInt or undefined helper
function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, bucketName } from "../utils/s3/s3Client";

router.get("/status", async (_req, res) => {
  try {
    const data = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: "status.json",
      })
    );
    const text = await data.Body?.transformToString();
    res.json(JSON.parse(text || "{}"));
  } catch (err) {
    console.error("Error reading status.json:", err);
    res.status(404).json({ error: "status.json not found" });
  }
});

/**
 * classic generator
 */
router.get("/start", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) {
      return res.status(400).json({ error: "Invalid zoom level" });
    }

    resetStopSignal();

    const categoryName = req.query.type as string | undefined;

    if (categoryName) {
      const { ok, error } = checkCategoryIcon(categoryName);
      if (!ok) {
        return res.status(400).json({ error });
      }
    }

    let startX = parseIntOrUndefined(req.query.startX as string);
    let startY = parseIntOrUndefined(req.query.startY as string);
    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom, categoryName);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
      }
    }

    (async () => {
      try {
        await generateTiles(zoom, startX, startY, categoryName);
        console.log(
          isStopped()
            ? "⏹️ Classic process stopped."
            : "✅ Classic process complete."
        );
      } catch (err) {
        console.error("Error during classic generation:", err);
      }
    })();

    res.json({
      status: "started-classic",
      zoom,
      startX,
      startY,
      resumedFrom,
      categoryName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting classic generation" });
  }
});

/**
 * Worker based generator
 */
router.get("/start-workers", async (req, res) => {
  try {
    const zoom = parseInt(req.query.zoom as string);
    if (isNaN(zoom)) {
      return res.status(400).json({ error: "Invalid zoom level" });
    }

    resetStopSignal();

    const categoryName = req.query.type as string | undefined;

    // csak akkor ellenőrzünk ikont, ha van category
    if (categoryName) {
      const { ok, error } = checkCategoryIcon(categoryName);
      if (!ok) {
        return res.status(400).json({ error });
      }
    }

    let startX = parseIntOrUndefined(req.query.startX as string);
    let startY = parseIntOrUndefined(req.query.startY as string);
    let resumedFrom: { x: number; y: number } | undefined;

    if (startX === undefined || startY === undefined) {
      const lastTile = await getLastTileByCoordinates(zoom, categoryName);
      if (lastTile) {
        startX = lastTile.x;
        startY = lastTile.y + 1;
        resumedFrom = { x: startX, y: startY };
      }
    }

    (async () => {
      try {
        await generateTilesWithWorkers(zoom, startX, startY, categoryName);
        console.log(
          isStopped()
            ? "⏹️ Worker process stopped."
            : "✅ Worker process complete."
        );
      } catch (err) {
        console.error("Error during worker generation:", err);
      }
    })();

    res.json({
      status: "started-workers",
      zoom,
      startX,
      startY,
      resumedFrom,
      categoryName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error starting worker generation" });
  }
});

/**
 * ⏹️ Stop sign
 */
router.get("/stop", (_req, res) => {
  stopSignal();
  res.json({ status: "stop signal sent" });
});

export default router;
