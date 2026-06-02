import express from "express";
import { getProductDetail, getMyProducts, getUnregisteredProductDetail, getOrdersDetails , productAutocomplete , getRetailers, getStoreSettings, registerProducts} from "../controllers/warranty.controller.js";

const router = express.Router();

router.get("/my-products", getMyProducts);

router.post("/product-detail", getProductDetail);

router.get("/product/basic/:productId", getUnregisteredProductDetail);

router.post("/orders", getOrdersDetails);

router.get("/autocomplete/products", productAutocomplete);
router.get("/retailers", getRetailers);

router.get("/retailerSettings", getStoreSettings);

router.post("/register", registerProducts)


// router.post("/submit", submit);



export default router;


