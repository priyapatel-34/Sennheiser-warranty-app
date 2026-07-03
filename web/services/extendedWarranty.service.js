import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { sendEmailService } from "./email.service.js";
import { sendShopEmail } from "./emailSettings.service.js";
import ExtendedWarrantyPurchaseTemplate from "../emailTemp/extended_warranty_purchase.js";
import {
  renderViewProductDetailsButton,
  resolveShopDomain,
  resolveCustomerFacingShopDomain,
} from "./emailLink.service.js";
import {
  DEFAULT_WARRANTY_PRICING_TYPE,
  normalizeWarrantyPricingType,
  resolvePlanPrice,
} from "./extendedWarrantyPricing.js";
import { computePurchaseWindowState, formatExtensionOfferExpiryLabel } from "./purchaseWindow.utils.js";

export {
  computePurchaseWindowState,
  formatExtensionOfferExpiryLabel,
  resolveRegistrationTimestamp,
} from "./purchaseWindow.utils.js";

export function getNumericIdFromGid(gid) {
  if (!gid) return null;
  const numeric = Number(String(gid).split("/").pop());
  return Number.isFinite(numeric) ? numeric : null;
}

export async function resolveShopId(shopDomain) {
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [shopDomain]
  );
  return shopRow?.id ?? null;
}

export function addMonthsSafe(startDate, months) {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const day = startDate.getDate();
  const targetMonth = month + months;
  const lastDayOfTargetMonth = new Date(year, targetMonth + 1, 0).getDate();
  const safeDay = Math.min(day, lastDayOfTargetMonth);
  return new Date(year, targetMonth, safeDay);
}

export const MERCHANDISING_BADGE_LABELS = {
  most_popular: "Most Popular",
  best_seller: "Best Seller",
  recommended: "Recommended",
  limited_offer: "Limited Offer",
};

/** Shop-scoped reminder configs (country_code column retained for schema compat). */
const SHOP_REMINDER_SCOPE = "SHOP";

export async function getExpiryReminderConfigs(shopId) {
  const [rows] = await pool.query(
    `
    SELECT reminder_days
    FROM extended_warranty_expiry_reminder_configs
    WHERE shop_id = ?
    ORDER BY reminder_days DESC
    `,
    [shopId]
  );

  return [
    {
      reminderDays: rows.length ? rows.map(r => String(r.reminder_days)) : [""],
    },
  ];
}

export async function buildExpiryReminderAdminConfigs(shopId) {
  return getExpiryReminderConfigs(shopId);
}

