import express from "express";
import {
  getEWDurations,
  addEWDuration,
  deleteEWDuration,
  getWarrantyProducts,
  getProductVariants,
  getWarrantyPlans,
  saveWarrantyPlanMapping,
  deleteEWPlan,
  getEWSettings,
  saveEWSettings,
} from "../controllers/extendedWarranty.controller.js";

const router = express.Router();

router.get("/durations", getEWDurations);
router.post("/durations", addEWDuration);
router.delete("/durations/:id", deleteEWDuration);

router.get("/settings", getEWSettings);
router.put("/settings", saveEWSettings);
router.post("/settings", saveEWSettings);

router.get("/products", getWarrantyProducts);
router.get("/products/:productId/variants", getProductVariants);
router.get("/variants/:variantId/plans", getWarrantyPlans);
router.post("/plans", saveWarrantyPlanMapping);
router.delete("/plans/:id", deleteEWPlan);

export default router;
