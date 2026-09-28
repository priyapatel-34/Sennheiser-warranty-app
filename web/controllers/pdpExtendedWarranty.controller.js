import { resolveShopId } from "../services/extendedWarranty.service.js";
import {
  buildPdpExtendedWarrantyOffer,
  buildPdpWarrantyCartPayload,
} from "../services/pdpExtendedWarrantyOffer.service.js";

// Reads a positive Shopify numeric id from a query or JSON field.
function numericId(value) {
  const numeric = Number(String(value || "").split("/").pop());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

// Returns configured extended-warranty plans for a product variant on the PDP or cart.
export async function getPdpExtendedWarrantyOffer(req, res) {
  try {
    const session = res.locals.shopifySession;
    if (!session?.shop) {
      return res.status(401).json({ eligible: false, error: "Unauthorized" });
    }

    const productId = numericId(req.query.product_id || req.body?.product_id);
    const variantId = numericId(req.query.variant_id || req.body?.variant_id);
    if (!productId) {
      return res.status(400).json({ eligible: false, error: "product_id is required" });
    }

    const shopId = await resolveShopId(session.shop);
    if (!shopId) {
      return res.status(404).json({ eligible: false, error: "Shop not registered" });
    }

    const offer = await buildPdpExtendedWarrantyOffer({
      session,
      shopId,
      productId,
      variantId,
    });
    return res.json(offer);
  } catch (err) {
    console.error("❌ getPdpExtendedWarrantyOffer error:", err);
    return res.status(500).json({
      eligible: false,
      error: "Failed to load warranty plans",
    });
  }
}

// Returns the Shopify variant id used to add the selected plan as a nested cart line.
export async function getPdpExtendedWarrantyCartPayload(req, res) {
  try {
    const session = res.locals.shopifySession;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const productId = numericId(req.body?.product_id);
    const variantId = numericId(req.body?.variant_id);
    const planId = numericId(req.body?.plan_id);
    if (!productId || !planId) {
      return res.status(400).json({ error: "product_id and plan_id are required" });
    }

    const shopId = await resolveShopId(session.shop);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const payload = await buildPdpWarrantyCartPayload({
      session,
      shopId,
      productId,
      variantId,
      planId,
    });
    if (!payload) {
      return res.status(404).json({ error: "Warranty plan not found" });
    }
    if (payload.error || !payload.variantId) {
      return res.status(400).json({
        error: payload.error || "Checkout variant not configured for this plan",
      });
    }

    return res.json(payload);
  } catch (err) {
    console.error("❌ getPdpExtendedWarrantyCartPayload error:", err);
    return res.status(500).json({ error: "Warranty payload could not be created" });
  }
}
