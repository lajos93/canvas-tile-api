// concurrency (default = 5)
export const TILE_UPLOAD_CONCURRENCY = parseInt(
  process.env.TILE_UPLOAD_CONCURRENCY ?? "5",
  10
);

// payload url
export const PAYLOAD_URL = (() => {
  const url = process.env.PAYLOAD_URL;
  if (!url) throw new Error("PAYLOAD_URL environment variable not set");
  return url;
})();