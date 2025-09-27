import sharp from "sharp";
import PQueue from "p-queue";

import { renderTileToBuffer } from "../utils/tileUtils";
import { isStopped } from "../utils/stopControl";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { TILE_UPLOAD_CONCURRENCY, PAYLOAD_URL } from "../utils/config";

import { resolveCategoryName } from "../utils/speciesUtils";

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
 * Tile generálás + S3 feltöltés
 */
export async function generateTiles(
  zoom: number,
  startX?: number,
  startY?: number,
  categoryName?: string
)  {
  const resolvedCategory = await resolveCategoryName(PAYLOAD_URL, categoryName);

   if (categoryName && !resolvedCategory) {
    throw new Error(`Unknown species category: ${categoryName}`);
  }

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
        return;
      }

      queue.add(async () => {
        const pngBuffer = await renderTileToBuffer(zoom, x, y, PAYLOAD_URL, resolvedCategory);

        const avifBuffer = await sharp(pngBuffer)
          .avif({ quality: 30 })
          .toBuffer();

        const key = `tiles/${zoom}/${x}/${y}.avif`;
        await uploadToS3(key, avifBuffer, "image/avif");

        console.log(`Uploaded tile z${zoom} x${x} y${y} to S3`);
      });

      batchCount++;
      if (batchCount >= batchSize) {
        await queue.onIdle(); // várunk, amíg a batch lefut
        batchCount = 0;
        console.log(`Batch of ${batchSize} tiles finished, continuing...`);
      }
    }
  }

  await queue.onIdle();

  console.log(
    !isStopped()
      ? `Zoom ${zoom} tile generation complete!`
      : `Zoom ${zoom} stopped before completion.`
  );
}