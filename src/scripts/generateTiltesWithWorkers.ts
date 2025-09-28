import { Worker } from "worker_threads";
import path from "path";
import PQueue from "p-queue";

import { isStopped } from "../utils/stopControl";
import { TILE_UPLOAD_CONCURRENCY, PAYLOAD_URL } from "../utils/config";

import { HUNGARY_BOUNDS } from "../utils/geoBounds";
import { resolveCategoryName } from "../utils/speciesUtils";


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

function runTileWorker(
  zoom: number,
  x: number,
  y: number,
  resolvedCategory?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.resolve(__dirname, "../workers/tileWorker.js"),
      {
        workerData: { zoom, x, y, resolvedCategory },
      }
    );

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

export async function generateTilesWithWorkers(
  zoom: number,
  startX?: number,
  startY?: number,
  categoryName?: string
) {
  const resolvedCategory = await resolveCategoryName(PAYLOAD_URL, categoryName);

  if (categoryName && !resolvedCategory) {
    throw new Error(`Unknown species category: ${categoryName}`);
  }

  const xMin = lon2tile(MIN_LON, zoom);
  const xMax = lon2tile(MAX_LON, zoom);
  const yMin = lat2tile(MAX_LAT, zoom);
  const yMax = lat2tile(MIN_LAT, zoom);

  const queue = new PQueue({ concurrency: TILE_UPLOAD_CONCURRENCY });

  const actualStartX = startX ?? xMin;
  const actualStartY = startY ?? yMin;

  console.log(
    `🚀 Starting worker-based generation for zoom=${zoom} from x=${actualStartX}, y=${actualStartY} ${
      resolvedCategory ? `(category: ${resolvedCategory})` : ""
    }`
  );

  for (let x = actualStartX; x <= xMax; x++) {
    for (let y = x === actualStartX ? actualStartY : yMin; y <= yMax; y++) {
      if (isStopped()) {
        console.log(`⏹️ Worker-based generation STOPPED at x=${x}, y=${y}`);
        await queue.onIdle();
        return;
      }

      queue.add(async () => {
        const key = await runTileWorker(zoom, x, y, resolvedCategory);
        console.log(`✅ Uploaded tile ${key}`);
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
