export function tileBBox(x: number, y: number, z: number) {
  const n = 2 ** z;

  const lon_left = (x / n) * 360 - 180;
  const lon_right = ((x + 1) / n) * 360 - 180;

  const lat_top =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const lat_bottom =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;

  return { lon_left, lon_right, lat_top, lat_bottom };
}