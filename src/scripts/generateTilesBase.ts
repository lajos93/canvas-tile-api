import sharp from "sharp";
import PQueue from "p-queue";
import { renderTileToBuffer } from "../utils/tileUtils";
import { uploadToS3 } from "../utils/s3/s3Utils";
import { updateStatusFile } from "../utils/s3/updateStatusFile";
import { TILE_UPLOAD_CONCURRENCY, PAYLOAD_URL } from "../utils/config";
import { isStopped } from "../utils/stopControl";

export interface TileCoord {
  x: number;
  y: number;
}

export async function generateTilesBase(
  zoom: number,
  categoryId: number | undefined,
  folderName: string,
  tiles: TileCoord[]
) {
  const queue = new PQueue({ concurrency: TILE_UPLOAD_CONCURRENCY });

  console.log(`🧱 Generating ${tiles.length} tiles (folder: ${folderName}, zoom: ${zoom})`);

  for (const { x, y } of tiles) {
    if (isStopped()) {
      console.log(`⏹️ Stopped before tile z${zoom} x${x} y${y}`);
      break;
    }

    queue.add(async () => {
      try {
        const buffer = await renderTileToBuffer(zoom, x, y, PAYLOAD_URL, categoryId);
        const avifBuffer = await sharp(buffer).avif({ quality: 30 }).toBuffer();
        const key = `tiles/category/${folderName}/${zoom}/${x}/${y}.avif`;

        await uploadToS3(key, avifBuffer, "image/avif");
        console.log(`✅ Uploaded tile z${zoom} x${x} y${y}`);
      } catch (err) {
        console.error(`❌ Tile failed z${zoom} x${x} y${y}`, err);
      }
    });
  }

  await queue.onIdle();

  await updateStatusFile({
    status: "finished",
    finishedAt: new Date().toISOString(),
    categoryId,
    zoom,
  });

  console.log(`🎉 Finished ${tiles.length} tiles for zoom ${zoom}`);
}
