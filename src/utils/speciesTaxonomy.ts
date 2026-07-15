import { PAYLOAD_URL } from "./config";

type PayloadListResponse<T> = {
  docs: T[];
  hasNextPage: boolean;
  page: number;
};

export type PayloadSpeciesCategory = {
  id: number;
  name: string;
  latinName: string;
  isPriority?: boolean | null;
  showInQuickFilter?: boolean | null;
  quickFilterOrder?: number | null;
  icon?: {
    url?: string | null;
    thumbnailURL?: string | null;
    sizes?: { icon?: { url?: string | null } };
  } | number | null;
  group?: { id: number; name: string } | number | null;
};

export type PayloadSpecies = {
  id: number;
  name: string;
  latinName?: string | null;
  bpId?: string | null;
  category?: PayloadSpeciesCategory | number | null;
};

export type SpeciesChild = {
  id: number;
  name: string;
  latinName: string | null;
  bpId: string | null;
};

export type CategoryWithSpecies = {
  id: number;
  name: string;
  latinName: string;
  isPriority: boolean;
  showInQuickFilter: boolean;
  quickFilterOrder: number | null;
  iconUrl: string | null;
  group: { id: number; name: string } | null;
  species: SpeciesChild[];
};

export type SpeciesTaxonomy = {
  fetchedAt: string;
  stats: {
    categoryCount: number;
    speciesCount: number;
    uncategorizedSpeciesCount: number;
  };
  categories: CategoryWithSpecies[];
  uncategorizedSpecies: SpeciesChild[];
};

function resolveMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${PAYLOAD_URL}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

function iconUrlFromUpload(icon: PayloadSpeciesCategory["icon"]): string | null {
  if (!icon || typeof icon !== "object") return null;
  return (
    resolveMediaUrl(icon.url) ??
    resolveMediaUrl(icon.thumbnailURL) ??
    resolveMediaUrl(icon.sizes?.icon?.url) ??
    null
  );
}

async function fetchAllPages<T>(baseUrl: string, label: string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}limit=200&page=${page}`;
    console.log(`[species-taxonomy] Fetching ${label} page ${page}...`);

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch ${label}: ${res.status} ${text}`);
    }

    const data = (await res.json()) as PayloadListResponse<T>;
    all.push(...(data.docs ?? []));
    hasNext = Boolean(data.hasNextPage);
    page++;
  }

  console.log(`[species-taxonomy] Loaded ${all.length} ${label}`);
  return all;
}

