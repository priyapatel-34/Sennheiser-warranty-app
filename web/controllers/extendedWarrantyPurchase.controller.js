import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import {
    resolveShopId,
    loadRegisteredProduct,
    loadEligiblePlans,
    buildExtendedWarrantyOffer,
    getExtendedWarrantySettings,
    getNumericIdFromGid,
    canPurchaseExtendedWarranty,
} from "../services/extendedWarranty.service.js";
import {
    isIndiaShop,
    loadProductPreorderMap,
    shouldSuppressPaidExtendedWarranty,
} from "../services/indiaFreeExtendedWarranty.service.js";

function checkoutLineItemProperties(registered, registerId, planId) {
    return {
        _ew_type: "extended_warranty",
        _ew_register_id: String(registerId),
        _ew_plan_id: String(planId),
        _ew_serial: registered.serial_number || "",
        _parent_product_id: String(registered.shopify_product_id || ""),
    };
}

function buildCartAddCheckoutUrl(shop, variantId, properties) {
    const numericId = getNumericIdFromGid(variantId) || variantId;
    const params = new URLSearchParams();
    params.set("id", String(numericId));
    params.set("quantity", "1");
    for (const [key, value] of Object.entries(properties)) {
        if (value == null || value === "") continue;
        params.set(`properties[${key}]`, String(value));
    }
    params.set("return_to", "/checkout");
    return `https://${shop}/cart/add?${params.toString()}`;
}

async function resolveCheckoutVariantId({ session, planRow, settings }) {
    if (planRow?.shopify_checkout_variant_id) {
        return planRow.shopify_checkout_variant_id;
    }

    const productId = settings?.shopify_checkout_product_id;
    if (!productId || !session) return null;

    const productGid = String(productId).startsWith("gid://")
        ? String(productId)
        : `gid://shopify/Product/${productId}`;
    const admin = new shopify.api.clients.Graphql({ session });
    const response = await admin.request(
        `
        query CheckoutProductVariant($id: ID!) {
            product(id: $id) {
                variants(first: 1) {
                    nodes { id }
                }
            }
        }
        `,
        { variables: { id: productGid } }
    );

    return response.data?.product?.variants?.nodes?.[0]?.id || null;
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

/** POST initiate checkout (Shopify cart → checkout URL). */
/**
 * Starts extended-warranty purchase checkout by adding the mapped Shopify
 * variant to cart with registration metadata, then sending the customer to checkout.
 */
export async function initiateExtendedWarrantyCheckout(req, res) {
    try {
        const session = res.locals.shopifySession;

        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { register_id, plan_id } = req.body;
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

        const settings = await getExtendedWarrantySettings(shopId);
        const variantId = await resolveCheckoutVariantId({ session, planRow, settings });
        if (!variantId) {
            return res.status(400).json({
                error: "Checkout variant not configured for this plan.",
            });
        }

        const properties = checkoutLineItemProperties(registered, registerId, planId);

        return res.json({
            success: true,
            checkoutUrl: buildCartAddCheckoutUrl(session.shop, variantId, properties),
            variantId,
        });
    } catch (err) {
        console.error("❌ initiateExtendedWarrantyCheckout error:", err);
        return res.status(500).json({ error: err.message || "Failed to initiate checkout" });
    }
}

/** Optional cart-based checkout when admin maps a Shopify checkout variant. */
/**
 * Builds the cart payload for stores that prefer checkout through a mapped
 * Shopify variant.
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

        const settings = await getExtendedWarrantySettings(shopId);
        const variantId = await resolveCheckoutVariantId({ session, planRow, settings });
        if (!variantId) {
            return res.status(400).json({
                error: "Checkout variant not configured for this plan.",
            });
        }

        return res.json({
            success: true,
            method: "cart",
            variantId,
            properties: checkoutLineItemProperties(registered, registerId, planId),
        });
    } catch (err) {
        console.error("❌ getCartCheckoutPayload error:", err);
        return res.status(500).json({ error: "Failed to build cart payload" });
    }
}

export async function getIndiaPreorderSuppression(session, productId) {
    if (!isIndiaShop(session.shop)) return null;

    const client = new shopify.api.clients.Graphql({ session });
    const preorderMap = await loadProductPreorderMap(client, [productId]);
    const state = preorderMap.get(String(productId));
    if (
        state?.product &&
        shouldSuppressPaidExtendedWarranty(state.product, session.shop)
    ) {
        return {
            success: true,
            eligible: false,
            reason: "preorder_product",
        };
    }
    return null;
}
