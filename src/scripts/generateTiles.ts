import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { tileBBox, fetchTreesInBBox, drawTreesOnCanvas } from "../utils/utils";
import { writeFileSync } from "fs";
import path from "path";

// AWS S3 config
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

// Hungary bbox
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

export async function generateTiles(minZoom: number, maxZoom: number) {
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lon2tile(MIN_LON, z);
    const xMax = lon2tile(MAX_LON, z);
    const yMin = lat2tile(MAX_LAT, z); // Note: y goes from top to bottom
    const yMax = lat2tile(MIN_LAT, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const bbox = tileBBox(x, y, z);
        const trees = await fetchTreesInBBox(payloadUrl, bbox);
        const canvas = drawTreesOnCanvas(trees, bbox);
        const buffer = canvas.toBuffer();

        const key = `tiles/${z}/${x}/${y}.png`;

        await s3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: buffer,
          ContentType: "image/png",
        }));

        console.log(`Uploaded tile z${z} x${x} y${y} to S3`);
      }
    }
  }
}

/* // Például 6-12 zoom szintek
generateTiles(6, 12).then(() => console.log("All tiles generated and uploaded."));
 */