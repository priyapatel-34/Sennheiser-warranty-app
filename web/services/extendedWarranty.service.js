import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { sendEmailService } from "./email.service.js";
import ExtendedWarrantyPurchaseTemplate from "../emailTemp/extended_warranty_purchase.js";
import ExtendedWarrantyActivationTemplate from "../emailTemp/extended_warranty_activation.js";
import {
  DEFAULT_WARRANTY_PRICING_TYPE,
  normalizeWarrantyPricingType,
  resolvePlanPrice,
} from "./extendedWarrantyPricing.js";

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

export function normalizeCountryCode(value) {
  if (!value) return null;
  const code = String(value).trim().toUpperCase();
  return code.length >= 2 ? code.slice(0, 10) : null;
}

export async function getConfiguredCountryCodes(shopId) {
  const codes = new Set();

  const [planRows] = await pool.query(
    `
    SELECT DISTINCT UPPER(TRIM(region_code)) AS country_code
    FROM extended_warranty_plans
    WHERE shop_id = ?
      AND region_code IS NOT NULL
      AND TRIM(region_code) != ''
    ORDER BY country_code
    `,
    [shopId]
  );

  for (const row of planRows) {
    codes.add(row.country_code);
  }

  const settings = await getExtendedWarrantySettings(shopId);
  const settingsCode = normalizeCountryCode(settings.region_code);
  if (settingsCode) {
    codes.add(settingsCode);
  }

  return [...codes].sort();
}

export async function resolveRegistrationCountryCode(shopId, registered) {
  const direct = normalizeCountryCode(registered.country_code);
  if (direct) return direct;

  const productId = registered.shopify_product_id
    ? Number(registered.shopify_product_id)
    : null;

  if (productId) {
    const [planRegions] = await pool.query(
      `
      SELECT DISTINCT UPPER(TRIM(region_code)) AS country_code
      FROM extended_warranty_plans
      WHERE shop_id = ?
        AND shopify_product_id = ?
        AND region_code IS NOT NULL
        AND TRIM(region_code) != ''
      `,
      [shopId, productId]
    );

    if (planRegions.length === 1) {
      return planRegions[0].country_code;
    }
  }

  const settings = await getExtendedWarrantySettings(shopId);
  return normalizeCountryCode(settings.region_code);
}

export async function getExpiryReminderConfigs(shopId) {
  const [rows] = await pool.query(
    `
    SELECT country_code, reminder_days
    FROM extended_warranty_expiry_reminder_configs
    WHERE shop_id = ?
    ORDER BY country_code, reminder_days DESC
    `,
    [shopId]
  );

  const byCountry = new Map();
  for (const row of rows) {
    const code = row.country_code;
    if (!byCountry.has(code)) {
      byCountry.set(code, []);
    }
    byCountry.get(code).push(row.reminder_days);
  }

  return [...byCountry.entries()].map(([countryCode, reminderDays]) => ({
    countryCode,
    reminderDays,
  }));
}

export async function buildExpiryReminderAdminConfigs(shopId) {
  const countryCodes = await getConfiguredCountryCodes(shopId);
  const saved = await getExpiryReminderConfigs(shopId);
  const savedMap = new Map(saved.map(entry => [entry.countryCode, entry.reminderDays]));

  if (!countryCodes.length) {
    const fallbackDays = saved[0]?.reminderDays?.length ? saved[0].reminderDays : [""];
    return [
      {
        countryCode: saved[0]?.countryCode || null,
        reminderDays: fallbackDays,
      },
    ];
  }

  return countryCodes.map(countryCode => ({
    countryCode,
    reminderDays: savedMap.get(countryCode)?.length ? savedMap.get(countryCode) : [""],
  }));
}

