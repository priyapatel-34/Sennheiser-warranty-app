import express from "express";
import {
    getEWDurations,
    addEWDuration,
    deleteEWDuration,
    getWarrantyProducts,
    searchExcludedWarrantyProducts,
    addWarrantyProductOverrides,
    removeWarrantyProductOverride,
    // getExcludedWarrantyProducts,
    getProductVariants,
    getWarrantyPlans,
    saveWarrantyPlanMapping,
    bulkSaveWarrantyPlanMapping,
    deleteEWProductPricing,
    deleteEWVariantPricing,
    deleteEWPlan,
    getEWSettings,
    saveEWSettings,
    updateEWDuration,
} from "../controllers/extendedWarranty.controller.js";
import {
    listEWRefundRequests,
    getEWRefundRequest,
    approveEWRefundRequest,
    rejectEWRefundRequest,
    completeEWRefundRequest,
    cancelEWRefundRequest,
    createEWManualRefundRequest,
    getEWRefundSettings,
    saveEWRefundSettings,
    exportEWRefundRequests,
} from "../controllers/extendedWarrantyRefund.controller.js";

const router = express.Router();

/**
 * Admin routes for configuring extended-warranty durations, plan mappings, and
 * refund settings.
 */
router.get("/durations", getEWDurations);
router.post("/durations", addEWDuration);
router.delete("/durations/:id", deleteEWDuration);

router.get("/settings", getEWSettings);
router.put("/settings", saveEWSettings);
router.post("/settings", saveEWSettings);

router.get("/products", getWarrantyProducts);
router.get("/products/excluded", searchExcludedWarrantyProducts);
router.post("/products/overrides", addWarrantyProductOverrides);
router.delete("/products/overrides/:productId", removeWarrantyProductOverride);
// router.get("/products/excluded", getExcludedWarrantyProducts);
router.get("/products/:productId/variants", getProductVariants);
router.get("/variants/:variantId/plans", getWarrantyPlans);
router.post("/plans", saveWarrantyPlanMapping);
router.post("/plans/bulk", bulkSaveWarrantyPlanMapping);

// Delete all pricing for one product
router.delete("/plans/product/:productId", deleteEWProductPricing);

// Delete all pricing for one variant
router.delete("/plans/variant/:variantId", deleteEWVariantPricing);

// Delete one pricing plan
router.delete("/plans/:id", deleteEWPlan);

router.post("/product-overrides", addWarrantyProductOverrides);
router.delete("/product-overrides/:productId", removeWarrantyProductOverride);

router.patch("/durations/:id", updateEWDuration);

router.get("/refunds/export", exportEWRefundRequests);
router.get("/refunds", listEWRefundRequests);
router.get("/refunds/settings", getEWRefundSettings);
router.put("/refunds/settings", saveEWRefundSettings);
router.post("/refunds/settings", saveEWRefundSettings);
router.get("/refunds/:id", getEWRefundRequest);
router.post("/refunds/:id/approve", approveEWRefundRequest);
router.post("/refunds/:id/reject", rejectEWRefundRequest);
router.post("/refunds/:id/complete", completeEWRefundRequest);
router.post("/refunds/:id/cancel", cancelEWRefundRequest);
router.post("/refunds/manual", createEWManualRefundRequest);

export default router;
