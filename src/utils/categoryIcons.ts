import { loadImage, type Image } from "canvas";
import sharp from "sharp";
import { PAYLOAD_URL } from "./config";

type SpeciesCategoryIcon = {
  url?: string | null;
  thumbnailURL?: string | null;
  sizes?: { icon?: { url?: string | null } };
};

type SpeciesCategoryDoc = {
  id: number;
  name: string;
  icon?: SpeciesCategoryIcon | number | null;
};

const categoryById = new Map<number, { name: string; iconUrl: string | null }>();
let categoriesFetched = false;

function resolveIconUrl(icon: SpeciesCategoryDoc["icon"]): string | null {
  if (!icon || typeof icon !== "object") return null;

  const raw = icon.url ?? icon.thumbnailURL ?? icon.sizes?.icon?.url ?? null;
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${PAYLOAD_URL}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export async function ensureCategoriesLoaded(): Promise<void> {
  if (categoriesFetched) return;

  const res = await fetch(`${PAYLOAD_URL}/api/species-categories?limit=100&depth=1`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch species categories: ${res.status} - ${text}`);
  }

  const data = (await res.json()) as { docs?: SpeciesCategoryDoc[] };
  for (const cat of data.docs ?? []) {
    categoryById.set(cat.id, {
      name: cat.name,
      iconUrl: resolveIconUrl(cat.icon),
    });
  }

  categoriesFetched = true;
}

export async function getCategoryNameById(categoryId: number): Promise<string | undefined> {
  await ensureCategoriesLoaded();
  return categoryById.get(categoryId)?.name;
}

export async function hasCategoryIcon(categoryId: number): Promise<boolean> {
  await ensureCategoriesLoaded();
  return Boolean(categoryById.get(categoryId)?.iconUrl);
}

const canvasIconCache = new Map<number, Image>();
const bufferIconCache = new Map<string, Buffer>();
const rawIconCache = new Map<number, Buffer>();
const inflightRawFetches = new Map<number, Promise<Buffer | null>>();
const inflightCanvasLoads = new Map<number, Promise<Image | null>>();

let preloadPromise: Promise<void> | null = null;

/**
 * Fetch and decode every category icon once per process.
 * Concurrent callers share the same in-flight promise.
 */
export async function preloadAllCategoryIcons(): Promise<void> {
  if (preloadPromise) return preloadPromise;

  preloadPromise = (async () => {
    await ensureCategoriesLoaded();

    const ids = [...categoryById.entries()]
      .filter(([, cat]) => cat.iconUrl)
      .map(([id]) => id);

    if (ids.length === 0) {
      console.log("[categoryIcons] No category icons to preload");
      return;
    }

    const started = Date.now();
    console.log(`[categoryIcons] Preloading ${ids.length} category icons...`);

    const results = await Promise.allSettled(ids.map((id) => loadCategoryIconImage(id)));
    const failed = results.filter((r) => r.status === "rejected" || r.value === null).length;

    console.log(
      `[categoryIcons] Preloaded ${ids.length - failed}/${ids.length} icons in ${Date.now() - started}ms`
    );
  })();

  return preloadPromise;
}

async function fetchCategoryIconBytes(categoryId: number): Promise<Buffer | null> {
  const cached = rawIconCache.get(categoryId);
  if (cached) return cached;

  const inflight = inflightRawFetches.get(categoryId);
  if (inflight) return inflight;

  const promise = (async () => {
    await ensureCategoriesLoaded();
    const iconUrl = categoryById.get(categoryId)?.iconUrl;
    if (!iconUrl) return null;

    const res = await fetch(iconUrl);
    if (!res.ok) {
      console.warn(`[categoryIcons] Icon fetch failed for category ${categoryId}: ${res.status}`);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    rawIconCache.set(categoryId, buf);
    return buf;
  })()
    .catch((err) => {
      console.warn(`[categoryIcons] Icon fetch error for category ${categoryId}:`, err);
      return null;
    })
    .finally(() => {
      inflightRawFetches.delete(categoryId);
    });

  inflightRawFetches.set(categoryId, promise);
  return promise;
}

export async function loadCategoryIconImage(categoryId: number): Promise<Image | null> {
  const cached = canvasIconCache.get(categoryId);
  if (cached) return cached;

  const inflight = inflightCanvasLoads.get(categoryId);
  if (inflight) return inflight;

  const promise = (async () => {
    const raw = await fetchCategoryIconBytes(categoryId);
    if (!raw) return null;

    // node-canvas loadImage does not support AVIF/WebP from URL — decode via sharp first.
    const png = await sharp(raw).png().toBuffer();
    const img = await loadImage(png);
    canvasIconCache.set(categoryId, img);
    return img;
  })()
    .catch((err) => {
      console.warn(`[categoryIcons] Failed to load icon for category ${categoryId}:`, err);
      return null;
    })
    .finally(() => {
      inflightCanvasLoads.delete(categoryId);
    });

  inflightCanvasLoads.set(categoryId, promise);
  return promise;
}

export async function getCategoryIconBuffer(
  categoryId: number,
  size: number
): Promise<Buffer | null> {
  const cacheKey = `${categoryId}:${size}`;
  const cached = bufferIconCache.get(cacheKey);
  if (cached) return cached;

  try {
    const raw = await fetchCategoryIconBytes(categoryId);
    if (!raw) return null;

    const png = await sharp(raw).resize(size, size).png().toBuffer();
    bufferIconCache.set(cacheKey, png);
    return png;
  } catch (err) {
    console.warn(`[categoryIcons] Failed to fetch/resize icon for category ${categoryId}:`, err);
    return null;
  }
}
