import "dotenv/config";
import express from "express";

import tilesRouter from "./routes/tiles";
import generateRouter from "./routes/generate";

const app = express();
const PORT = process.env.PORT || 3001;

// health check / root
app.get("/", (_, res) => {
  res.send("Tile server is running 🚀");
});

// runtime tile rendering
app.use("/tiles", tilesRouter);

// batch tile generation + control
app.use("/generate", generateRouter);

app.listen(PORT, () => {
  console.log(`Tile server running on port ${PORT}`);
});
