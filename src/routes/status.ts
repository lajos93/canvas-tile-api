import { Router } from "express";
import { s3, bucketName } from "../utils/s3/s3Client";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import mergeWith from "lodash.mergewith";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const data = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: "status.json",
      })
    );
    const text = await data.Body?.transformToString();
    res.json(JSON.parse(text || "{}"));
  } catch (err) {
    console.error("Error reading status.json:", err);
    res.status(404).json({ error: "status.json not found" });
  }
});

/**
 * PUT /status – manually update status.json.
 * Body: { key1: "value", key2: "value" }
 */
function customMerge(objValue: any, srcValue: any) {
  if (Array.isArray(objValue)) {
    return srcValue;
  }
}

router.put("/", async (req, res) => {
  try {
    const newData = req.body;
    if (!newData || typeof newData !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    let currentData: any = {};
    try {
      const existing = await s3.send(
        new GetObjectCommand({ Bucket: bucketName, Key: "status.json" })
      );
      const text = await existing.Body?.transformToString();
      currentData = JSON.parse(text || "{}");
    } catch {
      console.warn("status.json not found — will create new file");
    }

    const merged = mergeWith({}, currentData, newData, customMerge);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: "status.json",
        Body: JSON.stringify(merged, null, 2),
        ContentType: "application/json",
      })
    );

    res.json({
      message: "status.json updated (arrays replaced)",
      data: merged,
    });
  } catch (err) {
    console.error("Error updating status.json:", err);
    res.status(500).json({ error: "Failed to update status.json" });
  }
});


export default router;
