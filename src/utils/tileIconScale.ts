/** Per-zoom multiplier for baked tile icon pixel size (1 = legacy size). */
export type IconScaleByZoom = Record<number, number>;

/** z16–z17 icons were too large at 100%; 0.6 matches ~60% of legacy size. */
export const DEFAULT_ICON_SCALE_BY_ZOOM: IconScaleByZoom = {
  16: 0.6,
  17: 0.6,
};

export const ICON_SCALE_MIN = 0.3;
export const ICON_SCALE_MAX = 1.5;

export function iconScaleForZoom(z: number, overrides?: IconScaleByZoom): number {
  const raw = overrides?.[z] ?? DEFAULT_ICON_SCALE_BY_ZOOM[z] ?? 1;
  return Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, raw));
}

export function scaledIconSize(baseSize: number, z: number, overrides?: IconScaleByZoom): number {
  return Math.round(baseSize * iconScaleForZoom(z, overrides));
}

export function parseIconScaleByZoom(raw: unknown): IconScaleByZoom | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: IconScaleByZoom = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const z = Number(key);
    const scale = typeof val === "number" ? val : Number(val);
    if (!Number.isFinite(z) || z < 7 || z > 22 || !Number.isFinite(scale)) continue;
    out[z] = Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, scale));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
