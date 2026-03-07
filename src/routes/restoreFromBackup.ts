import { Router, Request, Response } from "express";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { s3, bucketName } from "../utils/s3/s3Client";
import { listS3CommonPrefixes, getS3ObjectBuffer } from "../utils/s3/s3Utils";
import { lat2tile, lon2tile } from "../utils/geoBounds";
import { getCategoryNameById } from "../utils/getCategoryNameById";
import { slugify } from "../utils/slugify";

const router = Router();
const BACKUP_PREFIX = "backup/";

interface BackupStatus {
  backupFolderName: string;
  createdAt: string;
  zoomLevels: number[];
  tileCountByZoom?: Record<number, number>;
  totalTiles?: number;
}

/** POST body: restore affected tiles at a point from backup */
interface RestoreBody {
  lat: number;
  lon: number;
  categoryId?: number;
  /** If set: use latest backup before this date (for delete flow). If omitted: use latest backup (manual restore). */
  treeCreatedAt?: string;
  /** Optional zoom levels to restore (manual restore). If omitted, use backup's zoomLevels. */
  zoomLevels?: number[];
}

type BackupInfo = { folderName: string; zoomLevels: number[] };

async function listAllBackups(): Promise<{ folderName: string; createdAt: string; zoomLevels: number[] }[]> {
  const folderPrefixes = await listS3CommonPrefixes(BACKUP_PREFIX);
  const statuses: { folderName: string; createdAt: string; zoomLevels: number[] }[] = [];

  for (const p of folderPrefixes) {
    const statusKey = `${p}status.json`;
    const buf = await getS3ObjectBuffer(statusKey);
    if (!buf) continue;
    try {
      const status = JSON.parse(buf.toString("utf-8")) as BackupStatus;
      statuses.push({
        folderName: p.replace(BACKUP_PREFIX, "").replace(/\/$/, ""),
        createdAt: status.createdAt,
        zoomLevels: Array.isArray(status.zoomLevels) ? status.zoomLevels : [],
      });
    } catch {
      continue;
    }
  }
  statuses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return statuses;
}

/** Latest backup (most recent by createdAt). */
async function getLatestBackup(): Promise<BackupInfo | null> {
  const statuses = await listAllBackups();
  const s = statuses.find((x) => x.zoomLevels.length > 0);
  return s ? { folderName: s.folderName, zoomLevels: s.zoomLevels } : null;
}

/** Latest backup whose createdAt is strictly before treeCreatedAt. */
async function findBackupBefore(treeCreatedAt: string): Promise<BackupInfo | null> {
  const treeTime = new Date(treeCreatedAt).getTime();
  if (Number.isNaN(treeTime)) return null;
  const statuses = await listAllBackups();
  for (const s of statuses) {
    if (new Date(s.createdAt).getTime() < treeTime && s.zoomLevels.length > 0) {
      return { folderName: s.folderName, zoomLevels: s.zoomLevels };
    }
  }
  return null;
}

/**
 * Compute tile keys affected by a point: default tiles + optionally one or more category slugs.
 */
function getAffectedTileKeys(
  lat: number,
  lon: number,
  zoomLevels: number[],
  categorySlugs: string[] = []
): string[] {
  const keys: string[] = [];
  for (const z of zoomLevels) {
    const x = lon2tile(lon, z);
    const y = lat2tile(lat, z);
    keys.push(`tiles/${z}/${x}/${y}.avif`);
    for (const slug of categorySlugs) {
      keys.push(`tiles/category/${slug}/${z}/${x}/${y}.avif`);
    }
  }
  return keys;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as RestoreBody;
    const { treeCreatedAt, lat, lon, categoryId, zoomLevels: bodyZoomLevels } = body;

    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return res.status(400).json({
        error: "Body must include lat (-90..90), lon (-180..180)",
      });
    }

    const isManual = !treeCreatedAt;
    console.log("[restore-from-backup] Request:", {
      manual: isManual,
      treeCreatedAt,
      lat,
      lon,
      categoryId,
      zoomLevels: bodyZoomLevels,
    });

    let backup: BackupInfo | null;
    if (typeof treeCreatedAt === "string") {
      backup = await findBackupBefore(treeCreatedAt);
      if (!backup) {
        console.log("[restore-from-backup] No backup found before", treeCreatedAt);
        return res.status(404).json({
          ok: false,
          error: "No backup found from before the tree was added",
        });
      }
    } else {
      backup = await getLatestBackup();
      if (!backup) {
        console.log("[restore-from-backup] No backup found");
        return res.status(404).json({
          ok: false,
          error: "No backup found. Create a backup first.",
        });
      }
    }

    let zoomLevels = backup.zoomLevels;
    if (Array.isArray(bodyZoomLevels) && bodyZoomLevels.length > 0) {
      const set = new Set(backup.zoomLevels);
      zoomLevels = bodyZoomLevels.filter((z) => set.has(z));
      if (zoomLevels.length === 0) zoomLevels = backup.zoomLevels;
    }

    let categorySlugs: string[] = [];
    if (typeof categoryId === "number") {
      const name = await getCategoryNameById(categoryId);
      if (name) categorySlugs = [slugify(name)];
    }
    // Only default + at most one category (fa / filter category), never all categories

    const keys = getAffectedTileKeys(lat, lon, zoomLevels, categorySlugs);
    const backupFolder = `${BACKUP_PREFIX}${backup.folderName}/`;
    const sourcePrefix = backupFolder + "tiles/";
    const copySourceBucket = `${bucketName}/`;
    let restored = 0;

    for (const key of keys) {
      const sourceKey = sourcePrefix + key.replace(/^tiles\//, "");
      try {
        await s3.send(
          new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: copySourceBucket + sourceKey,
            Key: key,
          })
        );
        restored++;
      } catch (err: any) {
        if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
          // Backup didn't have this tile (e.g. category not in backup), skip
          continue;
        }
        console.error("[restore-from-backup] Copy failed for", key, err);
      }
    }

    console.log(
      "[restore-from-backup] Done:",
      backup.folderName,
      "restored",
      restored,
      "/",
      keys.length,
      "zooms",
      zoomLevels.join(",")
    );
    return res.status(200).json({
      ok: true,
      backupFolderName: backup.folderName,
      restoredCount: restored,
      requestedCount: keys.length,
      restoredZoomLevels: zoomLevels,
    });
  } catch (err) {
    console.error("[restore-from-backup] Error:", err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Restore failed",
    });
  }
});

export default router;
