import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, bucketName } from "./s3Client";

type CategoryStatus = {
  zooms: number[];
  lastUpdated: string;
};

type StatusSchema = {
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  lastUpdated?: string;
  categories?: Record<string, CategoryStatus>; // kulcs = categoryId
};

/**
 * Frissíti vagy létrehozza a status.json fájlt az S3-ban.
 * - Minden kategória (id) szerint tárolja a generált zoomokat.
 */
export async function updateStatusFile(update: {
  categoryId?: number;
  zoom?: number;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
}) {
  const key = "status.json";
  let currentStatus: StatusSchema = {};

  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const text = await data.Body?.transformToString();
    currentStatus = JSON.parse(text || "{}");
  } catch {
    console.log("ℹ️ No existing status.json found, creating a new one...");
  }

  const now = new Date().toISOString();
  if (!currentStatus.categories) currentStatus.categories = {};

  const { categoryId, zoom } = update;

  // 🧠 kategória (id) + zoom frissítése
  if (categoryId !== undefined && typeof zoom === "number") {
    const idKey = String(categoryId);
    if (!currentStatus.categories[idKey]) {
      currentStatus.categories[idKey] = { zooms: [], lastUpdated: now };
    }

    const entry = currentStatus.categories[idKey];
    if (!entry.zooms.includes(zoom)) {
      entry.zooms.push(zoom);
      entry.zooms.sort((a, b) => a - b);
    }

    entry.lastUpdated = now;
  }

  const newStatus: StatusSchema = {
    ...currentStatus,
    ...update,
    lastUpdated: now,
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(newStatus, null, 2),
      ContentType: "application/json",
    })
  );

  console.log(
    `📊 Status updated for categoryId=${categoryId ?? "general"} (zoom=${zoom ?? "n/a"})`
  );
}
