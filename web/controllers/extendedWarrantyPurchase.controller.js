import { pool } from "../db/mysql.js";
import {
    resolveShopId,
    loadRegisteredProduct,
    loadEligiblePlans,
    buildExtendedWarrantyOffer,
    buildPdpExtendedWarrantyOffer,
    // createDraftOrderCheckout,
    // createPendingEntitlement,
    // cancelPendingEntitlementForRegistration,
    getExtendedWarrantySettings,
    getNumericIdFromGid,
    canPurchaseExtendedWarranty,
    fetchProductPricing,
    resolvePlanRowForCheckout,
} from "../services/extendedWarranty.service.js";
import { ensurePlanCheckoutVariant } from "../services/extendedWarrantyCheckoutVariant.service.js";
import { normalizeWarrantyPricingType } from "../services/extendedWarrantyPricing.js";

function buildCartCheckoutUrl({ variantId, properties = {} }) {
    const params = new URLSearchParams();
    params.set("id", String(variantId));
    params.set("quantity", "1");
    params.set("return_to", "/checkout");

    for (const [key, value] of Object.entries(properties)) {
        if (value == null || value === "") continue;
        params.set(`properties[${key}]`, String(value));
    }

    return `/cart/add?${params.toString()}`;
}

async function resolveExtendedWarrantyCheckoutData({
    session,
    registerId,
    planId,
    customerEmail,
    customerGid,
    customerName,
}) {
    const shopId = await resolveShopId(session.shop);
    if (!shopId) {
        throw new Error("Shop not registered");
    }

    const registered = await loadRegisteredProduct(shopId, registerId);
    if (!registered) {
        throw new Error("Registration not found");
    }

    const [ rows ] = await pool.query(
    `SELECT *
     FROM extended_warranty_plans
     WHERE shop_id = $1
       AND id = $2
       AND status = 'active'
     LIMIT 1`,
    [shopId, planId]
);

const planRow = rows[0];

    if (!planRow) {
        throw new Error("Warranty plan not found");
    }

    const eligiblePlans = await loadEligiblePlans(shopId, registered);
    if (!eligiblePlans.some(p => Number(p.plan_id) === planId)) {
    throw new Error("Plan not eligible for this registration");
}

    const eligibility = await canPurchaseExtendedWarranty(shopId, registerId, { session });
    if (!eligibility.eligible) {
        throw new Error(
            eligibility.reason === "purchase_window_expired"
                ? "Extended warranty purchase window has expired"
                : "Extended warranty is not available for this registration"
        );
    }

    const settings = await getExtendedWarrantySettings(shopId);
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
        throw new Error(resolveErr.message);
    }

    if (!resolvedPlanRow.shopify_checkout_variant_id) {
    try {
        const checkoutVariantId = await ensurePlanCheckoutVariant({
            session,
            shopId,
            plan: {
                planId: planRow.id,
                planName: planRow.plan_name,
                price: resolvedPlanRow.price,
                calculatedPrice: resolvedPlanRow.calculated_price,
                durationMonths: planRow.duration_months,
                durationYears: planRow.duration_years,
                currency: planRow.currency,
            },
            parentVariantId: registered.shopify_variant_id,
        });

        resolvedPlanRow.shopify_checkout_variant_id = checkoutVariantId;
    } catch (ensureErr) {
        console.error("❌ Failed to ensure checkout variant:", ensureErr);
        throw new Error(
            "Failed to configure checkout for this plan: " + ensureErr.message
        );
    }
}

if (!resolvedPlanRow.shopify_checkout_variant_id) {
    throw new Error("Checkout variant not configured for this plan");
}

    return {
        shopId,
        registered,
        planRow: resolvedPlanRow,
        checkoutUrl: buildCartCheckoutUrl({
            variantId: resolvedPlanRow.shopify_checkout_variant_id,
            properties: {
                _ew_type: "extended_warranty",
                _ew_register_id: String(registerId),
                _ew_plan_id: String(planId),
                _ew_serial: registered.serial_number,
                _parent_product_id: String(registered.shopify_product_id || ""),
            },
        }),
        checkoutProperties: {
            _ew_type: "extended_warranty",
            _ew_register_id: String(registerId),
            _ew_plan_id: String(planId),
            _ew_serial: registered.serial_number,
            _parent_product_id: String(registered.shopify_product_id || ""),
        },
        customerEmail: customerEmail || registered.customer_email,
        customerGid,
        customerName: customerName || registered.customer_name || null,
        settings,
        pricingType,
    };
}

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

