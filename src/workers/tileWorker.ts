import { parentPort, workerData } from "worker_threads";
import sharp from "sharp";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { PAYLOAD_URL } from "../utils/config";

async function processTile({ zoom, x, y }: { zoom: number; x: number; y: number }) {
  console.log(`👷 Worker: processing tile z${zoom} x${x} y${y}`);

  const pngBuffer = await renderTileToBuffer(zoom, x, y, PAYLOAD_URL);

  console.log(`👷 Worker: rendered tile z${zoom} x${x} y${y}`);

  const avifBuffer = await sharp(pngBuffer)
    .avif({ quality: 30 })
    .toBuffer();

  console.log(`👷 Worker: converted tile z${zoom} x${x} y${y} to AVIF`);

  const key = `tiles/${zoom}/${x}/${y}.avif`;
  await uploadToS3(key, avifBuffer, "image/avif");

  console.log(`👷 Worker: uploaded ${key}`);

  return key;
}

processTile(workerData)
  .then((key) => parentPort?.postMessage({ success: true, key }))
  .catch((err) => parentPort?.postMessage({ success: false, error: err.message }));
