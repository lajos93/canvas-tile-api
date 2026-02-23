import { Worker } from "worker_threads";
import path from "path";
import PQueue from "p-queue";

import { isStopped } from "../utils/stopControl";
import { TILE_UPLOAD_CONCURRENCY, PAYLOAD_URL } from "../utils/config";
import { HUNGARY_BOUNDS } from "../utils/geoBounds";

const { MIN_LAT, MAX_LAT, MIN_LON, MAX_LON } = HUNGARY_BOUNDS;

/**
 * Coordinate → tile index.
 */
function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function lat2tile(lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

/**
 * Generate one tile in a separate worker thread.
 */
function runTileWorker(
  zoom: number,
  x: number,
  y: number,
  categoryId?: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(__dirname, "../workers/tileWorker.js"), {
      workerData: { zoom, x, y, categoryId, payloadUrl: PAYLOAD_URL },
    });

    worker.on("message", (msg) => {
      if (msg.success) resolve(msg.key);
      else reject(new Error(msg.error));
    });

    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with code ${code}`));
    });
  });
}

/**
 * Parallel tile generation with multiple workers.
 * Only processes tiles where the API reports trees.
 */
export async function generateTilesWithWorkers(
  zoom: number,
  startX?: number,
  startY?: number,
  categoryId?: number
) {
  if (!zoom || isNaN(zoom)) throw new Error("Zoom level is required and must be a number");

  const xMin = lon2tile(MIN_LON, zoom);
  const xMax = lon2tile(MAX_LON, zoom);
  const yMin = lat2tile(MAX_LAT, zoom);
  const yMax = lat2tile(MIN_LAT, zoom);

  const queue = new PQueue({ concurrency: TILE_UPLOAD_CONCURRENCY });

  console.log(`⚙️ Worker queue created (concurrency=${TILE_UPLOAD_CONCURRENCY})`);

  const actualStartX = startX ?? xMin;
  const actualStartY = startY ?? yMin;

  console.log(
    `🚀 Starting worker-based generation for zoom=${zoom} from x=${actualStartX}, y=${actualStartY}` +
      (categoryId ? ` (categoryId=${categoryId})` : " (all categories)")
  );

  for (let x = actualStartX; x <= xMax; x++) {
    for (let y = x === actualStartX ? actualStartY : yMin; y <= yMax; y++) {
      if (isStopped()) {
        console.log(`⏹️ Worker-based generation STOPPED at x=${x}, y=${y}`);
        await queue.onIdle();
        return;
      }

      queue.add(async () => {
        try {
          const key = await runTileWorker(zoom, x, y, categoryId);
          console.log(`✅ Uploaded tile ${key}`);
        } catch (err) {
          console.error(`❌ Worker failed at z${zoom} x${x} y${y}:`, err);
        }
      });
    }
  }

  await queue.onIdle();

  console.log(
    isStopped()
      ? `⚠️ Worker-based generation stopped before completion`
      : `🎉 Worker-based generation for zoom ${zoom} complete!`
  );
}
