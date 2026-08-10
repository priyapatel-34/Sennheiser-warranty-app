import express from "express";
import {
  registeredProducts,
  getRegisteredProductDetail,
  deleteRegisteredProduct,
} from "../controllers/registeredProducts.controller.js";

const router = express.Router();

/**
 * Admin routes for browsing, inspecting, and deleting registered products.
 */
router.get("/", registeredProducts);
router.get("/:id", getRegisteredProductDetail);
router.delete("/:id", deleteRegisteredProduct);

export default router;


