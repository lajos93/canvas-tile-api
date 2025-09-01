import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { tileBBox, fetchTreesInBBox, drawTreesOnCanvas } from "../utils/utils";
import sharp from "sharp";
import PQueue from "p-queue";

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
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom);
}

// Javított lastTile logika
async function getLastTile(z: number) {
  const prefix = `tiles/${z}/`;
  const data = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix }));

  if (!data.Contents || data.Contents.length === 0) return null;

  const lastTile = data.Contents.reduce(
    (max, obj) => {
      if (!obj.Key) return max;
      const match = obj.Key.match(/tiles\/\d+\/(\d+)\/(\d+)\.avif/);
      if (!match) return max;
      const x = parseInt(match[1]);
      const y = parseInt(match[2]);
      if (x > max.x || (x === max.x && y > max.y)) {
        return { x, y };
      }
      return max;
    },
    { x: -1, y: -1 }
  );

  return lastTile.x >= 0 ? lastTile : null;
}

export async function generateTiles(minZoom: number, maxZoom: number) {
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lon2tile(MIN_LON, z);
    const xMax = lon2tile(MAX_LON, z);
    const yMin = lat2tile(MAX_LAT, z);
    const yMax = lat2tile(MIN_LAT, z);

    const lastTile = await getLastTile(z);
    let startX = xMin;
    let startY = yMin;

    if (lastTile) {
      startX = lastTile.x;
      startY = lastTile.y + 1;
      if (startY > yMax) {
        startX += 1;
        startY = yMin;
      }
      console.log(`Resuming zoom ${z} from tile x=${startX}, y=${startY}`);
    }

    const queue = new PQueue({ concurrency: 5 }); // max 5 párhuzamos tile
    const batchSize = 1000;
    let batchCount = 0;

    for (let x = startX; x <= xMax; x++) {
      for (let y = (x === startX ? startY : yMin); y <= yMax; y++) {
        queue.add(async () => {
          const bbox = tileBBox(x, y, z);
          const trees = await fetchTreesInBBox(payloadUrl, bbox);
          const canvas = drawTreesOnCanvas(trees, bbox);
          const pngBuffer = canvas.toBuffer();

          const avifBuffer = await sharp(pngBuffer)
            .avif({ quality: 30 })
            .toBuffer();

          const key = `tiles/${z}/${x}/${y}.avif`;
          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: key,
              Body: avifBuffer,
              ContentType: "image/avif",
            })
          );

          console.log(`Uploaded tile z${z} x${x} y${y} to S3 as AVIF`);
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
    console.log(`Zoom ${z} tile generation complete!`);
  }
}
