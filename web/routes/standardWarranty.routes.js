import express from "express";
import { getSWDurations , addSWuration , getAllProducts, bulkUpdateWarranty } from "../controllers/standardWarranty.controller.js";

const router = express.Router();

/**
 * Admin routes for standard-warranty duration setup and bulk product mapping.
 */
router.get("/durations", getSWDurations);
router.post("/durations", addSWuration);


// PRODUCTS

router.get("/products", getAllProducts);
router.post("/bulk", bulkUpdateWarranty);

//router.get("/products", getProducts);
// router.post(
//   "/product/:productId",
//   saveProductWarrantyDuration
// );



export default router;


