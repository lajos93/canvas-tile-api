import fs from "fs";
import path from "path";
import { iconMap } from "./tileIcons";

/**
 *Checks if the icon file for a given category exists.
 */
export function checkCategoryIcon(categoryName: string): { ok: boolean; filePath?: string; error?: string } {
  const iconFile = iconMap[categoryName];
  if (!iconFile) {
    return { ok: false, error: `No icon mapping found for category: ${categoryName}` };
  }

  const absPath = path.resolve(process.cwd(), "src/assets/icons", iconFile);
  if (!fs.existsSync(absPath)) {
    return { ok: false, error: `Icon file missing for category: ${categoryName}` };
  }
  

  return { ok: true, filePath: absPath };
}