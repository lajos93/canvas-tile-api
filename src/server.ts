import express from "express";
import { createCanvas } from "canvas";
import { tileBBox } from "./utils";

const app = express();
const PORT = process.env.PORT || 3001;


// /node-version endpoint
app.get("/node-version", (req, res) => {
  res.send(`Node version: ${process.version}`);
});

// Tile endpoint: /tiles/:z/:x/:y.png
app.get("/tiles/:z/:x/:y.png", async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const tileSize = 256;

    const { lon_left, lon_right, lat_top, lat_bottom } = tileBBox(
      Number(x),
      Number(y),
      Number(z)
    );

    // Payload API URL environment variable-ből
    const payloadUrl = process.env.PAYLOAD_URL;
    if (!payloadUrl) {
      return res.status(500).send("PAYLOAD_URL environment variable not set");
    }

    // Pagination kezelés
    let allDocs: any[] = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      const url = `${payloadUrl}/api/trees?limit=5000&page=${page}&where[lat][greater_than_equal]=${lat_bottom}&where[lat][less_than_equal]=${lat_top}&where[lon][greater_than_equal]=${lon_left}&where[lon][less_than_equal]=${lon_right}`;
      console.log("Fetching URL:", url);

      const resp = await fetch(url);
      if (!resp.ok) {
        const text = await resp.text();
        console.error("Payload API error:", resp.status, text);
        return res.status(500).send("Error fetching data from Payload");
      }

      const data = await resp.json();
      console.log(
        "Tile bounding box:",
        lat_bottom,
        lat_top,
        lon_left,
        lon_right
      );
      console.log("Number of trees fetched:", data.docs.length);
      allDocs.push(...data.docs);
      hasNext = data.hasNextPage;
      page++;
    }

    // Canvas rajzolás
    const canvas = createCanvas(tileSize, tileSize);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, tileSize, tileSize);

    if (allDocs.length === 0) {
      // Teszt pont, ha nincs fa a tile-ban
      ctx.fillStyle = "red";
      ctx.fillRect(10, 10, 5, 5);
    } else {
      allDocs.forEach((tree: { lat: number; lon: number }) => {
        const px = ((tree.lon - lon_left) / (lon_right - lon_left)) * tileSize;
        const py = ((lat_top - tree.lat) / (lat_top - lat_bottom)) * tileSize;

        ctx.fillStyle = "green";
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    res.setHeader("Content-Type", "image/png");
    res.send(canvas.toBuffer());
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`Tile server running on port ${PORT}`);
});
