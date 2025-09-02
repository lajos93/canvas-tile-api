import { S3Client, ListObjectsV2Command, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.S3_REGION });

export async function getLastUploadedTile(zoom: number) {
  const prefix = `tiles/${zoom}/`;
  let continuationToken: string | undefined = undefined;
  let lastTile: { Key: string; LastModified: Date } | null = null;

  do {
    const data: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET!, Prefix: prefix, ContinuationToken: continuationToken })
    );

    if (data.Contents) {
      for (const obj of data.Contents) {
        if (!obj.Key || !obj.LastModified) continue;
        if (!obj.Key.endsWith(".avif")) continue;

        if (!lastTile || obj.LastModified > lastTile.LastModified) {
          lastTile = { Key: obj.Key, LastModified: obj.LastModified };
        }
      }
    }

    continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!lastTile) return null;

  const match = lastTile.Key.match(/tiles\/\d+\/(\d+)\/(\d+)\.avif$/);
  if (!match) return null;

  return { x: parseInt(match[1]), y: parseInt(match[2]) };
}
