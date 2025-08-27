import express from 'express';
import { createCanvas } from 'canvas';

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/node-version', (req, res) => {
  res.send(`Node version: ${process.version}`);
});

// Tile endpoint: /tiles/:z/:x/:y.png
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const tileSize = 256;
    const n = 2 ** Number(z);

    // Tile -> koordináták
    const lon_left = (Number(x) / n) * 360 - 180;
    const lon_right = ((Number(x) + 1) / n) * 360 - 180;
    const lat_top = (Math.atan(Math.sinh(Math.PI * (1 - (2 * Number(y)) / n))) * 180) / Math.PI;
    const lat_bottom = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (Number(y) + 1)) / n))) * 180) / Math.PI;

    // Payload production API URL
    const payloadUrl = process.env.PAYLOAD_URL;
    if (!payloadUrl) {
      return res.status(500).send('PAYLOAD_URL environment variable not set');
    }

    // Lekérés Payload-tól
    const url = `${payloadUrl}/api/trees?limit=5000&where[lat][greater_than_equal]=${lat_bottom}&where[lat][less_than_equal]=${lat_top}&where[lon][greater_than_equal]=${lon_left}&where[lon][less_than_equal]=${lon_right}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return res.status(500).send('Failed to fetch data from Payload');
    }

    const data = await resp.json();

    // Canvas rajzolás
    const canvas = createCanvas(tileSize, tileSize);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, tileSize, tileSize);

    data.docs.forEach((tree: { lat: number; lon: number }) => {
      const px = ((tree.lon - lon_left) / (lon_right - lon_left)) * tileSize;
      const py = ((lat_top - tree.lat) / (lat_top - lat_bottom)) * tileSize;

      ctx.fillStyle = 'green';
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, 2 * Math.PI);
      ctx.fill();
    });

    res.setHeader('Content-Type', 'image/png');
    res.send(canvas.toBuffer());
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Tile server running on port ${PORT}`);
});
