import express from "express";
import {
  listSerialNumbers,
  importSerialNumbers,
  addSerialNumber,
  deleteSerialNumber,
  validateSerialNumberHandler,
} from "../controllers/serialNumbers.controller.js";

const router = express.Router();

router.get("/", listSerialNumbers);
router.post("/", addSerialNumber);
router.post("/import", importSerialNumbers);
router.get("/validate", validateSerialNumberHandler);
router.delete("/:id", deleteSerialNumber);

export default router;
