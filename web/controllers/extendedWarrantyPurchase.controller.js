import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import {
    resolveShopId,
    loadRegisteredProduct,
    loadEligiblePlans,
    buildExtendedWarrantyOffer,
    buildPdpExtendedWarrantyOffer,
    createDraftOrderCheckout,
    createPendingEntitlement,
    cancelPendingEntitlementForRegistration,
    getExtendedWarrantySettings,
    getNumericIdFromGid,
    canPurchaseExtendedWarranty,
    fetchProductPricing,
    resolvePlanRowForCheckout,
} from "../services/extendedWarranty.service.js";
import { normalizeWarrantyPricingType } from "../services/extendedWarrantyPricing.js";

/** GET offer data after standard registration. */
/**
 * Loads the extended-warranty offer for a completed registration so the
 * customer can review eligible plans immediately after the standard flow.
 */
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
/**
 * Starts extended-warranty purchase checkout by creating a draft order and
 * recording a pending entitlement before the invoice is sent to the customer.
 */
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

        const settings = await getExtendedWarrantySettings(shopId);

        const eligiblePlans = await loadEligiblePlans(shopId, registered);
        if (!eligiblePlans.some(p => p.plan_id === planId)) {
            return res.status(400).json({ error: "Plan not eligible for this registration" });
        }

        const eligibility = await canPurchaseExtendedWarranty(shopId, registerId, { session });
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

        const pricingType = normalizeWarrantyPricingType(settings.warranty_pricing_type);
        const variantPricing = await fetchProductPricing(session, registered);

        let resolvedPlanRow;
        try {
            resolvedPlanRow = await resolvePlanRowForCheckout({
                planRow,
                pricingType,
                variantPricing,
            });
        } catch (resolveErr) {
            return res.status(400).json({ error: resolveErr.message });
        }

        const draftOrder = await createDraftOrderCheckout({
            session,
            customerEmail: email,
            customerGid,
            registeredProduct: registered,
            planRow: resolvedPlanRow,
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
            planRow: resolvedPlanRow,
            draftOrderId: draftOrderNumericId ? String(draftOrderNumericId) : draftOrder.id,
            pricingType,
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
/**
 * Builds the cart payload for stores that prefer checkout through a mapped
 * Shopify variant instead of the draft-order invoice flow.
 */
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

        const eligibility = await canPurchaseExtendedWarranty(shopId, registerId, { session });
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

/** Cancel abandoned draft checkout when customer skips the EW offer. */
/**
 * Cancels any pending extended-warranty entitlement when the shopper skips the
 * offer so abandoned checkout state does not linger in the database.
 */
export async function cancelExtendedWarrantyPendingCheckout(req, res) {
    try {
        const session = res.locals.shopifySession;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const registerId = Number(req.body?.register_id);
        if (!Number.isFinite(registerId) || registerId <= 0) {
            return res.status(400).json({ error: "register_id is required" });
        }

        const shopId = await resolveShopId(session.shop);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const result = await cancelPendingEntitlementForRegistration(
            shopId,
            registerId
        );

        return res.json({ success: true, ...result });
    } catch (err) {
        console.error("❌ cancelExtendedWarrantyPendingCheckout error:", err);
        return res.status(500).json({ error: err.message || "Failed to cancel pending checkout" });
    }
}

function parseStorefrontNumericId(value) {
    if (value == null || value === "") return null;
    return getNumericIdFromGid(value) || Number(value) || null;
}

/**
 * Storefront PDP offer: shop is taken from the signed app-proxy session,
 * never from a client-supplied shopId. Product/variant IDs are hints that are
 * re-resolved against this shop's plan catalog.
 */
export async function getPdpExtendedWarrantyOffer(req, res) {
    try {
        const session = res.locals.shopifySession;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session.shop);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const source = req.method === "GET" ? req.query : req.body || {};
        const productId = parseStorefrontNumericId(source.product_id);
        const variantId = parseStorefrontNumericId(source.variant_id);
        const sku = source.sku ? String(source.sku).slice(0, 100) : null;
        const country = source.country ? String(source.country).slice(0, 10) : null;

        if (!productId) {
            return res.status(400).json({ error: "product_id is required" });
        }

        const offer = await buildPdpExtendedWarrantyOffer(shopId, {
            session,
            productId,
            variantId,
            sku,
            country,
        });

        return res.json({ success: true, ...offer });
    } catch (err) {
        console.error("❌ getPdpExtendedWarrantyOffer error:", err);
        return res.status(500).json({ error: "Failed to load PDP warranty offer" });
    }
}

/**
 * Re-validates the selected PDP plan server-side before the storefront adds
 * the mapped Shopify warranty variant to cart. Browser prices are ignored.
 */
export async function getPdpCartPayload(req, res) {
    try {
        const session = res.locals.shopifySession;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session.shop);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const productId = parseStorefrontNumericId(req.body?.product_id);
        const variantId = parseStorefrontNumericId(req.body?.variant_id);
        const planId = Number(req.body?.plan_id);

        if (!productId || !planId) {
            return res.status(400).json({ error: "product_id and plan_id are required" });
        }

        const offer = await buildPdpExtendedWarrantyOffer(shopId, {
            session,
            productId,
            variantId,
            sku: req.body?.sku || null,
            country: req.body?.country || null,
        });

        if (!offer.eligible) {
            return res.status(400).json({
                error: "Extended warranty is not available for this product",
                reason: offer.reason,
            });
        }

        const plan = (offer.plans || []).find(p => Number(p.planId) === planId);
        if (!plan) {
            return res.status(400).json({ error: "Plan not eligible for this product/variant" });
        }

        if (!plan.checkoutVariantId) {
            return res.status(400).json({
                error: "Checkout variant not configured for this plan",
            });
        }

        return res.json({
            success: true,
            method: "cart",
            variantId: plan.checkoutVariantId,
            properties: {
                _ew_type: "extended_warranty",
                _ew_source: "pdp",
                _ew_plan_id: String(plan.planId),
                _ew_product_id: String(productId),
                _ew_variant_id: String(variantId || ""),
            },
        });
    } catch (err) {
        console.error("❌ getPdpCartPayload error:", err);
        return res.status(500).json({ error: "Failed to build PDP cart payload" });
    }
}