export async function saveExpiryReminderConfigs(shopId, configs = []) {
  if (!Array.isArray(configs)) {
    throw new Error("expiryReminderConfigs must be an array");
  }

  const allowedCountries = new Set(await getConfiguredCountryCodes(shopId));
  const settings = await getExtendedWarrantySettings(shopId);
  const settingsCountry = normalizeCountryCode(settings.region_code);

  const normalized = [];
  const seenCountries = new Set();

  for (const entry of configs) {
    let countryCode = normalizeCountryCode(
      entry.countryCode || entry.country_code
    );

    if (!countryCode) {
      if (allowedCountries.size === 1) {
        countryCode = [...allowedCountries][0];
      } else if (settingsCountry) {
        countryCode = settingsCountry;
      } else if (!allowedCountries.size && configs.length === 1) {
        countryCode = settingsCountry || "DEFAULT";
      } else {
        throw new Error("Each reminder configuration requires a country");
      }
    }

    if (allowedCountries.size && !allowedCountries.has(countryCode)) {
      throw new Error(
        `Country ${countryCode} is not configured for this store`
      );
    }

    const rawDays = entry.reminderDays ?? entry.reminder_days;
    if (!Array.isArray(rawDays) || !rawDays.length) {
      throw new Error(
        `Country ${countryCode} must have at least one reminder day configured`
      );
    }

    const daySet = new Set();
    for (const raw of rawDays) {
      const days = Number(raw);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new Error(
          `Reminder days for ${countryCode} must be whole numbers between 1 and 3650`
        );
      }
      if (daySet.has(days)) {
        throw new Error(`Duplicate reminder day ${days} for country ${countryCode}`);
      }
      daySet.add(days);
      normalized.push({ countryCode, days });
    }
    seenCountries.add(countryCode);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM extended_warranty_expiry_reminder_configs WHERE shop_id = ?`,
      [shopId]
    );

    for (const { countryCode, days } of normalized) {
      await conn.query(
        `
        INSERT INTO extended_warranty_expiry_reminder_configs (
          shop_id, country_code, reminder_days
        ) VALUES (?, ?, ?)
        `,
        [shopId, countryCode, days]
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

export async function getReminderDaysForCountry(shopId, countryCode) {
  const normalized = normalizeCountryCode(countryCode);
  if (normalized) {
    const [rows] = await pool.query(
      `
      SELECT reminder_days
      FROM extended_warranty_expiry_reminder_configs
      WHERE shop_id = ? AND country_code = ?
      ORDER BY reminder_days DESC
      `,
      [shopId, normalized]
    );

    if (rows.length) {
      return rows.map(r => r.reminder_days);
    }
  }

  const [fallbackRows] = await pool.query(
    `
    SELECT reminder_days
    FROM extended_warranty_expiry_reminder_configs
    WHERE shop_id = ?
    ORDER BY reminder_days DESC
    LIMIT 10
    `,
    [shopId]
  );

  return fallbackRows.map(r => r.reminder_days);
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
  const purchaseDays = settings.extended_warranty_purchase_days;

  if (purchaseDays == null) {
    return { allowed: true, configured: false };
  }

  const referenceDate = registered.created_at || registered.warranty_start;
  const elapsedDays = daysSinceDate(referenceDate);
  if (elapsedDays == null) {
    return {
      allowed: false,
      configured: true,
      reason: "registration_date_missing",
      extendedWarrantyPurchaseDays: purchaseDays,
    };
  }

  if (elapsedDays > purchaseDays) {
    return {
      allowed: false,
      configured: true,
      reason: "purchase_window_expired",
      extendedWarrantyPurchaseDays: purchaseDays,
      daysSinceRegistration: elapsedDays,
      daysRemaining: 0,
    };
  }

  return {
    allowed: true,
    configured: true,
    extendedWarrantyPurchaseDays: purchaseDays,
    daysSinceRegistration: elapsedDays,
    daysRemaining: purchaseDays - elapsedDays,
    regionCode: settings.region_code || null,
  };
}

export async function getExtendedWarrantySettings(shopId) {
  const [[row]] = await pool.query(
    `
    SELECT
      enabled,
      offer_after_registration,
      terms_url,
      coverage_text,
      region_code,
      extended_warranty_purchase_days,
      warranty_pricing_type
    FROM extended_warranty_settings
    WHERE shop_id = ?
    `,
    [shopId]
  );

  return (
    row || {
      enabled: 1,
      offer_after_registration: 1,
      terms_url: null,
      coverage_text: null,
      region_code: null,
      extended_warranty_purchase_days: null,
      warranty_pricing_type: DEFAULT_WARRANTY_PRICING_TYPE,
    }
  );
}

export async function fetchVariantPrice(session, variantId, productId = null) {
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
        }
      }
      `,
      { variables: { id: variantGid } }
    );

    const price = response.data?.productVariant?.price;
    if (price != null) return Number(price);

    if (productId) {
      const productGid = String(productId).startsWith("gid://")
        ? productId
        : `gid://shopify/Product/${productId}`;
      const productResponse = await admin.request(
        `
        query ProductVariantPrice($id: ID!, $variantId: ID!) {
          product(id: $id) {
            variants(first: 100) {
              edges {
                node {
                  id
                  price
                }
              }
            }
          }
        }
        `,
        {
          variables: {
            id: productGid,
            variantId: variantGid,
          },
        }
      );
      const suffix = `/${variantId}`;
      const variantEdge = (productResponse.data?.product?.variants?.edges || []).find(
        edge => edge.node.id.endsWith(suffix)
      );
      if (variantEdge?.node?.price != null) {
        return Number(variantEdge.node.price);
      }
    }
  } catch (err) {
    console.warn("Failed to fetch variant price:", err.message);
  }

  return null;
}

export async function resolvePlanRowForCheckout({
  planRow,
  pricingType,
  productVariantPrice,
}) {
  const resolved = resolvePlanPrice({
    configuredPrice: planRow.price,
    pricingType,
    productVariantPrice,
  });

  return {
    ...planRow,
    price: resolved.resolvedPrice,
    configured_price: planRow.price,
    pricing_type: resolved.pricingType,
    percentage: resolved.percentage,
    calculated_price: resolved.calculatedPrice,
  };
}

