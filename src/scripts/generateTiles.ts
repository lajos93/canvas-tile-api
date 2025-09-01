import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { tileBBox, fetchTreesInBBox, drawTreesOnCanvas } from "../utils/utils";
import sharp from "sharp";

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
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

async function getLastTile(z: number) {
  const prefix = `tiles/${z}/`;
  const data = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix }));

  if (!data.Contents || data.Contents.length === 0) return null;

  let maxX = 0;
  let maxY = 0;

  for (const obj of data.Contents) {
    if (!obj.Key) continue;
    const match = obj.Key.match(/tiles\/\d+\/(\d+)\/(\d+)\.avif/);
    if (match) {
      const x = parseInt(match[1]);
      const y = parseInt(match[2]);
      if (x > maxX || (x === maxX && y > maxY)) {
        maxX = x;
        maxY = y;
      }
    }
  }

  return { x: maxX, y: maxY };
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
    } else {
      console.log(`No tiles found for zoom ${z}, starting from beginning.`);
    }

    for (let x = startX; x <= xMax; x++) {
      for (let y = x === startX ? startY : yMin; y <= yMax; y++) {
        const bbox = tileBBox(x, y, z);
        const trees = await fetchTreesInBBox(payloadUrl, bbox);
        const canvas = drawTreesOnCanvas(trees, bbox);
        const pngBuffer = canvas.toBuffer();

        const avifBuffer = await sharp(pngBuffer).avif({ quality: 30 }).toBuffer();

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
      }
    }
  }
}
