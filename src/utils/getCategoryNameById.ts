import { PAYLOAD_URL } from "./config";

const nameCache = new Map<number, string>();
let allFetched = false;

export async function getCategoryNameById(categoryId: number): Promise<string | undefined> {
  if (nameCache.has(categoryId)) return nameCache.get(categoryId);

  if (!allFetched) {
    try {
      const res = await fetch(`${PAYLOAD_URL}/api/species-categories?limit=100`);
      const data = await res.json();
      for (const cat of data.docs ?? []) {
        nameCache.set(cat.id, cat.name);
      }
      allFetched = true;
    } catch (err) {
      console.error("❌ Failed to fetch species categories:", err);
    }
  }

  return nameCache.get(categoryId);
}
