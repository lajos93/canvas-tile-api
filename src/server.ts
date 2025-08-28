import express from "express";
import tilesRouter from "./routes/tiles";

const app = express();
const PORT = process.env.PORT || 3001;

// /tiles 
app.use("/tiles", tilesRouter);

app.listen(PORT, () => {
  console.log(`Tile server running on port ${PORT}`);
});