export async function saveExpiryReminderConfigs(shopId, configs = []) {
  if (!Array.isArray(configs)) {
    throw new Error("expiryReminderConfigs must be an array");
  }

  const entry = configs[0] || { reminderDays: [] };
  const rawDays = entry.reminderDays ?? entry.reminder_days;
  if (!Array.isArray(rawDays) || !rawDays.length) {
    throw new Error("At least one reminder day must be configured");
  }

  const normalized = [];
  const daySet = new Set();
  for (const raw of rawDays) {
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new Error("Reminder days must be whole numbers between 1 and 3650");
    }
    if (daySet.has(days)) {
      throw new Error(`Duplicate reminder day ${days}`);
    }
    daySet.add(days);
    normalized.push(days);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM extended_warranty_expiry_reminder_configs WHERE shop_id = ?`,
      [shopId]
    );

    for (const days of normalized) {
      await conn.query(
        `
        INSERT INTO extended_warranty_expiry_reminder_configs (
          shop_id, country_code, reminder_days
        ) VALUES (?, ?, ?)
        `,
        [shopId, SHOP_REMINDER_SCOPE, days]
      );
    }

    await conn.commit();
    return getExpiryReminderConfigs(shopId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getReminderDaysForShop(shopId) {
  const [rows] = await pool.query(
    `
    SELECT reminder_days
    FROM extended_warranty_expiry_reminder_configs
    WHERE shop_id = ?
    ORDER BY reminder_days DESC
    `,
    [shopId]
  );
  return rows.map(r => Number(r.reminder_days)).filter(
    value => Number.isInteger(value) && value > 0
  );
}

/** @deprecated Use getReminderDaysForShop — country scoping removed. */
export async function getReminderDaysForCountry(shopId) {
  return getReminderDaysForShop(shopId);
}

function daysSinceDate(value, referenceDate = new Date()) {
  const start = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(start.getTime())) return null;

  const today = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return Math.floor((today - start) / 86400000);
}

export async function evaluatePurchaseWindowEligibility(shopId, registered) {
  const settings = await getExtendedWarrantySettings(shopId);
  return evaluatePurchaseWindowFromSettings(settings, registered, {
    logContext: `shop:${shopId}:register:${registered?.id ?? "unknown"}`,
  });
}

export function evaluatePurchaseWindowFromSettings(
  settings,
  registered,
  options = {}
) {
  return computePurchaseWindowState({
    purchaseDays: settings?.extended_warranty_purchase_days,
    registered,
    now: options.now,
    logContext: options.logContext || null,
  });
}

/** Active EW plan rows grouped by Shopify product id (list-view eligibility). */
export async function buildPlanAvailabilityIndex(shopId, productIds) {
  const ids = [
    ...new Set(
      productIds
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0)
    ),
  ];
  const index = new Map();
  if (!ids.length) return index;

  const [rows] = await pool.query(
    `
    SELECT shopify_product_id, shopify_variant_id
    FROM extended_warranty_plans
    WHERE shop_id = ?
      AND status = 'active'
      AND shopify_product_id IN (?)
    `,
    [shopId, ids]
  );

  for (const row of rows) {
    const productId = Number(row.shopify_product_id);
    if (!index.has(productId)) index.set(productId, []);
    index.get(productId).push({
      variantId: row.shopify_variant_id ? Number(row.shopify_variant_id) : null,
    });
  }

  return index;
}

export function registeredHasEligiblePlansInIndex(registeredProduct, planIndex) {
  const productId = Number(registeredProduct.shopify_product_id);
  const entries = planIndex.get(productId);
  return Boolean(entries?.length);
}

export function canExtendWarrantyLight({
  entitlement,
  registered,
  ewSettings,
  planIndex,
}) {
  if (entitlement?.status === "active") {
    return { eligible: false, reason: "already_purchased" };
  }

  const purchaseWindow = evaluatePurchaseWindowFromSettings(ewSettings, registered, {
    logContext: `list:register:${registered?.id ?? "unknown"}`,
  });
  if (!purchaseWindow.allowed) {
    return {
      eligible: false,
      reason: purchaseWindow.reason || "purchase_window_expired",
      purchaseWindow,
    };
  }

  if (!registeredHasEligiblePlansInIndex(registered, planIndex)) {
    return { eligible: false, reason: "no_plans_configured" };
  }

  return { eligible: true, purchaseWindow };
}

export async function getExtendedWarrantySettings(shopId) {
  const [[row]] = await pool.query(
    `
    SELECT
      terms_url,
      coverage_text,
      extended_warranty_purchase_days,
      warranty_pricing_type
    FROM extended_warranty_settings
    WHERE shop_id = ?
    `,
    [shopId]
  );

  return (
    row || {
      terms_url: null,
      coverage_text: null,
      extended_warranty_purchase_days: null,
      warranty_pricing_type: DEFAULT_WARRANTY_PRICING_TYPE,
    }
  );
}

export async function fetchProductPricing(session, registered) {
  if (!session?.shop || !registered) return null;

  if (registered.shopify_variant_id) {
    return fetchVariantPricing(
      session,
      registered.shopify_variant_id,
      registered.shopify_product_id
    );
  }

  const productId = registered.shopify_product_id;
  if (!productId) return null;

  try {
    const admin = new shopify.api.clients.Graphql({ session });
    const productGid = String(productId).startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;
    const response = await admin.request(
      `
      query ProductPrice($id: ID!) {
        product(id: $id) {
          variants(first: 1) {
            edges {
              node {
                price
                compareAtPrice
              }
            }
          }
        }
      }
      `,
      { variables: { id: productGid } }
    );
    const variantNode = response.data?.product?.variants?.edges?.[0]?.node;
    if (!variantNode) return null;
    return {
      compareAtPrice:
        variantNode.compareAtPrice != null
          ? Number(variantNode.compareAtPrice)
          : null,
      variantPrice:
        variantNode.price != null ? Number(variantNode.price) : null,
    };
  } catch {
    return null;
  }
}

/** @deprecated Use fetchProductPricing for percentage calculations. */
export async function fetchProductPrice(session, registered) {
  const pricing = await fetchProductPricing(session, registered);
  return pricing?.variantPrice ?? null;
}

function mapVariantPricingNode(variantNode) {
  if (!variantNode) return null;
  return {
    compareAtPrice:
      variantNode.compareAtPrice != null
        ? Number(variantNode.compareAtPrice)
        : null,
    variantPrice:
      variantNode.price != null ? Number(variantNode.price) : null,
  };
}

export async function fetchVariantPricing(session, variantId, productId = null) {
  if (!session?.shop || !variantId) return null;

  try {
    const admin = new shopify.api.clients.Graphql({ session });
    const variantGid = String(variantId).startsWith("gid://")
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const response = await admin.request(
      `
      query VariantPrice($id: ID!) {
        productVariant(id: $id) {
          price
          compareAtPrice
        }
      }
      `,
      { variables: { id: variantGid } }
    );

    const pricing = mapVariantPricingNode(response.data?.productVariant);
    if (pricing?.variantPrice != null || pricing?.compareAtPrice != null) {
      return pricing;
    }

    if (productId) {
      const productGid = String(productId).startsWith("gid://")
        ? productId
        : `gid://shopify/Product/${productId}`;
      const productResponse = await admin.request(
        `
        query ProductVariantPrice($id: ID!) {
          product(id: $id) {
            variants(first: 100) {
              edges {
                node {
                  id
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
        `,
        {
          variables: {
            id: productGid,
          },
        }
      );
      const suffix = `/${variantId}`;
      const variantEdge = (productResponse.data?.product?.variants?.edges || []).find(
        (edge) => edge.node.id.endsWith(suffix)
      );
      return mapVariantPricingNode(variantEdge?.node);
    }
  } catch (err) {
    console.warn("Failed to fetch variant pricing:", err.message);
  }

  return null;
}

