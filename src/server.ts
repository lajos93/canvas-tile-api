import "dotenv/config";
import cors from "cors";
import express from "express";

import tilesRouter from "./routes/tiles";
import generateRouter from "./routes/generate";
import regenerateTilesRouter from "./routes/regenerateTiles";
import regenerateRegionRouter from "./routes/regenerateRegion";
import generateTileRouter from "./routes/generateTile";
import generateRegionRouter from "./routes/generateRegion";
import speciesRouter from "./routes/species";
import statusRouter from "./routes/status";
import appendIconRouter from "./routes/appendIcon";
import addTreeWorkflowRouter from "./routes/addTreeWorkflow";
import backupRouter from "./routes/backup";
import restoreFromBackupRouter from "./routes/restoreFromBackup";
import sliceIconsRouter from "./routes/sliceIcons";
import speciesTaxonomyRouter from "./routes/speciesTaxonomy";

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow frontend origins from env CORS_ORIGINS (comma-separated)
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin or server requests
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  })
);

// Allow large regenerate-region batches (chunks are small; this is a safety net).
const JSON_BODY_LIMIT = process.env.EXPRESS_JSON_LIMIT ?? "15mb";

// Allow PUT /status to accept JSON body
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// health check / root
app.get("/", (_, res) => {
  res.send("Tile server is running 🚀");
});

// runtime tile rendering
app.use("/tiles", tilesRouter);

// batch tile generation + control
app.use("/generate", generateRouter);

// webhook: regenerate tiles for a new tree (POST body: { treeId, lat, lon })
app.use("/regenerate-tiles", regenerateTilesRouter);

// batch: synchronous region / deduplicated tile list (admin pending publish)
app.use("/regenerate-region", regenerateRegionRouter);

// targeted refresh around a point / zoom selection (used by "Append" in the app)
app.use("/append-icon", appendIconRouter);

// orchestrated DB insert + append-icon workflow for new trees
app.use("/add-tree-workflow", addTreeWorkflowRouter);

// manual: generate one tile per zoom 10–15 for a point (POST body: { lat, lon, categoryId })
app.use("/generate-tile", generateTileRouter);

// region: generate default tiles for a bbox (POST body: { latMin, latMax, lonMin, lonMax, zoomLevels? })
app.use("/generate-region", generateRegionRouter);

// species categories
app.use("/species", speciesRouter);

// species-categories → species parent/child tree from Payload
app.use("/species-taxonomy", speciesTaxonomyRouter);

// status.json read/update (GET + PUT)
app.use("/status", statusRouter);

// backup: copy tiles to backup/{id}/tiles/... + status.json
app.use("/backup", backupRouter);

// restore: copy affected tiles from latest backup before treeCreatedAt back to live
app.use("/restore-from-backup", restoreFromBackupRouter);

// slice sprite sheet into individual 128×128 AVIF icons (src/icons/img.png → src/icons/output/)
app.use("/slice-icons", sliceIconsRouter);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`[server] canvas-tile-api started on port ${PORT}`);
});
