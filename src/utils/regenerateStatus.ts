import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, bucketName } from "./s3/s3Client";

export type TileCoord = { z: number; x: number; y: number };

export type RegenerateLayerProgress = TileCoord & {
  updatedAt: string;
};

export type RegenerateStatusRoot = {
  regenerateRegion?: Record<string, RegenerateLayerProgress>;
};

const STATUS_KEY = "status.json";

/** Row-major tile order (x asc, then y asc) — same as legacy getLastTileByCoordinates. */
export function compareTilesRowMajor(a: TileCoord, b: TileCoord): number {
  if (a.x !== b.x) return a.x - b.x;
  return a.y - b.y;
}

export function sortTilesRowMajor(tiles: TileCoord[]): TileCoord[] {
  return [...tiles].sort(compareTilesRowMajor);
}

export function layerProgressKey(z: number, categoryId: number | null | undefined): string {
  return categoryId == null ? `${z}:default` : `${z}:category:${categoryId}`;
}

export async function readRegenerateStatus(): Promise<RegenerateStatusRoot> {
  try {
    const data = await s3.send(
      new GetObjectCommand({ Bucket: bucketName, Key: STATUS_KEY })
    );
    const text = await data.Body?.transformToString();
    return JSON.parse(text || "{}") as RegenerateStatusRoot;
  } catch {
    return {};
  }
}

async function writeRegenerateStatus(root: RegenerateStatusRoot): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: STATUS_KEY,
      Body: JSON.stringify(root, null, 2),
      ContentType: "application/json",
    })
  );
}

export async function getLayerProgress(
  z: number,
  categoryId: number | null | undefined
): Promise<RegenerateLayerProgress | null> {
  const root = await readRegenerateStatus();
  return root.regenerateRegion?.[layerProgressKey(z, categoryId)] ?? null;
}

export async function setLayerProgress(
  z: number,
  categoryId: number | null | undefined,
  tile: TileCoord
): Promise<void> {
  const root = await readRegenerateStatus();
  const key = layerProgressKey(z, categoryId);
  const prev = root.regenerateRegion?.[key];
  if (prev && compareTilesRowMajor(tile, prev) <= 0) return;

  const next: RegenerateStatusRoot = {
    ...root,
    regenerateRegion: {
      ...root.regenerateRegion,
      [key]: { z: tile.z, x: tile.x, y: tile.y, updatedAt: new Date().toISOString() },
    },
  };
  await writeRegenerateStatus(next);
}

/** Skip tiles at or before resume point; optional backtrack redoes last N tiles. */
export function filterTilesForResume(
  tiles: TileCoord[],
  resumeAfter: TileCoord | null | undefined,
  backtrack = 0
): { tiles: TileCoord[]; skipped: number; resumeFrom: TileCoord | null } {
  const sorted = sortTilesRowMajor(tiles);
  if (!resumeAfter) {
    return { tiles: sorted, skipped: 0, resumeFrom: null };
  }

  let startIndex = sorted.findIndex(
    (t) => t.x === resumeAfter.x && t.y === resumeAfter.y && t.z === resumeAfter.z
  );

  if (startIndex === -1) {
    startIndex = sorted.findIndex((t) => compareTilesRowMajor(t, resumeAfter) > 0);
    if (startIndex === -1) {
      return { tiles: [], skipped: sorted.length, resumeFrom: resumeAfter };
    }
    startIndex = Math.max(0, startIndex - Math.max(0, backtrack));
  } else {
    startIndex = Math.max(0, startIndex - Math.max(0, backtrack));
  }

  return {
    tiles: sorted.slice(startIndex),
    skipped: startIndex,
    resumeFrom: sorted[startIndex] ?? resumeAfter,
  };
}
