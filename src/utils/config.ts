// concurrency (default = 2)
// Kept at/below the Payload PG pool size (max=3) so parallel tile jobs don't
// exhaust DB connections and trigger "timeout exceeded when trying to connect".
export const TILE_UPLOAD_CONCURRENCY = parseInt(
  process.env.TILE_UPLOAD_CONCURRENCY ?? "2",
  10
);

// payload url (no trailing slash — avoids //api/... in fetch URLs)
export const PAYLOAD_URL = (() => {
  const url = process.env.PAYLOAD_URL;
  if (!url) throw new Error("PAYLOAD_URL environment variable not set");
  return url.replace(/\/+$/, "");
})();