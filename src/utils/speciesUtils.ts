export interface SpeciesCategory {
  id: number;
  name: string;
  latinName: string;
  isPriority?: boolean;
}

export async function resolveCategoryName(
  payloadUrl: string,
  categoryName?: string
): Promise<string | undefined> {
  if (!categoryName) return undefined;

  const url = `${payloadUrl}/api/species-categories?limit=50&sort=name`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch species categories: ${resp.status}`);
  const data = await resp.json();

  const match = data.docs.find(
    (cat: any) => cat.name.toLowerCase() === categoryName.toLowerCase()
  );

  return match?.name; // if found, return the exact name; else undefined
}