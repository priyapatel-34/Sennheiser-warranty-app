import express from "express";
import {
  getStoreSettings,
  saveStoreSettings,
  getSerialVerificationSetting,
} from "../controllers/settings.controller.js";

const router = express.Router();

router.post("/", saveStoreSettings);

router.get("/requiredRetailer", getStoreSettings);

router.get("/serialVerification", getSerialVerificationSetting);

export default router;
