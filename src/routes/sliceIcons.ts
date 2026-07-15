import { Router, Request, Response } from "express";
import path from "path";
import { sliceSpriteSheet } from "../utils/sliceSpriteSheet";

const router = Router();

const DEFAULT_INPUT = path.resolve(process.cwd(), "src/icons/img.png");
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "src/icons/output");

/**
 * POST /slice-icons
 * Optional body: { inputPath?, outputDir?, paddingPx? }
 *
 * Slices src/icons/img.png into individual centered AVIF icons in src/icons/output/.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      inputPath?: string;
      outputDir?: string;
    };

    const inputPath =
      typeof body.inputPath === "string" && body.inputPath.trim()
        ? path.resolve(body.inputPath)
        : DEFAULT_INPUT;
    const outputDir =
      typeof body.outputDir === "string" && body.outputDir.trim()
        ? path.resolve(body.outputDir)
        : DEFAULT_OUTPUT;

    console.log("[slice-icons] Starting sprite sheet slice...");
    const results = await sliceSpriteSheet({ inputPath, outputDir });

    res.json({
      ok: true,
      inputPath,
      outputDir,
      canvasSize: results[0]?.canvasSize ?? 0,
      count: results.length,
      icons: results.map((icon) => ({
        index: icon.index,
        name: icon.name,
        filename: icon.filename,
        outputPath: icon.outputPath,
        bbox: icon.bbox,
        cropSize: icon.cropSize,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[slice-icons] Failed:", err);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * GET /slice-icons — same as POST with defaults (handy for quick local runs).
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    console.log("[slice-icons] Starting sprite sheet slice (GET)...");
    const results = await sliceSpriteSheet({
      inputPath: DEFAULT_INPUT,
      outputDir: DEFAULT_OUTPUT,
    });

    res.json({
      ok: true,
      inputPath: DEFAULT_INPUT,
      outputDir: DEFAULT_OUTPUT,
      canvasSize: results[0]?.canvasSize ?? 0,
      count: results.length,
      icons: results.map((icon) => ({
        index: icon.index,
        name: icon.name,
        filename: icon.filename,
        outputPath: icon.outputPath,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[slice-icons] Failed:", err);
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
