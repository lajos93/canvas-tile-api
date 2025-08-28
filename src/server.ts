import { Router } from "express";
import tilesRouter from "./routes/tiles";

const router = Router();

// /tiles
router.use("/tiles", tilesRouter);

export default router;
