import express from 'express';
import { createCanvas } from 'canvas';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/canvas', (req, res) => {
  const width = 400;
  const height = 200;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff';
  ctx.font = '30px Arial';
  ctx.fillText('Hello Render Canvas!', 50, 100);


  const buffer = canvas.toBuffer('image/png');
  res.setHeader('Content-Type', 'image/png');
  res.end(buffer);
});


app.listen(PORT, () => {
  console.log(`Canvas API running on port ${PORT}`);
});
