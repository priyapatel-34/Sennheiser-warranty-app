import express from "express";
import {
  getEWDurations,
  addEWDuration,
  getWarrantyProducts,
  getProductVariants,
  getWarrantyPlans,
  saveWarrantyPlanMapping,
} from "../controllers/extendedWarranty.controller.js";

const router = express.Router();

// Configuration – shop-level duration options
router.get("/durations", getEWDurations);
router.post("/durations", addEWDuration);

// Phase 2A APIs
router.get("/products", getWarrantyProducts);
router.get("/products/:productId/variants", getProductVariants);
router.get("/variants/:variantId/plans", getWarrantyPlans);
router.post("/plans", saveWarrantyPlanMapping);

export default router;
