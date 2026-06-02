import express from "express";
import { registeredProducts } from "../controllers/registeredProducts.controller.js";

const router = express.Router();

router.get("/", registeredProducts);

export default router;


