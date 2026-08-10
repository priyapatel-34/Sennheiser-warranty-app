import express from "express";
import { sendEmail } from "../controllers/sendEmail.controller.js";

const router = express.Router();

/**
 * Minimal admin route for sending a manual test email through the shared mail
 * service.
 */
router.post("/sendmail", sendEmail);

export default router;