/** @deprecated Use fetchVariantPricing for percentage calculations. */
export async function fetchVariantPrice(session, variantId, productId = null) {
  const pricing = await fetchVariantPricing(session, variantId, productId);
  return pricing?.variantPrice ?? null;
}

export async function resolvePlanRowForCheckout({
  planRow,
  pricingType,
  variantPricing,
  productVariantPrice,
}) {
  const resolved = resolvePlanPrice({
    configuredPrice: planRow.price,
    pricingType,
    variantPricing,
    productVariantPrice,
  });

  return {
    ...planRow,
    price: resolved.resolvedPrice,
    configured_price: planRow.price,
    pricing_type: resolved.pricingType,
    percentage: resolved.percentage,
    calculated_price: resolved.calculatedPrice,
    base_price: resolved.basePrice,
    base_price_source: resolved.basePriceSource,
  };
}

export function mapPlanForApi(planRow, pricingType, variantPricing = null) {
  const type = normalizeWarrantyPricingType(pricingType);
  const base = {
    pricingType: type,
    price: String(planRow.price),
    currency: planRow.currency,
  };

  if (type === "percentage") {
    base.percentage = Number(planRow.price);
    if (variantPricing == null) {
      return null;
    }
    try {
      const resolved = resolvePlanPrice({
        configuredPrice: planRow.price,
        pricingType: type,
        variantPricing,
      });
      base.calculatedPrice = resolved.calculatedPrice;
      base.displayPrice = String(resolved.calculatedPrice);
      base.basePrice = resolved.basePrice;
      base.basePriceSource = resolved.basePriceSource;
    } catch {
      return null;
    }
    return base;
  }

  base.calculatedPrice = Number(planRow.price);
  base.displayPrice = String(planRow.price);
  return base;
}

export async function fetchRegistrationProductImage(session, registered) {
  const productId = registered?.shopify_product_id;
  if (!session?.shop || !productId) return null;

  try {
    const admin = new shopify.api.clients.Graphql({ session });
    const productGid = String(productId).startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;
    const variantId = registered.shopify_variant_id
      ? Number(registered.shopify_variant_id)
      : null;

    const response = await admin.request(
      `
      query ProductImage($id: ID!) {
        product(id: $id) {
          featuredImage { url }
          variants(first: 100) {
            edges {
              node {
                id
                image { url }
              }
            }
          }
        }
      }
      `,
      { variables: { id: productGid } }
    );

    const product = response.data?.product;
    if (!product) return null;

    if (variantId) {
      const suffix = `/${variantId}`;
      const variantEdge = (product.variants?.edges || []).find(edge =>
        edge.node.id.endsWith(suffix)
      );
      if (variantEdge?.node?.image?.url) {
        return variantEdge.node.image.url;
      }
    }

    return product.featuredImage?.url || null;
  } catch (err) {
    console.warn("Failed to fetch EW offer product image:", err.message);
    return null;
  }
}

