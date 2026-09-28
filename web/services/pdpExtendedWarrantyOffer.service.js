import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import {
  MERCHANDISING_BADGE_LABELS,
  fetchVariantPricing,
  getExtendedWarrantySettings,
  isExtendedWarrantyOfferEnabled,
  loadEligiblePlans,
  mapPlanForApi,
  normalizeTermsUrl,
} from "./extendedWarranty.service.js";
import { normalizeWarrantyPricingType } from "./extendedWarrantyPricing.js";
import {
  isIndiaShop,
  loadProductPreorderMap,
  shouldSuppressPaidExtendedWarranty,
} from "./indiaFreeExtendedWarranty.service.js";
import { ensurePlanCheckoutVariant } from "./extendedWarrantyCheckoutVariant.service.js";

const offerCache = new Map();
const OFFER_CACHE_MS = 60 * 1000;

// Returns a cached PDP offer when it is still fresh.
function readOfferCache(key) {
  const hit = offerCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    offerCache.delete(key);
    return null;
  }
  return hit.value;
}

// Stores a successful or stably ineligible PDP offer for a short time.
function writeOfferCache(key, value) {
  offerCache.set(key, { value, expires: Date.now() + OFFER_CACHE_MS });
}

// Loads merchandising badges keyed by plan duration.
async function loadBadgeLabels(shopId) {
  const [rows] = await pool.query(
    `
    SELECT duration_months, merchandising_badge
    FROM extended_warranty_durations
    WHERE shop_id = ?
    `,
    [shopId]
  );
  const badgeByMonths = new Map();
  for (const row of rows) {
    const label = MERCHANDISING_BADGE_LABELS[row.merchandising_badge?.trim()];
    if (label) badgeByMonths.set(row.duration_months, label);
  }
  return badgeByMonths;
}

// Blocks paid PDP plans for India preorder products. Failures do not hide plans.
async function indiaPreorderBlock(session, productId) {
  if (!session?.shop || !isIndiaShop(session.shop)) return null;
  try {
    const client = new shopify.api.clients.Graphql({ session });
    const preorderMap = await loadProductPreorderMap(client, [productId]);
    const state = preorderMap.get(String(productId));
    if (
      state?.product &&
      shouldSuppressPaidExtendedWarranty(state.product, session.shop)
    ) {
      return { eligible: false, reason: "preorder_product" };
    }
  } catch (err) {
    console.warn("PDP preorder check skipped:", err.message);
  }
  return null;
}

// Builds the storefront PDP/cart warranty offer from configured plans and live prices.
export async function buildPdpExtendedWarrantyOffer({
  session,
  shopId,
  productId,
  variantId,
}) {
  const cacheKey = `${shopId}:${productId}:${variantId || ""}`;
  const cached = readOfferCache(cacheKey);
  if (cached) return cached;

  const settings = await getExtendedWarrantySettings(shopId);
  if (!isExtendedWarrantyOfferEnabled(settings)) {
    const disabled = { eligible: false, reason: "feature_disabled" };
    writeOfferCache(cacheKey, disabled);
    return disabled;
  }

  const preorder = await indiaPreorderBlock(session, productId);
  if (preorder) {
    writeOfferCache(cacheKey, preorder);
    return preorder;
  }

  const planRows = await loadEligiblePlans(shopId, {
    shopify_product_id: productId,
    shopify_variant_id: variantId,
  });
  if (!planRows.length) {
    const empty = { eligible: false, reason: "no_plans_configured" };
    writeOfferCache(cacheKey, empty);
    return empty;
  }

  const pricingType = normalizeWarrantyPricingType(settings.warranty_pricing_type);
  let variantPricing = null;
  if (pricingType === "percentage") {
    variantPricing = await fetchVariantPricing(session, variantId, productId);
  }

  const badgeByMonths = await loadBadgeLabels(shopId);
  const plans = [];
  for (const row of planRows) {
    const pricing = mapPlanForApi(row, pricingType, variantPricing);
    if (!pricing) continue;
    const badgeLabel = badgeByMonths.get(row.duration_months) || null;
    plans.push({
      planId: row.plan_id,
      planName: row.plan_name,
      durationYears: row.duration_years,
      durationMonths: row.duration_months,
      pricingType: pricing.pricingType,
      price: pricing.displayPrice || String(pricing.calculatedPrice),
      calculatedPrice: pricing.calculatedPrice,
      currency: row.currency,
      ...(badgeLabel ? { badgeLabel } : {}),
    });
  }

  plans.sort(
    (a, b) => Number(a.durationMonths || 0) - Number(b.durationMonths || 0)
  );

  // Each product price is its own warranty variant. Create that service variant
  // while the plans are loading, with inventory tracking off, so Buy now adds
  // an existing variant instead of creating a sold-out one on the click.
  for (const plan of plans) {
    try {
      await ensurePlanCheckoutVariant({
        session,
        shopId,
        parentVariantId: variantId,
        plan,
      });
    } catch (err) {
      console.warn("Warranty checkout variant was not ready for offer:", err.message);
    }
  }

  if (!plans.length) {
    return {
      eligible: false,
      reason: "pricing_unavailable",
      message: "Warranty price could not be calculated for this product variant.",
    };
  }

  let termsUrl = settings.terms_url || null;
  if (termsUrl && session?.shop) {
    try {
      termsUrl = normalizeTermsUrl(termsUrl, session.shop);
    } catch {
      termsUrl = settings.terms_url || null;
    }
  }

  const offer = {
    eligible: true,
    currency: plans[0].currency || null,
    pricingType,
    plans,
    settings: {
      termsUrl,
      coverageText: settings.coverage_text || "",
      warrantyPricingType: pricingType,
    },
  };
  writeOfferCache(cacheKey, offer);
  return offer;
}

// Resolves the Shopify warranty variant used when a plan is added from PDP or cart.
export async function buildPdpWarrantyCartPayload({
  session,
  shopId,
  productId,
  variantId,
  planId,
}) {
  const planRows = await loadEligiblePlans(shopId, {
    shopify_product_id: productId,
    shopify_variant_id: variantId,
  });
  const plan = planRows.find((row) => Number(row.plan_id) === Number(planId));
  if (!plan) return null;

  const settings = await getExtendedWarrantySettings(shopId);
  const pricingType = normalizeWarrantyPricingType(settings.warranty_pricing_type);
  const variantPricing =
    pricingType === "percentage"
      ? await fetchVariantPricing(session, variantId, productId)
      : null;
  const pricing = mapPlanForApi(plan, pricingType, variantPricing);
  if (!pricing) {
    return { error: "Warranty price could not be calculated for this product variant." };
  }

  const checkoutVariantId = await ensurePlanCheckoutVariant({
    session,
    shopId,
    parentVariantId: variantId,
    plan: {
      planId: plan.plan_id,
      planName: plan.plan_name,
      durationMonths: plan.duration_months,
      price: pricing.calculatedPrice,
      currency: plan.currency,
    },
  });

  return {
    variantId: checkoutVariantId,
    planName: plan.plan_name,
    price: pricing.calculatedPrice,
    currency: plan.currency,
    properties: {},
  };
}
