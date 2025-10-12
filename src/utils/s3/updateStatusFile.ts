import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, bucketName } from "./s3Client";
import { PAYLOAD_URL } from "../config";

type CategoryStatus = {
  id?: number;
  zooms: number[];
  lastUpdated: string;
};

type StatusSchema = {
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  lastUpdated?: string;
  category?: string;
  categories?: Record<string, CategoryStatus>; // key = category name
};

/**
 * Helper to fetch all species categories from the Payload API.
 * Returns a map: { [name]: id }
 */
async function fetchCategoryMap(): Promise<Record<string, number>> {
  const res = await fetch(`${PAYLOAD_URL}/api/species-categories?limit=100`);
  if (!res.ok) throw new Error(`Failed to fetch species categories`);
  const data = await res.json();
  const map: Record<string, number> = {};
  for (const c of data.docs || []) map[c.name] = c.id;
  return map;
}

/**
 * Updates the status.json file in S3.
 * Keys categories by name, but also stores their ID fetched from Payload.
 */
export async function updateStatusFile(update: {
  categoryId?: number;
  zoom?: number;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
}) {
  const key = "status.json";
  let current: StatusSchema = {};

  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const text = await data.Body?.transformToString();
    current = JSON.parse(text || "{}");
  } catch {
    console.log("ℹ️ No existing status.json found, creating a new one...");
  }

  const now = new Date().toISOString();
  if (!current.categories) current.categories = {};

  const { categoryId, zoom } = update;

  // Fetch category names and IDs from Payload API
  const categoryMap = await fetchCategoryMap();

  // Find category name by ID
  let categoryName = "general";
  let matchedId: number | undefined = undefined;

  if (typeof categoryId === "number") {
    for (const [name, id] of Object.entries(categoryMap)) {
      if (id === categoryId) {
        categoryName = name;
        matchedId = id;
        break;
      }
    }
  }

  // Update or create entry
  if (typeof zoom === "number") {
    if (!current.categories[categoryName]) {
      current.categories[categoryName] = { id: matchedId, zooms: [], lastUpdated: now };
    }

    const entry = current.categories[categoryName];
    entry.id = matchedId;

    if (!entry.zooms.includes(zoom)) {
      entry.zooms.push(zoom);
      entry.zooms.sort((a, b) => a - b);
    }

    entry.lastUpdated = now;
  }

  const newStatus: StatusSchema = {
    ...current,
    status: update.status ?? current.status,
    startedAt: update.startedAt ?? current.startedAt,
    finishedAt: update.finishedAt ?? current.finishedAt,
    lastUpdated: now,
    category: categoryName,
    categories: current.categories,
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(newStatus, null, 2),
      ContentType: "application/json",
    })
  );

  console.log(`📊 Status updated for '${categoryName}' (id=${matchedId ?? "n/a"}, zoom=${zoom ?? "n/a"})`);
}