async function attachMerchandisingBadges(shopId, plans) {
  try {
    const [durations] = await pool.query(
      `
    SELECT duration_months, merchandising_badge
    FROM extended_warranty_durations
    WHERE shop_id = ?
    `,
      [shopId]
    );

    const badgeByMonths = new Map();
    for (const duration of durations) {
      const badgeKey = duration.merchandising_badge?.trim();
      if (badgeKey && MERCHANDISING_BADGE_LABELS[badgeKey]) {
        badgeByMonths.set(duration.duration_months, MERCHANDISING_BADGE_LABELS[badgeKey]);
      }
    }

    return plans.map(plan => {
      const badgeLabel = badgeByMonths.get(plan.durationMonths);
      return badgeLabel ? { ...plan, badgeLabel } : plan;
    });
  } catch (err) {
    console.warn("Failed to load merchandising badges:", err.message);
    return plans;
  }
}

function sortPlansByDuration(plans) {
  return [...plans].sort(
    (a, b) =>
      (a.durationMonths || (a.durationYears || 0) * 12) -
      (b.durationMonths || (b.durationYears || 0) * 12)
  );
}

export async function loadRegisteredProduct(shopId, registerId) {
  const [[row]] = await pool.query(
    `
    SELECT *
    FROM registered_products
    WHERE shop_id = ? AND id = ?
    LIMIT 1
    `,
    [shopId, registerId]
  );
  return row || null;
}

function dedupeActivePlansByDuration(rows) {
  const byDuration = new Map();
  for (const row of rows) {
    if (row.status && row.status !== "active") continue;
    const key = row.duration_months;
    if (!byDuration.has(key)) {
      byDuration.set(key, row);
    }
  }
  return [...byDuration.values()].sort(
    (a, b) => a.duration_months - b.duration_months
  );
}

