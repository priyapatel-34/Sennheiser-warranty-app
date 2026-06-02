import express from "express";
import {  importRetailers , getRetailers } from "../controllers/retailers.controller.js";

const router = express.Router();

router.get("/", getRetailers);

router.post("/import", importRetailers);

export default router;


