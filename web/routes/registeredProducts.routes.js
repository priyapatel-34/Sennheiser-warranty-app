import express from "express";
import { registeredProducts, deleteRegisteredProduct } from "../controllers/registeredProducts.controller.js";

const router = express.Router();

router.get("/", registeredProducts);
router.delete("/:id", deleteRegisteredProduct);

export default router;


