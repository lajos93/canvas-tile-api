import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { s3, bucketName } from "./s3Client";
import { slugify } from "../slugify";

/**
 * Upload to S3 and returns the file URL.
 */
export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return `https://${bucketName}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
}

/**
 * Get S3 object stream by key.
 */
export async function getS3ObjectStream(key: string): Promise<Readable | null> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  if (!result.Body) return null;

  return result.Body instanceof Readable
    ? result.Body
    : Readable.fromWeb(result.Body as any);
}

/**
 * Get S3 object as Buffer by key. Returns null if the object does not exist.
 */
export async function getS3ObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    const stream = await getS3ObjectStream(key);
    if (!stream) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * Listing all S3 object keys with the given prefix.
 */
export async function listS3Objects(prefix: string): Promise<string[]> {
  let keys: string[] = [];
  let continuationToken: string | undefined = undefined;

  do {
    const response: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) keys.push(obj.Key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

/**
 * Last tile info by zoom level (based on S3 keys)
 */
export async function getLastTileByCoordinates(
  zoom: number,
  categoryName?: string
): Promise<{ x: number; y: number } | null> {
  const prefix = categoryName
    ? `tiles/category/${slugify(categoryName)}/${zoom}/`
    : `tiles/${zoom}/`;

  const keys = await listS3Objects(prefix);
  if (!keys.length) return null;

  // Example key: tiles/category/almafelek/12/345/678.avif or tiles/12/345/678.avif
  const coords = keys.map((key) => {
    const parts = key.split("/");
    const yPart = parts.pop()!; // e.g. "678.avif"
    const xPart = parts.pop()!; // e.g. "345"
    const zPart = parts.pop()!; // e.g. "12"

    const x = parseInt(xPart, 10);
    const y = parseInt(yPart.replace(/\..+$/, ""), 10); // strip file extension
    const z = parseInt(zPart, 10);

    return { x, y, z };
  });

  // Only the given zoom level
  const zoomCoords = coords.filter((c) => c.z === zoom);
  if (!zoomCoords.length) return null;

  // Find the largest X, Y (row-major order)
  zoomCoords.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  return zoomCoords[zoomCoords.length - 1];
}