/** POST initiate checkout using a normal Shopify cart/checkout flow. */
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

        const customerGid = logged_in_customer_id
            ? `gid://shopify/Customer/${logged_in_customer_id}`
            : null;
        const checkoutData = await resolveExtendedWarrantyCheckoutData({
            session,
            registerId,
            planId,
            customerEmail: customer_email,
            customerGid,
            customerName: customer_name,
        });

        return res.json({
            success: true,
            checkoutUrl: checkoutData.checkoutUrl,
            checkoutProperties: checkoutData.checkoutProperties,
        });
    } catch (err) {
        console.error("❌ initiateExtendedWarrantyCheckout error:", err);
        return res.status(500).json({ error: err.message || "Failed to initiate checkout" });
    }
}

/**
 * Builds the cart payload for stores that prefer checkout through a mapped
 * Shopify variant instead of the old invoice-style flow.
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
        const checkoutData = await resolveExtendedWarrantyCheckoutData({
            session,
            registerId,
            planId,
        });

        return res.json({
            success: true,
            method: "cart",
            variantId: checkoutData.planRow.shopify_checkout_variant_id,
            properties: checkoutData.checkoutProperties,
            checkoutUrl: checkoutData.checkoutUrl,
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

        // const result = await cancelPendingEntitlementForRegistration(
        //     shopId,
        //     registerId
        // );

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
 * Simple PDP offer endpoint used by the storefront proxy script when the
 * full PDP offer implementation is not present. Returns a neutral response
 * (not eligible) so the frontend degrades gracefully instead of erroring.
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
        return res.status(500).json({ error: "Failed to load PDP offer" });
    }
}

/**
 * Simple PDP cart payload endpoint used by the storefront proxy script to
 * build a warranty payload for nested cart adds. Returns an error-like
 * not-configured response for now so calling code can handle it.
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

        if (!productId || !variantId || !planId) {
            return res.status(400).json({
                error: "product_id, variant_id, and plan_id are required",
            });
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

        const plan = (offer.plans || []).find((p) => Number(p.planId) === planId);
        if (!plan) {
            return res.status(400).json({ error: "Plan not eligible for this product/variant" });
        }

        let warrantyVariantId = parseStorefrontNumericId(plan.checkoutVariantId);
        if (
            !warrantyVariantId ||
            Number(warrantyVariantId) === Number(variantId)
        ) {
            try {
                warrantyVariantId = await ensurePlanCheckoutVariant({
                    session,
                    shopId,
                    plan,
                    parentVariantId: variantId,
                });
            } catch (provisionErr) {
                console.error("❌ Failed to provision warranty checkout variant:", provisionErr);
                return res.status(400).json({
                    error: "Checkout variant not configured for this plan",
                });
            }
        }

        if (
            !warrantyVariantId ||
            Number(warrantyVariantId) === Number(variantId)
        ) {
            return res.status(400).json({
                error: "Checkout variant not configured for this plan",
            });
        }

        return res.json({
            success: true,
            method: "cart",
            variantId: String(warrantyVariantId),
            parentVariantId: String(variantId),
            planId: String(plan.planId),
            planName: plan.planName || null,
            properties: {
                _ew_type: "extended_warranty",
                _ew_source: "pdp",
                _ew_plan_id: String(plan.planId),
                _ew_product_id: String(productId),
                _ew_variant_id: String(variantId),
            },
        });
    } catch (err) {
        console.error("❌ getPdpCartPayload error:", err);
        return res.status(500).json({ error: "Failed to build PDP cart payload" });
    }
}
