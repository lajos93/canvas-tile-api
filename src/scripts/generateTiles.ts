import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { tileBBox, fetchTreesInBBox, drawTreesOnCanvas } from "../utils/utils";
import sharp from "sharp";
import PQueue from "p-queue";
import { shouldStop } from "../routes/generateTiles";

const concurrency = parseInt(process.env.TILE_UPLOAD_CONCURRENCY ?? "5", 10);
console.log(`Using concurrency: ${concurrency}`);


const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const bucketName = process.env.S3_BUCKET!;
const payloadUrl = process.env.PAYLOAD_URL!;
if (!payloadUrl) throw new Error("PAYLOAD_URL environment variable not set");

const MIN_LAT = 45.7;
const MAX_LAT = 48.6;
const MIN_LON = 16.0;
const MAX_LON = 22.9;

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



export async function generateTiles(
  zoom: number,
  startX?: number,
  startY?: number
) {
  const xMin = lon2tile(MIN_LON, zoom);
  const xMax = lon2tile(MAX_LON, zoom);
  const yMin = lat2tile(MAX_LAT, zoom);
  const yMax = lat2tile(MIN_LAT, zoom);

  const queue = new PQueue({ concurrency });
  const batchSize = 1000;
  let batchCount = 0;

  const actualStartX = startX ?? xMin;
  const actualStartY = startY ?? yMin;

  console.log(
    `Starting generation for zoom ${zoom} from x=${actualStartX}, y=${actualStartY}`
  );

  for (let x = actualStartX; x <= xMax; x++) {
    for (let y = x === actualStartX ? actualStartY : yMin; y <= yMax; y++) {
      // 👇 itt figyeljük a stop jelet
      if (shouldStop()) {
        console.log(`Tile generation STOPPED at x=${x}, y=${y}`);
        await queue.onIdle(); // megvárja, hogy a futó taskok befejeződjenek
        return;
      }

      queue.add(async () => {
        const bbox = tileBBox(x, y, zoom);
        const trees = await fetchTreesInBBox(payloadUrl, bbox);
        const canvas = drawTreesOnCanvas(trees, bbox);
        const pngBuffer = canvas.toBuffer();

        const avifBuffer = await sharp(pngBuffer)
          .avif({ quality: 30 })
          .toBuffer();

        const key = `tiles/${zoom}/${x}/${y}.avif`;
        await s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: avifBuffer,
            ContentType: "image/avif",
          })
        );

        console.log(`Uploaded tile z${zoom} x${x} y${y} to S3 as AVIF`);
      });

      batchCount++;
      if (batchCount >= batchSize) {
        await queue.onIdle();
        batchCount = 0;
        console.log(`Batch of ${batchSize} tiles finished, continuing...`);
      }
    }
  }

  await queue.onIdle();

  if (!shouldStop()) {
    console.log(`Zoom ${zoom} tile generation complete!`);
  } else {
    console.log(`Zoom ${zoom} stopped before completion.`);
  }
}
