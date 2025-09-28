import { Router } from "express";
import { PAYLOAD_URL } from "../utils/config";

const router = Router();

/**
 * 🌱 Species categories list
 */
router.get("/", async (_req, res) => {
  try {
    if (!PAYLOAD_URL) {
      return res.status(500).json({ error: "PAYLOAD_URL environment variable not set" });
    }

    const response = await fetch(
      `${PAYLOAD_URL}/api/species-categories?limit=50&sort=name`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch species categories: ${response.statusText}`);
    }

    const data = await response.json();

    // ha csak a docs kell
    res.json(data.docs);
  } catch (err) {
    console.error("Error fetching species categories:", err);
    res.status(500).json({ error: "Error fetching species categories" });
  }
});

export default router;
