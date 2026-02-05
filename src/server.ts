import "dotenv/config";
import express from "express";

import tilesRouter from "./routes/tiles";
import generateRouter from "./routes/generate";
import regenerateTilesRouter from "./routes/regenerateTiles";
import generateTileRouter from "./routes/generateTile";
import generateRegionRouter from "./routes/generateRegion";
import speciesRouter from "./routes/species";
import statusRouter from "./routes/status";

const app = express();
const PORT = process.env.PORT || 3001;

// hogy a PUT /status működjön JSON body-val
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

// manual: generate one tile per zoom 10–15 for a point (POST body: { lat, lon, categoryId })
app.use("/generate-tile", generateTileRouter);

// region: generate default tiles for a bbox (POST body: { latMin, latMax, lonMin, lonMax, zoomLevels? })
app.use("/generate-region", generateRegionRouter);

// species categories
app.use("/species", speciesRouter);

// 🩺 status.json lekérés és módosítás (GET + PUT)
app.use("/status", statusRouter);

app.listen(PORT, () => {
  console.log(`[server] canvas-tile-api started on port ${PORT}`);
});