/** Load active EW plans for a registered product (scoped by shop + product + variant). */
export async function loadEligiblePlans(shopId, registeredProduct) {
  const productId = Number(registeredProduct.shopify_product_id);
  const variantId = registeredProduct.shopify_variant_id
    ? Number(String(registeredProduct.shopify_variant_id).split("/").pop())
    : null;

  const queryPlans = async (forVariantId, productLevelOnly = false) => {
    let sql = `
      SELECT
        p.id AS plan_id,
        p.plan_name,
        p.duration_years,
        p.duration_months,
        p.price,
        p.currency,
        p.status,
        p.coverage_text,
        p.shopify_checkout_variant_id
      FROM extended_warranty_plans p
      WHERE p.shop_id = ?
        AND p.shopify_product_id = ?
        AND p.status = 'active'
    `;
    const params = [shopId, productId];

    if (productLevelOnly) {
      sql += ` AND (p.shopify_variant_id IS NULL OR p.shopify_variant_id = 0)`;
    } else if (forVariantId) {
      sql += ` AND p.shopify_variant_id = ?`;
      params.push(forVariantId);
    }

    sql += ` ORDER BY p.duration_months ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  };

  let rows = variantId ? await queryPlans(variantId) : [];
  if (!rows.length) {
    rows = await queryPlans(null, true);
  }
  if (!rows.length && productId) {
    const [allProductRows] = await pool.query(
      `
      SELECT
        p.id AS plan_id,
        p.plan_name,
        p.duration_years,
        p.duration_months,
        p.price,
        p.currency,
        p.status,
        p.coverage_text,
        p.shopify_checkout_variant_id
      FROM extended_warranty_plans p
      WHERE p.shop_id = ?
        AND p.shopify_product_id = ?
        AND p.status = 'active'
      ORDER BY p.duration_months ASC
      `,
      [shopId, productId]
    );
    rows = allProductRows;
  }

  return dedupeActivePlansByDuration(rows);
}

export async function getActiveEntitlement(shopId, registeredProductId) {
  const [[row]] = await pool.query(
    `
    SELECT *
    FROM extended_warranty_entitlements
    WHERE shop_id = ?
      AND registered_product_id = ?
      AND status IN ('pending_payment', 'active')
    ORDER BY FIELD(status, 'active', 'pending_payment'), created_at DESC
    LIMIT 1
    `,
    [shopId, registeredProductId]
  );
  return row || null;
}

export async function getEntitlementsForRegistrations(shopId, registerIds) {
  if (!registerIds.length) return new Map();

  const placeholders = registerIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `
    SELECT *
    FROM extended_warranty_entitlements
    WHERE shop_id = ?
      AND registered_product_id IN (${placeholders})
    ORDER BY
      registered_product_id,
      FIELD(status, 'active', 'pending_payment', 'refunded', 'cancelled', 'expired'),
      created_at DESC
    `,
    [shopId, ...registerIds]
  );

  const map = new Map();
  for (const row of rows) {
    const key = row.registered_product_id;
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

function formatDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

export function computeExtendedWarrantyDates(registeredProduct, plan, referenceDate = new Date()) {
  const standardEnd = registeredProduct?.warranty_end
    ? new Date(registeredProduct.warranty_end)
    : null;
  if (standardEnd) standardEnd.setHours(0, 0, 0, 0);

  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  let startDate = today;
  if (standardEnd && standardEnd >= today) {
    startDate = standardEnd;
  }

  const endDate = addMonthsSafe(startDate, plan.duration_months);
  return { startDate, endDate };
}

function formatEntitlementForApi(row, registeredProduct = null) {
  if (!row) return null;

  let projectedStart = null;
  let projectedEnd = null;
  if (!row.activation_date && registeredProduct && row.duration_months) {
    const projected = computeExtendedWarrantyDates(registeredProduct, {
      duration_months: row.duration_months,
    });
    projectedStart = projected.startDate;
    projectedEnd = projected.endDate;
  }

  const startDate = row.activation_date || projectedStart;
  const endDate = row.expiry_date || projectedEnd;

  return {
    entitlementId: row.id,
    status: row.status,
    planName: row.plan_name,
    durationMonths: row.duration_months,
    durationYears: row.duration_years,
    price: String(row.price),
    currency: row.currency,
    pricingType: normalizeWarrantyPricingType(row.pricing_type),
    purchaseDate: formatDateOnly(row.purchase_date),
    activationDate: formatDateOnly(row.activation_date),
    expiryDate: formatDateOnly(row.expiry_date),
    startDate: formatDateOnly(startDate),
    endDate: formatDateOnly(endDate),
    extendedWarrantyStartDate: formatDateOnly(startDate),
    extendedWarrantyEndDate: formatDateOnly(endDate),
  };
}

export function formatEntitlementForApiExport(row, registeredProduct = null) {
  return formatEntitlementForApi(row, registeredProduct);
}

export async function createPendingEntitlement({
  shopId,
  registeredProductId,
  planId,
  planRow,
  draftOrderId = null,
  pricingType = DEFAULT_WARRANTY_PRICING_TYPE,
}) {
  await pool.query(
    `
    UPDATE extended_warranty_entitlements
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE shop_id = ?
      AND registered_product_id = ?
      AND status = 'pending_payment'
    `,
    [shopId, registeredProductId]
  );

  const [result] = await pool.query(
    `
    INSERT INTO extended_warranty_entitlements (
      shop_id,
      registered_product_id,
      extended_warranty_plan_id,
      shopify_draft_order_id,
      status,
      plan_name,
      duration_years,
      duration_months,
      price,
      currency,
      pricing_type
    ) VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?)
    `,
    [
      shopId,
      registeredProductId,
      planId,
      draftOrderId,
      planRow.plan_name,
      planRow.duration_years,
      planRow.duration_months,
      planRow.price,
      planRow.currency,
      normalizeWarrantyPricingType(pricingType),
    ]
  );
  return result.insertId;
}

export async function cancelPendingEntitlementForRegistration(
  shopId,
  registeredProductId
) {
  if (!shopId || !registeredProductId) return { cancelled: 0 };
  const [result] = await pool.query(
    `
    UPDATE extended_warranty_entitlements
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE shop_id = ?
      AND registered_product_id = ?
      AND status = 'pending_payment'
    `,
    [shopId, registeredProductId]
  );
  return { cancelled: result.affectedRows || 0 };
}

export async function createDraftOrderCheckout({
  session,
  customerEmail,
  customerGid,
  registeredProduct,
  planRow,
  registerId,
  planId,
  settings,
}) {
  const admin = new shopify.api.clients.Graphql({ session });
  const lineTitle = `${planRow.plan_name} – ${registeredProduct.product_name} (SN: ${registeredProduct.serial_number})`;
  const coverageNote = planRow.coverage_text || settings.coverage_text || "";

  const response = await admin.request(
    `
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          invoiceUrl
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        input: {
          email: customerEmail,
          ...(customerGid ? { purchasingEntity: { customerId: customerGid } } : {}),
          lineItems: [
            {
              title: lineTitle,
              originalUnitPrice: String(planRow.price),
              quantity: 1,
              customAttributes: [
                { key: "_ew_register_id", value: String(registerId) },
                { key: "_ew_plan_id", value: String(planId) },
                { key: "_ew_serial", value: registeredProduct.serial_number },
              ],
            },
          ],
          customAttributes: [
            { key: "_ew_type", value: "extended_warranty" },
            ...(coverageNote
              ? [{ key: "_ew_coverage", value: coverageNote.slice(0, 250) }]
              : []),
          ],
          tags: [`extended-warranty`, `ew-register-${registerId}`],
          note: coverageNote || undefined,
        },
      },
    }
  );

  const payload = response.data?.draftOrderCreate;
  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map(e => e.message).join(", "));
  }

  return payload?.draftOrder;
}