export function mapPlanForApi(planRow, pricingType, productVariantPrice = null) {
  const type = normalizeWarrantyPricingType(pricingType);
  const base = {
    pricingType: type,
    price: String(planRow.price),
    currency: planRow.currency,
  };

  if (type === "percentage") {
    base.percentage = Number(planRow.price);
    if (productVariantPrice != null) {
      try {
        const resolved = resolvePlanPrice({
          configuredPrice: planRow.price,
          pricingType: type,
          productVariantPrice,
        });
        base.calculatedPrice = resolved.calculatedPrice;
        base.displayPrice = String(resolved.calculatedPrice);
      } catch {
        return null;
      }
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

/** Load active EW plans eligible for a registered product (variant + region aware). */
export async function loadEligiblePlans(shopId, registeredProduct, regionCode = null) {
  const productId = Number(registeredProduct.shopify_product_id);
  const variantId = registeredProduct.shopify_variant_id
    ? Number(registeredProduct.shopify_variant_id)
    : null;

  let sql = `
    SELECT
      p.id AS plan_id,
      p.plan_name,
      p.duration_years,
      p.duration_months,
      p.price,
      p.currency,
      p.status,
      p.region_code,
      p.coverage_text,
      p.shopify_checkout_variant_id
    FROM extended_warranty_plans p
    WHERE p.shop_id = ?
      AND p.shopify_product_id = ?
      AND p.status = 'active'
  `;
  const params = [shopId, productId];

  if (variantId) {
    sql += ` AND p.shopify_variant_id = ?`;
    params.push(variantId);
  }

  if (regionCode) {
    sql += ` AND (p.region_code IS NULL OR p.region_code = ?)`;
    params.push(regionCode);
  }

  sql += ` ORDER BY p.duration_months ASC`;

  const [rows] = await pool.query(sql, params);
  return rows;
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
    ORDER BY created_at DESC
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
      const variantPrice = session
        ? await fetchVariantPrice(
            session,
            registered.shopify_variant_id,
            registered.shopify_product_id
          )
        : null;

      let resolvedPrice = Number(plan.price);
      let resolvedPricingType = normalizeWarrantyPricingType(
        settings.warranty_pricing_type
      );

      if (resolvedPricingType === "percentage" && variantPrice != null) {
        const resolved = resolvePlanPrice({
          configuredPrice: plan.price,
          pricingType: resolvedPricingType,
          productVariantPrice: variantPrice,
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

    const storeName = shopDisplayName || "Sonova Team";

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

    const purchaseHtml = ExtendedWarrantyPurchaseTemplate({
      customerName: customerName || registered.customer_name || "Customer",
      productTitle: registered.product_name,
      orderNumber: shopifyOrderName || shopifyOrderId,
      planName: plan.plan_name,
      durationMonths: plan.duration_months,
      price: String(purchasePrice),
      currency: purchaseCurrency,
      storeName,
    });

    await sendEmailService({
      to: customerEmail || registered.customer_email,
      subject: "Extended Warranty Purchase Confirmation",
      html: purchaseHtml,
      from: process.env.DEFAULT_FROM_EMAIL,
    });

    const activationHtml = ExtendedWarrantyActivationTemplate({
      customerName: customerName || registered.customer_name || "Customer",
      productTitle: registered.product_name,
      serialNumber: registered.serial_number,
      planName: plan.plan_name,
      activationDate: activationDate.toISOString().split("T")[0],
      expiryDate: expiryDate.toISOString().split("T")[0],
      storeName,
    });

    await sendEmailService({
      to: customerEmail || registered.customer_email,
      subject: "Extended Warranty Activated",
      html: activationHtml,
      from: process.env.DEFAULT_FROM_EMAIL,
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
  const { session = null } = options;
  const settings = await getExtendedWarrantySettings(shopId);
  const regionCode = settings.region_code || null;

  if (!settings.enabled) {
    return { eligible: false, reason: "extended_warranty_disabled" };
  }

  const registered = await loadRegisteredProduct(shopId, registerId);
  if (!registered) {
    return { eligible: false, reason: "registration_not_found" };
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

  const plans = await loadEligiblePlans(shopId, registered, regionCode);
  if (!plans.length) {
    return { eligible: false, reason: "no_plans_configured" };
  }

  const pricingType = normalizeWarrantyPricingType(settings.warranty_pricing_type);
  const productVariantPrice =
    pricingType === "percentage" && session
      ? await fetchVariantPrice(
          session,
          registered.shopify_variant_id,
          registered.shopify_product_id
        )
      : null;

  const shopCurrency = plans[0]?.currency || null;

  const basePlans = [];
  for (const p of plans) {
    const pricing = mapPlanForApi(p, pricingType, productVariantPrice);
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
      termsUrl: settings.terms_url,
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
    pendingEntitlement:
      existing?.status === "pending_payment"
        ? formatEntitlementForApi(existing, registered)
        : null,
  };
}

export async function canPurchaseExtendedWarranty(shopId, registerId) {
  const offer = await buildExtendedWarrantyOffer(shopId, registerId);
  return {
    eligible: Boolean(offer.eligible),
    reason: offer.reason || null,
    purchaseWindow: offer.purchaseWindow || null,
  };
}

/** Safety net when ORDERS_PAID webhook was missed (e.g. tunnel downtime). */
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
