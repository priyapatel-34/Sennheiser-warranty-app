import express from "express";
import { getStoreSettings, saveStoreSettings } from "../controllers/settings.controller.js";

const router = express.Router();

/**
 * Admin routes for the store-level retailer requirement setting.
 */
router.post("/", saveStoreSettings);

router.get("/requiredRetailer", getStoreSettings);

export default router;
