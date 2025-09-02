import { S3Client, ListObjectsV2Command, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export async function getLastTileByCoordinates(zoom: number) {
  const prefix = `tiles/${zoom}/`;
  let continuationToken: string | undefined = undefined;
  let lastTile: { x: number; y: number } | null = null;

  do {
    const data: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET!, Prefix: prefix, ContinuationToken: continuationToken })
    );

    if (data.Contents) {
      for (const obj of data.Contents) {
        if (!obj.Key) continue;
        const match = obj.Key.match(/tiles\/\d+\/(\d+)\/(\d+)\.avif$/);
        if (!match) continue;

        const x = parseInt(match[1]);
        const y = parseInt(match[2]);

        if (!lastTile || x > lastTile.x || (x === lastTile.x && y > lastTile.y)) {
          lastTile = { x, y };
        }
      }
    }

    continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (continuationToken);

  return lastTile;
}
