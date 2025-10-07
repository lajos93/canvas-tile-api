import sharp from "sharp";
import PQueue from "p-queue";

import { updateStatusFile } from "../utils/s3/updateStatusFile";

import { renderTileToBuffer } from "../utils/tileUtils";
import { isStopped } from "../utils/stopControl";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { TILE_UPLOAD_CONCURRENCY, PAYLOAD_URL } from "../utils/config";

import { resolveCategoryName } from "../utils/speciesUtils";
import { slugify } from "../utils/slugify";
import { HUNGARY_BOUNDS } from "../utils/geoBounds";

const { MIN_LAT, MAX_LAT, MIN_LON, MAX_LON } = HUNGARY_BOUNDS;

function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function lat2tile(lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      2 ** zoom
  );
}

/**
 * Tile generálás + S3 feltöltés + status.json frissítés
 */
export async function generateTiles(
  zoom: number,
  startX?: number,
  startY?: number,
  categoryName?: string
) {
  const resolvedCategory = await resolveCategoryName(PAYLOAD_URL, categoryName);
  if (categoryName && !resolvedCategory) {
    throw new Error(`Unknown species category: ${categoryName}`);
  }

  // 🟢 Induláskor status.json létrehozása/frissítése
  await updateStatusFile({
    status: "running",
    startedAt: new Date().toISOString(),
    category: resolvedCategory,
    zoom,
  });

  const xMin = lon2tile(MIN_LON, zoom);
  const xMax = lon2tile(MAX_LON, zoom);
  const yMin = lat2tile(MAX_LAT, zoom);
  const yMax = lat2tile(MIN_LAT, zoom);

  const queue = new PQueue({ concurrency: TILE_UPLOAD_CONCURRENCY });
  const batchSize = 1000;
  let batchCount = 0;

  const actualStartX = startX ?? xMin;
  const actualStartY = startY ?? yMin;

  console.log(
    `Starting generation for zoom=${zoom} from x=${actualStartX}, y=${actualStartY} (concurrency=${TILE_UPLOAD_CONCURRENCY})`
  );

  for (let x = actualStartX; x <= xMax; x++) {
    for (let y = x === actualStartX ? actualStartY : yMin; y <= yMax; y++) {
      if (isStopped()) {
        console.log(`Tile generation STOPPED at x=${x}, y=${y}`);
        await queue.onIdle();

        // ⏹️ Leállítás esetén státusz frissítése
        await updateStatusFile({
          status: "stopped",
          category: resolvedCategory,
          zoom,
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      queue.add(async () => {
        const pngBuffer = await renderTileToBuffer(
          zoom,
          x,
          y,
          PAYLOAD_URL,
          resolvedCategory
        );

        const avifBuffer = await sharp(pngBuffer)
          .avif({ quality: 30 })
          .toBuffer();

        const key = resolvedCategory
          ? `tiles/category/${slugify(resolvedCategory)}/${zoom}/${x}/${y}.avif`
          : `tiles/${zoom}/${x}/${y}.avif`;

        await uploadToS3(key, avifBuffer, "image/avif");

        console.log(
          `Uploaded tile z${zoom} x${x} y${y} ${
            resolvedCategory ? `(${resolvedCategory})` : ""
          } to S3`
        );
      });

      batchCount++;
      if (batchCount >= batchSize) {
        await queue.onIdle();
        console.log(`✅ Batch of ${batchSize} tiles finished.`);
        batchCount = 0;
      }
    }
  }

  await queue.onIdle();

  // ✅ Befejezés után státusz frissítése
  await updateStatusFile({
    status: "finished",
    finishedAt: new Date().toISOString(),
    category: resolvedCategory,
    zoom,
  });

  console.log(
    !isStopped()
      ? `✅ Zoom ${zoom} tile generation complete!`
      : `⏹️ Zoom ${zoom} stopped before completion.`
  );
}
