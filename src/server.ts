import "dotenv/config"; 

import express from "express";
import tilesRouter from "./routes/tiles";
import generateTilesRouter from "./routes/generateTiles";
import testUploadRouter from "./routes/testUpload";

const app = express();
const PORT = process.env.PORT || 3001;

// /tiles 
app.use("/tiles", tilesRouter);

// /admin/
app.use("/admin", generateTilesRouter);

app.use("/admin", testUploadRouter);

app.listen(PORT, () => {
  console.log(`Tile server running on port ${PORT}`);
});
