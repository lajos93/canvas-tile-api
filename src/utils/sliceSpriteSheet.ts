import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { SPRITE_ICON_NAMES } from "../icons/iconNames";

const ALPHA_THRESHOLD = 16;
const MIN_COMPONENT_PIXELS = 200;
const MIN_BBOX_SIDE_PX = 40;
const AVIF_QUALITY = 80;

export interface IconBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
  centerX: number;
  centerY: number;
}

export interface SliceSpriteSheetOptions {
  inputPath: string;
  outputDir: string;
  names?: readonly string[];
}

export interface SlicedIconResult {
  index: number;
  name: string;
  filename: string;
  bbox: IconBoundingBox;
  cropSize: { width: number; height: number };
  canvasSize: number;
  outputPath: string;
}

function log(message: string) {
  console.log(`[slice-icons] ${message}`);
}

function findConnectedComponents(
  width: number,
  height: number,
  data: Buffer
): IconBoundingBox[] {
  const total = width * height;
  const parent = new Int32Array(total);
  for (let i = 0; i < total; i++) parent[i] = i;

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };

  const unite = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    mask[i] = data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;

      if (x > 0 && mask[idx - 1]) unite(idx, idx - 1);
      if (y > 0 && mask[idx - width]) unite(idx, idx - width);
      if (x > 0 && y > 0 && mask[idx - width - 1]) unite(idx, idx - width - 1);
      if (x < width - 1 && y > 0 && mask[idx - width + 1]) unite(idx, idx - width + 1);
    }
  }

  const components = new Map<
    number,
    { minX: number; minY: number; maxX: number; maxY: number; pixelCount: number }
  >();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;

      const root = find(idx);
      let box = components.get(root);
      if (!box) {
        box = { minX: x, minY: y, maxX: x, maxY: y, pixelCount: 0 };
        components.set(root, box);
      }

      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
      box.pixelCount++;
    }
  }

  return [...components.values()]
    .filter((box) => box.pixelCount >= MIN_COMPONENT_PIXELS)
    .filter((box) => {
      const w = box.maxX - box.minX + 1;
      const h = box.maxY - box.minY + 1;
      return w >= MIN_BBOX_SIDE_PX && h >= MIN_BBOX_SIDE_PX;
    })
    .map((box) => ({
      ...box,
      centerX: (box.minX + box.maxX) / 2,
      centerY: (box.minY + box.maxY) / 2,
    }));
}

function sortComponentsRowMajor(components: IconBoundingBox[]): IconBoundingBox[] {
  if (components.length === 0) return components;

  const sortedByY = [...components].sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const rowTolerance = Math.max(
    8,
    Math.round(
      sortedByY.reduce((sum, c) => sum + (c.maxY - c.minY + 1), 0) / sortedByY.length / 2
    )
  );

  const rows: IconBoundingBox[][] = [];
  for (const component of sortedByY) {
    const row = rows.find(
      (group) => Math.abs(group[0].centerY - component.centerY) <= rowTolerance
    );
    if (row) row.push(component);
    else rows.push([component]);
  }

  rows.sort((a, b) => a[0].centerY - b[0].centerY);
  for (const row of rows) row.sort((a, b) => a.centerX - b.centerX);

  return rows.flat();
}

function uniqueFilename(baseName: string, used: Set<string>): string {
  let candidate = `${baseName}.avif`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }

  let counter = 2;
  while (used.has(`${baseName}-${counter}.avif`)) counter++;
  candidate = `${baseName}-${counter}.avif`;
  used.add(candidate);
  return candidate;
}

export async function sliceSpriteSheet(
  options: SliceSpriteSheetOptions
): Promise<SlicedIconResult[]> {
  const names = options.names ?? SPRITE_ICON_NAMES;

  log(`Reading sprite sheet: ${options.inputPath}`);
  const inputPath = path.resolve(options.inputPath);
  const outputDir = path.resolve(options.outputDir);

  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height) {
    throw new Error("Could not read sprite sheet dimensions");
  }

  log(`Sprite sheet size: ${width}×${height}px`);

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(`Expected RGBA input, got ${info.channels} channels`);
  }

  log("Running connected-component analysis on alpha channel...");
  const components = sortComponentsRowMajor(findConnectedComponents(width, height, data));
  log(`Detected ${components.length} icon(s)`);

  if (components.length === 0) {
    throw new Error("No icons detected in sprite sheet");
  }

  if (components.length !== names.length) {
    log(
      `Warning: detected ${components.length} icons but ${names.length} names provided — using min count`
    );
  }

  const count = Math.min(components.length, names.length);
  await fs.mkdir(outputDir, { recursive: true });
  log(`Output directory: ${outputDir}`);

  const cropSizes: { width: number; height: number }[] = [];

  for (let i = 0; i < count; i++) {
    const box = components[i];
    const cropWidth = box.maxX - box.minX + 1;
    const cropHeight = box.maxY - box.minY + 1;
    cropSizes.push({ width: cropWidth, height: cropHeight });

    log(
      `#${i + 1} ${names[i]}: bbox=(${box.minX},${box.minY})–(${box.maxX},${box.maxY}) ` +
        `${cropWidth}×${cropHeight}px`
    );
  }

  const canvasSize = Math.max(...cropSizes.map((s) => Math.max(s.width, s.height)));
  log(
    `Unified square canvas: ${canvasSize}×${canvasSize}px (tight crop, centered, no scaling) → AVIF q${AVIF_QUALITY}`
  );

  const usedFilenames = new Set<string>();
  const results: SlicedIconResult[] = [];

  for (let i = 0; i < count; i++) {
    const box = components[i];
    const name = names[i];
    const filename = uniqueFilename(name, usedFilenames);
    const outputPath = path.join(outputDir, filename);

    const cropWidth = box.maxX - box.minX + 1;
    const cropHeight = box.maxY - box.minY + 1;

    const cropped = await sharp(inputPath)
      .extract({ left: box.minX, top: box.minY, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();

    const offsetX = Math.floor((canvasSize - cropWidth) / 2);
    const offsetY = Math.floor((canvasSize - cropHeight) / 2);

    await sharp({
      create: {
        width: canvasSize,
        height: canvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: cropped, left: offsetX, top: offsetY }])
      .avif({ quality: AVIF_QUALITY })
      .toFile(outputPath);

    log(`Saved ${filename} (${canvasSize}×${canvasSize} AVIF) → ${outputPath}`);

    results.push({
      index: i + 1,
      name,
      filename,
      bbox: box,
      cropSize: { width: cropWidth, height: cropHeight },
      canvasSize,
      outputPath,
    });
  }

  log(`Done — exported ${results.length} icon(s) to ${outputDir}`);
  return results;
}
