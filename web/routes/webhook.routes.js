import express from "express";
import { getProductUpdateWebhook } from "../controllers/webhook.controller.js";

const router = express.Router();

router.post("/products/update", getProductUpdateWebhook);

export default router;
