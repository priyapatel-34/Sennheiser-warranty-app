import {
    resolveShopId,
    loadEligiblePlans,
    getExtendedWarrantySettings,
    attachMerchandisingBadges,
    mapPlanForApi,
    fetchVariantPricing,
    fetchProductPricing,
} from "../services/extendedWarranty.service.js";
import { normalizeWarrantyPricingType } from "../services/extendedWarrantyPricing.js";

/**
 * Dynamic, reusable Extended Warranty plans API.
 *
 * Shared by the PDP block, the Cart block, and (indirectly, via the same
 * `loadEligiblePlans` core) the existing post-registration offer screen —
 * one source of truth for eligibility, pricing, coverage and terms.
 *
 * Only plans with a real Shopify checkout variant are returned here, since
 * PDP/Cart need a sellable variant to add to the native Shopify cart. The
 * existing draft-order registration offer does not call this endpoint and
 * is unaffected.
 */
async function buildPlansForVariant({ shopId, session, settings, productId, variantId }) {
    if (!productId) {
        return { eligible: false, plans: [] };
    }

    const registeredProductLike = {
        shopify_product_id: productId,
        shopify_variant_id: variantId || null,
    };

    const rawPlans = await loadEligiblePlans(shopId, registeredProductLike);
    const cartEligiblePlans = rawPlans.filter(p => p.shopify_checkout_variant_id);

    if (!cartEligiblePlans.length) {
        return { eligible: false, plans: [] };
    }

    const pricingType = normalizeWarrantyPricingType(settings.warranty_pricing_type);
    let variantPricing = null;
    if (pricingType === "percentage" && session) {
        variantPricing = variantId
            ? await fetchVariantPricing(session, variantId, productId)
            : await fetchProductPricing(session, registeredProductLike);
    }

    const withBadges = await attachMerchandisingBadges(shopId, cartEligiblePlans.map(p => ({
        ...p,
        durationMonths: p.duration_months,
    })));

    const plans = [];
    for (const plan of withBadges) {
        const pricing = mapPlanForApi(plan, pricingType, variantPricing);
        if (!pricing) continue; // Can't resolve price (e.g. percentage plan, no live variant price) — hide it.

        plans.push({
            planId: plan.plan_id,
            planName: plan.plan_name,
            durationMonths: plan.duration_months,
            durationYears: plan.duration_years,
            price: pricing.displayPrice,
            currency: plan.currency,
            coverageText: plan.coverage_text || settings.coverage_text || "",
            badgeLabel: plan.badgeLabel || null,
            termsUrl: settings.terms_url || null,
            shopifyVariantId: String(plan.shopify_checkout_variant_id),
        });
    }

    plans.sort((a, b) => a.durationMonths - b.durationMonths);

    return {
        eligible: plans.length > 0,
        plans,
        termsUrl: settings.terms_url || null,
        currency: plans[0]?.currency || null,
    };
}

function parseNumericId(value) {
    if (!value) return null;
    const numeric = Number(String(value).split("/").pop());
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/** GET /apps/warranty/plans?product_id=&variant_id=&sku= — single product/variant lookup (PDP). */
export async function getWarrantyPlans(req, res) {
    try {
        const session = res.locals.shopifySession;
        if (!session?.shop) {
            return res.status(401).json({ eligible: false, plans: [], error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session.shop);
        if (!shopId) {
            return res.status(200).json({ eligible: false, plans: [] });
        }

        const productId = parseNumericId(req.query.product_id);
        const variantId = parseNumericId(req.query.variant_id);

        if (!productId) {
            return res.status(200).json({ eligible: false, plans: [] });
        }

        const settings = await getExtendedWarrantySettings(shopId);
        const result = await buildPlansForVariant({
            shopId,
            session,
            settings,
            productId,
            variantId,
        });

        return res.json({ success: true, ...result });
    } catch (err) {
        console.error("❌ getWarrantyPlans error:", err.message);
        // Never block the storefront — treat failures as "no plans available".
        return res.status(200).json({ eligible: false, plans: [] });
    }
}

/** POST /apps/warranty/plans/batch — { items: [{ productId, variantId }] } (Cart, avoids N requests). */
export async function getWarrantyPlansBatch(req, res) {
    try {
        const session = res.locals.shopifySession;
        if (!session?.shop) {
            return res.status(401).json({ results: {}, error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session.shop);
        if (!shopId) {
            return res.status(200).json({ results: {} });
        }

        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const settings = await getExtendedWarrantySettings(shopId);

        const seen = new Map();
        for (const item of items) {
            const productId = parseNumericId(item.productId ?? item.product_id);
            if (!productId) continue;
            const variantId = parseNumericId(item.variantId ?? item.variant_id);
            const key = `${productId}:${variantId || ""}`;
            if (!seen.has(key)) {
                seen.set(key, { productId, variantId });
            }
        }

        const results = {};
        await Promise.all(
            [...seen.entries()].map(async ([key, { productId, variantId }]) => {
                results[key] = await buildPlansForVariant({
                    shopId,
                    session,
                    settings,
                    productId,
                    variantId,
                });
            })
        );

        return res.json({ success: true, results });
    } catch (err) {
        console.error("❌ getWarrantyPlansBatch error:", err.message);
        return res.status(200).json({ results: {} });
    }
}
