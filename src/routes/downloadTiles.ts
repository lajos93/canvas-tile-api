import { Router } from "express";
import archiver from "archiver";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

const router = Router();

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const bucketName = process.env.S3_BUCKET!;

router.get("/download-tiles", async (req, res) => {
  try {
    res.attachment("tiles.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    let continuationToken: string | undefined = undefined;

    do {
      const listResponse: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "tiles/",
          ContinuationToken: continuationToken,
        })
      );

      if (listResponse.Contents) {
        for (const obj of listResponse.Contents) {
          if (!obj.Key) continue;

          const getObject = await s3.send(
            new GetObjectCommand({
              Bucket: bucketName,
              Key: obj.Key,
            })
          );

          if (!getObject.Body) continue;

          // Node.js Readable stream biztosítása
          const fileStream: Readable =
            getObject.Body instanceof Readable
              ? getObject.Body
              : Readable.fromWeb(getObject.Body as any);

          // Append a stream to the ZIP
          archive.append(fileStream, { name: obj.Key.replace(/^tiles\//, "") });
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    await archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating ZIP from S3 tiles.");
  }
});

export default router;
