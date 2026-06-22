import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import {
  resolveShopId,
  loadRegisteredProduct,
  loadEligiblePlans,
  buildExtendedWarrantyOffer,
  createDraftOrderCheckout,
  createPendingEntitlement,
  getExtendedWarrantySettings,
  getNumericIdFromGid,
  canPurchaseExtendedWarranty,
} from "../services/extendedWarranty.service.js";

/** GET offer data after standard registration. */
export async function getExtendedWarrantyOffer(req, res) {
  try {
    const session = res.locals.shopifySession;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const registerId = Number(req.query.register_id || req.body?.register_id);
    if (!registerId) {
      return res.status(400).json({ error: "register_id is required" });
    }

    const shopId = await resolveShopId(session.shop);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const offer = await buildExtendedWarrantyOffer(shopId, registerId, { session });

    return res.json({ success: true, ...offer });
  } catch (err) {
    console.error("❌ getExtendedWarrantyOffer error:", err);
    return res.status(500).json({ error: "Failed to load extended warranty offer" });
  }
}

/** POST initiate checkout (Draft Order → invoice URL). */
export async function initiateExtendedWarrantyCheckout(req, res) {
  try {
    const session = res.locals.shopifySession;
    const { shop, logged_in_customer_id } = req.query;

    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { register_id, plan_id, customer_email, customer_name } = req.body;
    const registerId = Number(register_id);
    const planId = Number(plan_id);

    if (!registerId || !planId) {
      return res.status(400).json({ error: "register_id and plan_id are required" });
    }

    const shopId = await resolveShopId(session.shop);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const settings = await getExtendedWarrantySettings(shopId);
    if (!settings.enabled) {
      return res.status(400).json({ error: "Extended warranty is disabled for this store" });
    }

    const registered = await loadRegisteredProduct(shopId, registerId);
    if (!registered) {
      return res.status(404).json({ error: "Registration not found" });
    }

    const [[planRow]] = await pool.query(
      `
      SELECT *
      FROM extended_warranty_plans
      WHERE shop_id = ? AND id = ? AND status = 'active'
      `,
      [shopId, planId]
    );

    if (!planRow) {
      return res.status(404).json({ error: "Warranty plan not found" });
    }

    const eligiblePlans = await loadEligiblePlans(
      shopId,
      registered,
      settings.region_code || null
    );
    if (!eligiblePlans.some(p => p.plan_id === planId)) {
      return res.status(400).json({ error: "Plan not eligible for this registration" });
    }

    const eligibility = await canPurchaseExtendedWarranty(shopId, registerId);
    if (!eligibility.eligible) {
      return res.status(400).json({
        error:
          eligibility.reason === "purchase_window_expired"
            ? "Extended warranty purchase window has expired"
            : "Extended warranty is not available for this registration",
        reason: eligibility.reason,
      });
    }

    const customerGid = logged_in_customer_id
      ? `gid://shopify/Customer/${logged_in_customer_id}`
      : null;
    const email = customer_email || registered.customer_email;

    const draftOrder = await createDraftOrderCheckout({
      session,
      customerEmail: email,
      customerGid,
      registeredProduct: registered,
      planRow,
      registerId,
      planId,
      settings,
    });

    if (!draftOrder?.invoiceUrl) {
      return res.status(500).json({ error: "Failed to create checkout" });
    }

    const draftOrderNumericId = getNumericIdFromGid(draftOrder.id);

    await createPendingEntitlement({
      shopId,
      registeredProductId: registerId,
      planId,
      planRow,
      draftOrderId: draftOrderNumericId ? String(draftOrderNumericId) : draftOrder.id,
    });

    return res.json({
      success: true,
      checkoutUrl: draftOrder.invoiceUrl,
      draftOrderId: draftOrder.id,
    });
  } catch (err) {
    console.error("❌ initiateExtendedWarrantyCheckout error:", err);
    return res.status(500).json({ error: err.message || "Failed to initiate checkout" });
  }
}

/** Optional cart-based checkout when admin maps a Shopify checkout variant. */
export async function getCartCheckoutPayload(req, res) {
  try {
    const session = res.locals.shopifySession;
    if (!session?.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { register_id, plan_id } = req.body;
    const registerId = Number(register_id);
    const planId = Number(plan_id);

    const shopId = await resolveShopId(session.shop);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const registered = await loadRegisteredProduct(shopId, registerId);
    const [[planRow]] = await pool.query(
      `SELECT * FROM extended_warranty_plans WHERE shop_id = ? AND id = ? AND status = 'active'`,
      [shopId, planId]
    );

    if (!registered || !planRow) {
      return res.status(404).json({ error: "Registration or plan not found" });
    }

    const eligibility = await canPurchaseExtendedWarranty(shopId, registerId);
    if (!eligibility.eligible) {
      return res.status(400).json({
        error: "Extended warranty is not available for this registration",
        reason: eligibility.reason,
      });
    }

    if (!planRow.shopify_checkout_variant_id) {
      return res.status(400).json({
        error: "Checkout variant not configured for this plan. Use draft order checkout.",
      });
    }

    const settings = await getExtendedWarrantySettings(shopId);

    return res.json({
      success: true,
      method: "cart",
      variantId: planRow.shopify_checkout_variant_id,
      properties: {
        _ew_type: "extended_warranty",
        _ew_register_id: String(registerId),
        _ew_plan_id: String(planId),
        _ew_serial: registered.serial_number,
        _parent_product_id: String(registered.shopify_product_id || ""),
      },
    });
  } catch (err) {
    console.error("❌ getCartCheckoutPayload error:", err);
    return res.status(500).json({ error: "Failed to build cart payload" });
  }
}
