import { ensureCategoriesLoaded, hasCategoryIcon } from "./categoryIcons";

/**
 * Checks whether a category has an icon configured in Payload CMS.
 */
export async function checkCategoryIcon(
  categoryId: string
): Promise<{ ok: boolean; error?: string }> {
  const id = parseInt(categoryId, 10);
  if (isNaN(id)) {
    return { ok: false, error: `Invalid category id: ${categoryId}` };
  }

  try {
    await ensureCategoriesLoaded();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to load species categories: ${msg}` };
  }

  if (!(await hasCategoryIcon(id))) {
    return {
      ok: false,
      error: `No icon configured in Payload for category id: ${categoryId}`,
    };
  }

  return { ok: true };
}