export async function activateEntitlementFromPayment({
  shopId,
  registerId,
  planId,
  shopifyOrderId,
  shopifyOrderName,
  customerEmail,
  customerName,
  shopDisplayName,
  session = null,
}) {
  const settings = await getExtendedWarrantySettings(shopId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[registered]] = await conn.query(
      `SELECT * FROM registered_products WHERE shop_id = ? AND id = ? FOR UPDATE`,
      [shopId, registerId]
    );

    if (!registered) {
      throw new Error(`Registration ${registerId} not found`);
    }

    const [[plan]] = await conn.query(
      `SELECT * FROM extended_warranty_plans WHERE shop_id = ? AND id = ?`,
      [shopId, planId]
    );

    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const activationDate = computeExtendedWarrantyDates(registered, plan).startDate;
    const expiryDate = computeExtendedWarrantyDates(registered, plan).endDate;

    const [updateResult] = await conn.query(
      `
      UPDATE extended_warranty_entitlements
      SET
        status = 'active',
        shopify_order_id = ?,
        purchase_date = CURDATE(),
        activation_date = ?,
        expiry_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ?
        AND registered_product_id = ?
        AND extended_warranty_plan_id = ?
        AND status = 'pending_payment'
      `,
      [
        shopifyOrderId,
        activationDate,
        expiryDate,
        shopId,
        registerId,
        planId,
      ]
    );

    if (updateResult.affectedRows === 0) {
      const [[pending]] = await conn.query(
        `
        SELECT *
        FROM extended_warranty_entitlements
        WHERE shop_id = ?
          AND registered_product_id = ?
          AND status = 'pending_payment'
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [shopId, registerId]
      );

      if (pending) {
        planId = pending.extended_warranty_plan_id;
        const [[pendingPlan]] = await conn.query(
          `SELECT * FROM extended_warranty_plans WHERE shop_id = ? AND id = ?`,
          [shopId, planId]
        );
        if (pendingPlan) {
          const dates = computeExtendedWarrantyDates(registered, pendingPlan);
          await conn.query(
            `
            UPDATE extended_warranty_entitlements
            SET
              status = 'active',
              shopify_order_id = ?,
              purchase_date = CURDATE(),
              activation_date = ?,
              expiry_date = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
              shopifyOrderId,
              dates.startDate,
              dates.endDate,
              pending.id,
            ]
          );
        }
      }
    }

    const [[entitlement]] = await conn.query(
      `
      SELECT * FROM extended_warranty_entitlements
      WHERE shop_id = ? AND registered_product_id = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1
      `,
      [shopId, registerId]
    );

    if (!entitlement) {
      const variantPricing = session
        ? await fetchVariantPricing(
            session,
            registered.shopify_variant_id,
            registered.shopify_product_id
          )
        : null;

      let resolvedPrice = Number(plan.price);
      let resolvedPricingType = normalizeWarrantyPricingType(
        settings.warranty_pricing_type
      );

      if (resolvedPricingType === "percentage" && variantPricing) {
        const resolved = resolvePlanPrice({
          configuredPrice: plan.price,
          pricingType: resolvedPricingType,
          variantPricing,
        });
        resolvedPrice = resolved.resolvedPrice;
      }

      await conn.query(
        `
        INSERT INTO extended_warranty_entitlements (
          shop_id,
          registered_product_id,
          extended_warranty_plan_id,
          shopify_order_id,
          status,
          plan_name,
          duration_years,
          duration_months,
          price,
          currency,
          pricing_type,
          purchase_date,
          activation_date,
          expiry_date
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)
        `,
        [
          shopId,
          registerId,
          planId,
          shopifyOrderId,
          plan.plan_name,
          plan.duration_years,
          plan.duration_months,
          resolvedPrice,
          plan.currency,
          resolvedPricingType,
          activationDate,
          expiryDate,
        ]
      );
    }

    await conn.commit();

    const [[activeEntitlement]] = await pool.query(
      `
      SELECT * FROM extended_warranty_entitlements
      WHERE shop_id = ? AND registered_product_id = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1
      `,
      [shopId, registerId]
    );

    const purchasePrice = activeEntitlement?.price ?? plan.price;
    const purchaseCurrency = activeEntitlement?.currency ?? plan.currency;
    const shopDomain = await resolveCustomerFacingShopDomain(
      session ? new shopify.api.clients.Graphql({ session }) : null,
      session?.shop || (await resolveShopDomain(shopId))
    );
    const productDetailsHtml = renderViewProductDetailsButton(
      shopDomain,
      registerId
    );

    const activationDateText = formatDateOnly(activationDate);
    const expiryDateText = formatDateOnly(expiryDate);

    const purchaseHtml = ExtendedWarrantyPurchaseTemplate({
      customerName: customerName || registered.customer_name || "Customer",
      productTitle: registered.product_name,
      orderNumber: shopifyOrderName || shopifyOrderId,
      planName: plan.plan_name,
      durationMonths: plan.duration_months,
      price: String(purchasePrice),
      currency: purchaseCurrency,
      serialNumber: registered.serial_number,
      activationDate: activationDateText,
      expiryDate: expiryDateText,
      productDetailsHtml,
    });

    await sendShopEmail({
      shopId,
      templateKey: "extended_warranty_purchase",
      to: customerEmail || registered.customer_email,
      data: {
        customerName: customerName || registered.customer_name || "Customer",
        productName: registered.product_name,
        orderNumber: shopifyOrderName || shopifyOrderId,
        planName: plan.plan_name,
        warrantyDuration: `${plan.duration_months} Months`,
        warrantyNumber: registered.serial_number,
        registrationDate: activationDateText,
        warrantyExpiry: expiryDateText,
      },
      renderDefault: async () => ({
        subject: "Extended Warranty Purchase Confirmation",
        html: purchaseHtml,
      }),
    });

    return { registerId, planId, expiryDate };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function cancelEntitlementFromRefund(params) {
  const mod = await import("./extendedWarrantyRefund.service.js");
  return mod.cancelEntitlementFromRefund(params);
}

