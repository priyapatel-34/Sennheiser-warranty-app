import express from "express";
import {
  getEmailSettings,
  saveEmailSettings,
  previewEmailSettings,
} from "../controllers/emailSettings.controller.js";

const router = express.Router();

/**
 * Admin routes for loading, saving, and previewing email template settings.
 */
router.get("/", getEmailSettings);
router.put("/", saveEmailSettings);
router.post("/preview", previewEmailSettings);

export default router;
