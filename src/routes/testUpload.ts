import { Router } from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { tileBBox, fetchTreesInBBox, drawTreesOnCanvas } from "../utils/utils";

const router = Router();

// AWS S3 client
const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const bucketName = process.env.S3_BUCKET!;
const payloadUrl = process.env.PAYLOAD_URL!;

// Teszt endpoint
router.get("/test-upload", async (req, res) => {
  try {
    // Példa tile koordináták
    const z = 6, x = 34, y = 42;

    // Bounding box számítás
    const bbox = tileBBox(x, y, z);

    // Fák betöltése Payload-ból
    const trees = await fetchTreesInBBox(payloadUrl, bbox);

    // Tile renderelés
    const canvas = drawTreesOnCanvas(trees, bbox);
    const buffer = canvas.toBuffer();

    // Feltöltés S3-ba
    const key = `tiles/${z}/${x}/${y}.png`;

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: "image/png",
    }));

    // Visszaküldjük az elérhetőséget
    const url = `https://${bucketName}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
    res.send(`Feltöltve: ${url}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Hiba történt az S3 feltöltésnél");
  }
});

export default router;
