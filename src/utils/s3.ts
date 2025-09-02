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

export async function getLastTileFolderForZoom(zoom: number) {
  const prefix = `tiles/${zoom}/`;
  const data = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix }));

  if (!data.Contents || data.Contents.length === 0) return null;

  // Számoljuk a mappákat (x értékek)
  const folders: Record<number, number[]> = {}; // x -> y list
  for (const obj of data.Contents) {
    if (!obj.Key) continue;
    const match = obj.Key.match(/tiles\/\d+\/(\d+)\/(\d+)\.avif/);
    if (match) {
      const x = parseInt(match[1]);
      const y = parseInt(match[2]);
      if (!folders[x]) folders[x] = [];
      folders[x].push(y);
    }
  }

  const xList = Object.keys(folders).map(Number);
  const lastX = Math.max(...xList);
  const lastY = Math.max(...folders[lastX]);

  const lastKey = `tiles/${zoom}/${lastX}/${lastY}.avif`;

  return { zoom, x: lastX, y: lastY, key: lastKey };
}
