export function slugify(name: string): string {
  return name
    .normalize("NFD")                 // remove accents
    .replace(/[\u0300-\u036f]/g, "")  // remove accents
    .toLowerCase()
    .replace(/\s+/g, "-")             // dash instead of spaces
    .replace(/[^a-z0-9-]/g, "");      // everything else removed
}