export async function fetchSpeciesTaxonomy(): Promise<SpeciesTaxonomy> {
  console.log("[species-taxonomy] Building category → species tree from Payload...");

  const [categories, speciesList] = await Promise.all([
    fetchAllPages<PayloadSpeciesCategory>(
      `${PAYLOAD_URL}/api/species-categories?depth=1&sort=name`,
      "species-categories"
    ),
    fetchAllPages<PayloadSpecies>(
      `${PAYLOAD_URL}/api/species?depth=1&sort=name`,
      "species"
    ),
  ]);

  const speciesByCategory = new Map<number, SpeciesChild[]>();
  const uncategorizedSpecies: SpeciesChild[] = [];

  for (const species of speciesList) {
    const child: SpeciesChild = {
      id: species.id,
      name: species.name,
      latinName: species.latinName ?? null,
      bpId: species.bpId ?? null,
    };

    const category = species.category;
    const categoryId = typeof category === "number" ? category : category?.id;

    if (categoryId == null) {
      uncategorizedSpecies.push(child);
      continue;
    }

    if (!speciesByCategory.has(categoryId)) speciesByCategory.set(categoryId, []);
    speciesByCategory.get(categoryId)!.push(child);
  }

  for (const list of speciesByCategory.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "hu"));
  }
  uncategorizedSpecies.sort((a, b) => a.name.localeCompare(b.name, "hu"));

  const categoriesWithSpecies: CategoryWithSpecies[] = categories.map((cat) => {
    const group =
      cat.group && typeof cat.group === "object"
        ? { id: cat.group.id, name: cat.group.name }
        : null;

    return {
      id: cat.id,
      name: cat.name,
      latinName: cat.latinName,
      isPriority: Boolean(cat.isPriority),
      showInQuickFilter: Boolean(cat.showInQuickFilter),
      quickFilterOrder: cat.quickFilterOrder ?? null,
      iconUrl: iconUrlFromUpload(cat.icon),
      group,
      species: speciesByCategory.get(cat.id) ?? [],
    };
  });

  const taxonomy: SpeciesTaxonomy = {
    fetchedAt: new Date().toISOString(),
    stats: {
      categoryCount: categoriesWithSpecies.length,
      speciesCount: speciesList.length,
      uncategorizedSpeciesCount: uncategorizedSpecies.length,
    },
    categories: categoriesWithSpecies,
    uncategorizedSpecies,
  };

  console.log(
    `[species-taxonomy] Tree ready: ${taxonomy.stats.categoryCount} categories, ` +
      `${taxonomy.stats.speciesCount} species (${taxonomy.stats.uncategorizedSpeciesCount} uncategorized)`
  );

  return taxonomy;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSpeciesTaxonomyHtml(taxonomy: SpeciesTaxonomy): string {
  const categoryBlocks = taxonomy.categories
    .map((cat) => {
      const icon = cat.iconUrl
        ? `<img src="${escapeHtml(cat.iconUrl)}" alt="" width="32" height="32" />`
        : `<span class="no-icon">?</span>`;

      const meta = [
        cat.latinName,
        cat.group ? cat.group.name : null,
        cat.showInQuickFilter ? `quick-filter #${cat.quickFilterOrder ?? "—"}` : null,
        cat.isPriority ? "priority" : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const speciesItems =
        cat.species.length === 0
          ? `<li class="empty">— nincs species —</li>`
          : cat.species
              .map(
                (s) =>
                  `<li><strong>${escapeHtml(s.name)}</strong>` +
                  (s.latinName ? ` <em>${escapeHtml(s.latinName)}</em>` : "") +
                  ` <span class="id">#${s.id}</span></li>`
              )
              .join("");

      return `
        <section class="category">
          <header>
            ${icon}
            <div>
              <h2>${escapeHtml(cat.name)} <span class="id">#${cat.id}</span></h2>
              <p class="meta">${escapeHtml(meta)} · ${cat.species.length} species</p>
            </div>
          </header>
          <ul class="species">${speciesItems}</ul>
        </section>`;
    })
    .join("");

  const uncategorized =
    taxonomy.uncategorizedSpecies.length === 0
      ? ""
      : `<section class="uncategorized">
          <h2>Kategorizálatlan species (${taxonomy.uncategorizedSpecies.length})</h2>
          <ul class="species">${taxonomy.uncategorizedSpecies
            .map(
              (s) =>
                `<li><strong>${escapeHtml(s.name)}</strong>` +
                (s.latinName ? ` <em>${escapeHtml(s.latinName)}</em>` : "") +
                ` <span class="id">#${s.id}</span></li>`
            )
            .join("")}</ul>
        </section>`;

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Species taxonomy</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 24px; background: #0f1115; color: #e8e8e3; }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    .summary { color: #9a9a94; margin-bottom: 24px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
    .category, .uncategorized { background: #1a1d24; border: 1px solid #2a2f3a; border-radius: 12px; padding: 16px; }
    .category header { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
    .category h2, .uncategorized h2 { margin: 0; font-size: 1.05rem; }
    .meta { margin: 4px 0 0; color: #8a8a86; font-size: 0.85rem; }
    .id { color: #6f7cff; font-weight: normal; font-size: 0.8rem; }
    ul.species { margin: 0; padding-left: 18px; }
    ul.species li { margin: 4px 0; line-height: 1.35; }
    ul.species li.empty { color: #7a7a76; list-style: none; margin-left: -18px; }
    em { color: #b8b8b2; font-style: italic; }
    .no-icon { display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; background: #2a2f3a; border-radius: 8px; color: #7a7a76; }
    .uncategorized { margin-top: 24px; }
  </style>
</head>
<body>
  <h1>Species taxonomy</h1>
  <p class="summary">
    ${taxonomy.stats.categoryCount} category · ${taxonomy.stats.speciesCount} species ·
    fetched ${escapeHtml(taxonomy.fetchedAt)}
  </p>
  <div class="grid">${categoryBlocks}</div>
  ${uncategorized}
</body>
</html>`;
}