export {
  calculateProRataRefund,
  getRefundSettings,
  saveRefundSettings,
} from "./extendedWarrantyRefund.service.js";

export function formatMoney(amount, currency, locale) {
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
  }
}

export async function buildExtendedWarrantyOffer(shopId, registerId, options = {}) {
  const { session = null, justRegistered = false } = options;
  const settings = await getExtendedWarrantySettings(shopId);

  const registered = await loadRegisteredProduct(shopId, registerId);
  if (!registered) {
    return { eligible: false, reason: "registration_not_found" };
  }

  if (justRegistered && !resolveRegistrationTimestamp(registered)) {
    registered.created_at = new Date();
  }

  const existing = await getActiveEntitlement(shopId, registerId);
  if (existing?.status === "active") {
    return {
      eligible: false,
      reason: "already_purchased",
      entitlement: formatEntitlementForApi(existing, registered),
    };
  }

  const purchaseWindow = await evaluatePurchaseWindowEligibility(shopId, registered);
  if (!purchaseWindow.allowed) {
    return {
      eligible: false,
      reason: purchaseWindow.reason || "purchase_window_expired",
      purchaseWindow,
    };
  }

  const plans = await loadEligiblePlans(shopId, registered);
  if (!plans.length) {
    return { eligible: false, reason: "no_plans_configured" };
  }

  const pricingType = normalizeWarrantyPricingType(settings.warranty_pricing_type);
  const variantPricing =
    pricingType === "percentage" && session
      ? await fetchProductPricing(session, registered)
      : null;

  const shopCurrency = plans[0]?.currency || null;

  const basePlans = [];
  for (const p of plans) {
    const pricing = mapPlanForApi(p, pricingType, variantPricing);
    if (!pricing) continue;

    const projected = computeExtendedWarrantyDates(registered, {
      duration_months: p.duration_months,
    });
    basePlans.push({
      planId: p.plan_id,
      planName: p.plan_name,
      durationYears: p.duration_years,
      durationMonths: p.duration_months,
      pricingType: pricing.pricingType,
      price: pricing.displayPrice || String(pricing.calculatedPrice),
      percentage: pricing.percentage ?? null,
      calculatedPrice: pricing.calculatedPrice,
      currency: p.currency,
      coverageText: p.coverage_text || settings.coverage_text,
      startDate: formatDateOnly(projected.startDate),
      endDate: formatDateOnly(projected.endDate),
      extendedWarrantyStartDate: formatDateOnly(projected.startDate),
      extendedWarrantyEndDate: formatDateOnly(projected.endDate),
    });
  }

  if (!basePlans.length) {
    return { eligible: false, reason: "no_plans_configured" };
  }

  const enrichedPlans = sortPlansByDuration(
    await attachMerchandisingBadges(shopId, basePlans)
  );
  const productImageUrl = session
    ? await fetchRegistrationProductImage(session, registered)
    : null;

  return {
    eligible: true,
    currency: shopCurrency,
    pricingType,
    plans: enrichedPlans,
    purchaseWindow,
    settings: {
      termsUrl: (() => {
        if (!settings.terms_url) return null;
        if (!session?.shop) return settings.terms_url;
        try {
          return normalizeTermsUrl(settings.terms_url, session.shop);
        } catch {
          return settings.terms_url;
        }
      })(),
      coverageText: settings.coverage_text,
      warrantyPricingType: pricingType,
    },
    registration: {
      registerId: registered.id,
      productName: registered.product_name,
      serialNumber: registered.serial_number,
      sku: registered.sku,
      productImageUrl,
      standardWarrantyStart: registered.warranty_start,
      standardWarrantyEnd: registered.warranty_end,
      purchaseDate: registered.purchase_date,
      variantId: registered.shopify_variant_id,
      productId: registered.shopify_product_id,
    },
  };
}

