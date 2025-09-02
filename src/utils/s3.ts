// utils/s3Utils.ts
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const bucketName = process.env.S3_BUCKET!;

export async function getLastTileForZoom(zoom: number) {
  const prefix = `tiles/${zoom}/`;
  const data = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix }));

  if (!data.Contents || data.Contents.length === 0) return null;

  let maxX = 0;
  let maxY = 0;
  let lastKey = "";

  for (const obj of data.Contents) {
    if (!obj.Key) continue;
    const match = obj.Key.match(/tiles\/\d+\/(\d+)\/(\d+)\.avif/);
    if (match) {
      const x = parseInt(match[1]);
      const y = parseInt(match[2]);
      if (x > maxX || (x === maxX && y > maxY)) {
        maxX = x;
        maxY = y;
        lastKey = obj.Key;
      }
    }
  }

  return { zoom, x: maxX, y: maxY, key: lastKey };
}
