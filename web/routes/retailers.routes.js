import express from "express";
import {
  importRetailers,
  getRetailers,
  updateRetailer,
  deleteRetailer,
} from "../controllers/retailers.controller.js";

const router = express.Router();

router.get("/", getRetailers);
router.post("/import", importRetailers);
router.put("/:id", updateRetailer);
router.delete("/:id", deleteRetailer);

export default router;