export async function canPurchaseExtendedWarranty(shopId, registerId, options = {}) {
  const offer = await buildExtendedWarrantyOffer(shopId, registerId, options);
  return {
    eligible: Boolean(offer.eligible),
    reason: offer.reason || null,
    purchaseWindow: offer.purchaseWindow || null,
  };
}

/** Resolve storefront Terms & Conditions URL from admin input. */
export function normalizeTermsUrl(input, shopDomain) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Terms URL must use http or https");
      }
      return url.toString();
    } catch {
      throw new Error("Terms URL must be a valid absolute URL");
    }
  }

  const domain = String(shopDomain || "").trim();
  if (!domain) {
    throw new Error("Shop domain is required to resolve relative terms URL");
  }

  let path = trimmed.replace(/^\/+/, "");

  if (path.startsWith("pages/")) {
    return `https://${domain}/${path}`;
  }

  if (path.startsWith("policies/")) {
    return `https://${domain}/${path}`;
  }

  if (!path.includes("/")) {
    return `https://${domain}/policies/${path}`;
  }

  return `https://${domain}/${path}`;
}

export async function trySyncPendingEntitlementActivation({
  session,
  shopId,
  registerId,
  customerEmail,
}) {
  const pending = await getActiveEntitlement(shopId, registerId);
  if (!pending || pending.status !== "pending_payment") {
    return pending;
  }

  const admin = new shopify.api.clients.Graphql({ session });
  const response = await admin.request(
    `
    query FindPaidEwOrder($query: String!) {
      orders(first: 3, query: $query, reverse: true) {
        edges {
          node {
            id
            name
            email
            displayFinancialStatus
            customer {
              displayName
            }
            lineItems(first: 10) {
              edges {
                node {
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
      shop {
        name
      }
    }
    `,
    {
      variables: {
        query: `tag:ew-register-${registerId} financial_status:paid`,
      },
    }
  );

  for (const edge of response.data?.orders?.edges || []) {
    const order = edge.node;
    if (order.displayFinancialStatus !== "PAID") continue;

    let planId = pending.extended_warranty_plan_id;
    for (const lineEdge of order.lineItems?.edges || []) {
      const { planId: linePlanId } = extractLineItemEwIds(lineEdge.node);
      if (linePlanId) {
        planId = linePlanId;
        break;
      }
    }
    await activateEntitlementFromPayment({
      shopId,
      registerId,
      planId,
      shopifyOrderId: String(getNumericIdFromGid(order.id)),
      shopifyOrderName: order.name,
      customerEmail: order.email || customerEmail,
      customerName: order.customer?.displayName || null,
      shopDisplayName: response.data?.shop?.name,
      session,
    });

    return getActiveEntitlement(shopId, registerId);
  }

  return pending;
}

function extractLineItemEwIds(lineItem) {
  const map = {};
  for (const attr of lineItem.customAttributes || []) {
    map[attr.key] = attr.value;
  }
  return {
    registerId: map._ew_register_id ? Number(map._ew_register_id) : null,
    planId: map._ew_plan_id ? Number(map._ew_plan_id) : null,
  };
}
