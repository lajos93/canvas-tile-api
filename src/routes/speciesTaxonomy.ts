import { Router, Request, Response } from "express";
import { PAYLOAD_URL } from "../utils/config";
import {
  fetchSpeciesTaxonomy,
  renderSpeciesTaxonomyHtml,
} from "../utils/speciesTaxonomy";

const router = Router();

/**
 * GET /species-taxonomy
 * Query: format=json|html (default json)
 *
 * Lists Payload species-categories as parents with nested species children.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    const format = String(req.query.format ?? "json").toLowerCase();
    const taxonomy = await fetchSpeciesTaxonomy();

    if (format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(renderSpeciesTaxonomyHtml(taxonomy));
    }

    res.json(taxonomy);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[species-taxonomy] Failed:", err);
    res.status(500).json({ error: message });
  }
});

export default router;
