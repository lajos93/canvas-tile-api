import "dotenv/config";
import cors from "cors";
import express from "express";

import tilesRouter from "./routes/tiles";
import generateRouter from "./routes/generate";
import regenerateTilesRouter from "./routes/regenerateTiles";
import generateTileRouter from "./routes/generateTile";
import generateRegionRouter from "./routes/generateRegion";
import speciesRouter from "./routes/species";
import statusRouter from "./routes/status";
import appendIconRouter from "./routes/appendIcon";
import addTreeWorkflowRouter from "./routes/addTreeWorkflow";

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

// Allow PUT /status to accept JSON body
app.use(express.json());

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

// status.json read/update (GET + PUT)
app.use("/status", statusRouter);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`[server] canvas-tile-api started on port ${PORT}`);
});
