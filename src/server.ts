import "dotenv/config"; 

import express from "express";
import tilesRouter from "./routes/tiles";
import generateTilesRouter from "./routes/generateTiles";
import testUploadRouter from "./routes/testUpload";
import downloadTiles from "./routes/downloadTiles";
import lastTileRouter from "./routes/lastTile";


const app = express();
const PORT = process.env.PORT || 3001;

app.get("/", (req, res) => {
  res.send("Tile server is running 🚀");
});

// /tiles 
app.use("/tiles", tilesRouter);

// /admin/
app.use("/admin", generateTilesRouter);
app.use("/admin", lastTileRouter);


app.use("/admin", testUploadRouter);

app.use("/admin", downloadTiles);

app.listen(PORT, () => {
  console.log(`Tile server running on port ${PORT}`);
});
