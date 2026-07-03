import express from "express";
import {
  getEmailSettings,
  saveEmailSettings,
  previewEmailSettings,
} from "../controllers/emailSettings.controller.js";

const router = express.Router();

router.get("/", getEmailSettings);
router.put("/", saveEmailSettings);
router.post("/preview", previewEmailSettings);

export default router;
