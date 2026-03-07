import { Router, Request, Response } from "express";
import { CopyObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, bucketName } from "../utils/s3/s3Client";
import { listS3Objects, listS3CommonPrefixes } from "../utils/s3/s3Utils";

const router = Router();

const BACKUP_PREFIX = "backup/";

/** Backup folder name: date + time (YYYY-MM-DD_HH-mm-ss) for easy navigation. */
function getBackupFolderName(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/** POST body: zoom levels to include in backup (e.g. [7,8,9,10,11,12]) */
interface BackupBody {
  zoomLevels: number[];
}

/**
 * List all tile keys (default + category) for the given zoom levels.
 * Keys: tiles/{z}/{x}/{y}.avif or tiles/category/{slug}/{z}/{x}/{y}.avif
 */
async function listTileKeysForZooms(zoomLevels: number[]): Promise<string[]> {
  const zoomSet = new Set(zoomLevels);
  const allKeys: string[] = [];

  // Default tiles: tiles/{z}/{x}/{y}.avif (avoid push(...keys) – huge arrays cause stack overflow)
  for (const z of zoomLevels) {
    const prefix = `tiles/${z}/`;
    console.log("[backup] Listing default tiles zoom", z, "…");
    const keys = await listS3Objects(prefix);
    console.log("[backup] Zoom", z, ":", keys.length, "keys");
    for (const k of keys) allKeys.push(k);
  }

  // Category tiles: list only slugs (folders), then for each slug only the requested zoom levels
  const keysBeforeCategory = allKeys.length;
  const categoryPrefix = "tiles/category/";
  console.log("[backup] Listing category slugs…");
  const categorySlugPrefixes = await listS3CommonPrefixes(categoryPrefix);
  console.log("[backup] Category slugs:", categorySlugPrefixes.length);
  for (const slugPrefix of categorySlugPrefixes) {
    // slugPrefix = "tiles/category/alma/" etc.
    for (const z of zoomLevels) {
      const prefix = `${slugPrefix}${z}/`;
      const keys = await listS3Objects(prefix);
      for (const k of keys) allKeys.push(k);
    }
  }
  console.log("[backup] Category tiles (selected zooms):", allKeys.length - keysBeforeCategory);

  return allKeys;
}

/**
 * POST /backup
 * Body: { zoomLevels: number[] }
 * Copies all tiles at the given zoom levels to backup/{backupId}/tiles/... (same structure).
 * Creates backup/{backupId}/status.json with backupId, createdAt, zoomLevels, tileCountByZoom.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as BackupBody;
    const zoomLevels = Array.isArray(body.zoomLevels) ? body.zoomLevels : [];
    const validZooms = zoomLevels.filter((z) => Number.isInteger(z) && z >= 0 && z <= 22);

    console.log("[backup] Request received, zoom levels:", validZooms.join(", ") || "(none)");

    if (validZooms.length === 0) {
      console.log("[backup] Rejected: no valid zoom levels");
      return res.status(400).json({
        error: "zoomLevels must be a non-empty array of integers (0-22)",
      });
    }

    const backupFolderName = getBackupFolderName();
    const backupFolder = `${BACKUP_PREFIX}${backupFolderName}/`;
    console.log("[backup] Folder:", backupFolder, "– listing tiles from S3…");

    const keys = await listTileKeysForZooms(validZooms);
    console.log("[backup] Listed", keys.length, "tiles, starting copy to S3…");

    if (keys.length === 0) {
      console.log("[backup] No tiles found for zooms", validZooms.join(", "));
      return res.status(404).json({
        error: "No tiles found for the given zoom levels",
        zoomLevels: validZooms,
      });
    }

    const tileCountByZoom: Record<number, number> = {};
    for (const z of validZooms) tileCountByZoom[z] = 0;

    for (const key of keys) {
      const parts = key.split("/");
      if (parts[0] === "tiles" && parts[1] === "category" && parts.length >= 5) {
        const z = parseInt(parts[3], 10);
        if (!isNaN(z) && validZooms.includes(z)) tileCountByZoom[z] = (tileCountByZoom[z] ?? 0) + 1;
      } else if (parts[0] === "tiles" && parts.length >= 4) {
        const z = parseInt(parts[1], 10);
        if (!isNaN(z) && validZooms.includes(z)) tileCountByZoom[z] = (tileCountByZoom[z] ?? 0) + 1;
      }
    }

    const copySourceBucketKey = `${bucketName}/`;
    const destinationPrefix = backupFolder + "tiles/";
    const CONCURRENCY = 20;
    const PROGRESS_LOG_EVERY = 500;
    const copyOne = async (key: string) => {
      if (!key.startsWith("tiles/")) return;
      const destKey = destinationPrefix + key.slice("tiles/".length);
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucketName,
          CopySource: copySourceBucketKey + key,
          Key: destKey,
        })
      );
    };
    for (let i = 0; i < keys.length; i += CONCURRENCY) {
      const chunk = keys.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(copyOne));
      const done = Math.min(i + CONCURRENCY, keys.length);
      if (done % PROGRESS_LOG_EVERY < CONCURRENCY || done === keys.length) {
        console.log("[backup] Copy progress:", done, "/", keys.length);
      }
    }

    const createdAt = new Date().toISOString();
    const status = {
      backupFolderName,
      createdAt,
      zoomLevels: validZooms,
      tileCountByZoom,
      totalTiles: keys.length,
    };

    console.log("[backup] Writing status.json…");
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: backupFolder + "status.json",
        Body: JSON.stringify(status, null, 2),
        ContentType: "application/json",
      })
    );

    console.log("[backup] Done. Created", backupFolderName, "–", keys.length, "tiles, zooms", validZooms.join(","));
    return res.status(200).json({
      backupFolderName,
      folder: backupFolder,
      totalTiles: keys.length,
      tileCountByZoom: status.tileCountByZoom,
      statusKey: backupFolder + "status.json",
    });
  } catch (err) {
    console.error("[backup] Error:", err);
    return res.status(500).json({
      error: "Backup failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
