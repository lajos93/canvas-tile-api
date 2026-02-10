import { Router, Request, Response } from "express";
import { PAYLOAD_URL } from "../utils/config";
import { appendIconForPoint } from "../utils/appendIconForPoint";
import { uploadToS3 } from "../utils/s3/s3Utils";

const router = Router();

interface AddTreeWorkflowBody {
  lat: number;
  lon: number;
  speciesId: number;
  county?: string;
}

interface PayloadTreeDoc {
  id: number;
  lat?: number;
  lon?: number;
  species?:
    | number
    | {
        id?: number;
        category?:
          | number
          | {
              id?: number;
            };
      };
}

router.post("/", async (req: Request, res: Response) => {
  const startedAt = new Date().toISOString();

  const body = req.body as AddTreeWorkflowBody;
  const { lat, lon, speciesId, county } = body;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    typeof speciesId !== "number" ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return res.status(400).json({
      ok: false,
      error:
        "Invalid body: lat (-90..90), lon (-180..180) and speciesId (number) are required",
    });
  }

  if (!PAYLOAD_URL) {
    return res.status(500).json({
      ok: false,
      error: "PAYLOAD_URL environment variable not set",
    });
  }

  const phases: {
    dbInsert: { ok: boolean; error?: string | null; treeId?: number | null };
    appendIcon: {
      ok: boolean;
      error?: string | null;
      tilesUpdated?: number;
      zoomLevels?: number[];
      categoryId?: number | null;
      categorySlug?: string;
    };
  } = {
    dbInsert: { ok: false, error: null, treeId: null },
    appendIcon: { ok: false, error: null },
  };

  let treeDoc: PayloadTreeDoc | null = null;

  try {
    // Phase 1: insert tree into Payload (DB)
    const createRes = await fetch(`${PAYLOAD_URL}/api/trees`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        species: speciesId,
        lat,
        lon,
        ...(county ? { county } : {}),
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      const msg = text || `Payload create tree error: ${createRes.status}`;
      phases.dbInsert.error = msg;
      throw new Error(msg);
    }

    const created = (await createRes.json()) as PayloadTreeDoc;
    treeDoc = created;
    phases.dbInsert.ok = true;
    phases.dbInsert.treeId = created.id ?? null;

    // Try to derive categoryId from response (best effort)
    let categoryId: number | undefined;
    const speciesField = created.species;
    if (typeof speciesField === "number") {
      // We don't have category info in this shape
      categoryId = undefined;
    } else if (speciesField && typeof speciesField === "object") {
      const cat = speciesField.category;
      if (typeof cat === "number") {
        categoryId = cat;
      } else if (cat && typeof cat === "object" && typeof cat.id === "number") {
        categoryId = cat.id;
      }
    }

    // Phase 2: append icon on tiles (no full regenerate, just our append-icon logic)
    try {
      const appendResult = await appendIconForPoint({
        lat,
        lon,
        categoryId,
      });

      phases.appendIcon.ok = true;
      phases.appendIcon.tilesUpdated = appendResult.tilesUpdated;
      phases.appendIcon.zoomLevels = appendResult.zoomLevels;
      phases.appendIcon.categoryId = appendResult.categoryId;
      if (appendResult.categorySlug) {
        phases.appendIcon.categorySlug = appendResult.categorySlug;
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "append-icon phase failed (see server logs)";
      phases.appendIcon.ok = false;
      phases.appendIcon.error = msg;
      throw new Error(msg);
    }

    const finishedAt = new Date().toISOString();

    // Log workflow status to S3 as a new JSON file (do not overwrite previous status)
    try {
      const status = {
        type: "add-tree-workflow",
        startedAt,
        finishedAt,
        lat,
        lon,
        speciesId,
        treeId: phases.dbInsert.treeId ?? null,
        phases,
      };

      const key = `status/add-tree/${Date.now()}-${
        phases.dbInsert.treeId ?? "unknown"
      }.json`;

      await uploadToS3(
        key,
        Buffer.from(JSON.stringify(status, null, 2), "utf-8"),
        "application/json"
      );
    } catch (logErr) {
      console.error("[add-tree-workflow] Failed to log status to S3:", logErr);
    }

    return res.json({
      ok: true,
      treeId: phases.dbInsert.treeId ?? null,
      phases,
    });
  } catch (err) {
    console.error("[add-tree-workflow] Failed workflow:", err);

    const finishedAt = new Date().toISOString();

    // Also log failed workflow to S3 as its own file
    try {
      const status = {
        type: "add-tree-workflow",
        startedAt,
        finishedAt,
        lat,
        lon,
        speciesId,
        treeId: phases.dbInsert.treeId ?? null,
        phases,
        error:
          err instanceof Error
            ? err.message
            : "Unknown error during add-tree-workflow",
      };

      const key = `status/add-tree/${Date.now()}-${
        phases.dbInsert.treeId ?? "failed"
      }.json`;

      await uploadToS3(
        key,
        Buffer.from(JSON.stringify(status, null, 2), "utf-8"),
        "application/json"
      );
    } catch (logErr) {
      console.error("[add-tree-workflow] Failed to log FAILED status to S3:", logErr);
    }

    const message =
      err instanceof Error ? err.message : "Add tree workflow failed (see server logs)";

    // If DB insert succeeded but append-icon failed, use 502 to signal partial failure
    const statusCode = phases.dbInsert.ok && !phases.appendIcon.ok ? 502 : 500;

    return res.status(statusCode).json({
      ok: false,
      error: message,
      phases,
    });
  }
});

export default router;

