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
  categories?: Record<string, CategoryStatus>;
};

/**
 * Frissíti vagy létrehozza a status.json fájlt az S3-ban.
 * - Minden kategóriához tárolja a generált zoom szinteket.
 * - Ha új kategória vagy zoom kerül hozzá, automatikusan bővíti.
 */
export async function updateStatusFile(update: {
  category?: string;
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

  const { category, zoom } = update;

  // Ha van kategória és zoom → frissítjük vagy létrehozzuk a kategória bejegyzést
  if (category && typeof zoom === "number") {
    if (!currentStatus.categories[category]) {
      currentStatus.categories[category] = { zooms: [], lastUpdated: now };
    }

    const categoryEntry = currentStatus.categories[category];
    if (!categoryEntry.zooms.includes(zoom)) {
      categoryEntry.zooms.push(zoom);
      categoryEntry.zooms.sort((a, b) => a - b);
    }

    categoryEntry.lastUpdated = now;
  }

  // Metaadatok frissítése
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

  console.log(`📊 Status updated for ${category || "general"} (zoom=${zoom ?? "n/a"})`);
}
