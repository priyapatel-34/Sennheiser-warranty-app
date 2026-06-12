import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { sendEmailService } from "./email.service.js";
import ExtendedWarrantyPurchaseTemplate from "../emailTemp/extended_warranty_purchase.js";
import ExtendedWarrantyActivationTemplate from "../emailTemp/extended_warranty_activation.js";

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

export async function getExtendedWarrantySettings(shopId) {
  const [[row]] = await pool.query(
    `
    SELECT
      enabled,
      offer_after_registration,
      terms_url,
      coverage_text,
      store_display_name,
      region_code
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
      store_display_name: null,
      region_code: null,
    }
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
    if (!map.has(key) || row.status === "active") {
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
      currency
    ) VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?)
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
}) {
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
          purchase_date,
          activation_date,
          expiry_date
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, CURDATE(), ?, ?)
        `,
        [
          shopId,
          registerId,
          planId,
          shopifyOrderId,
          plan.plan_name,
          plan.duration_years,
          plan.duration_months,
          plan.price,
          plan.currency,
          activationDate,
          expiryDate,
        ]
      );
    }

    await conn.commit();

    const settings = await getExtendedWarrantySettings(shopId);
    const storeName = shopDisplayName || settings.store_display_name || "Sonova Team";

    const purchaseHtml = ExtendedWarrantyPurchaseTemplate({
      customerName: customerName || registered.customer_name || "Customer",
      productTitle: registered.product_name,
      orderNumber: shopifyOrderName || shopifyOrderId,
      planName: plan.plan_name,
      durationMonths: plan.duration_months,
      price: String(plan.price),
      currency: plan.currency,
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

export async function cancelEntitlementFromRefund({
  shopId,
  shopifyOrderId,
  shopifyRefundId = null,
}) {
  const [entitlements] = await pool.query(
    `
    SELECT e.*, r.warranty_end, r.customer_email, r.sku
    FROM extended_warranty_entitlements e
    LEFT JOIN registered_products r
      ON r.id = e.registered_product_id AND r.shop_id = e.shop_id
    WHERE e.shop_id = ?
      AND e.shopify_order_id = ?
      AND e.status IN ('active', 'pending_payment')
    `,
    [shopId, shopifyOrderId]
  );

  const results = [];

  for (const entitlement of entitlements) {
    const calculation = calculateProRataRefund(entitlement);
    const wasActivated = Boolean(entitlement.activation_date);
    const newStatus = wasActivated ? "refunded" : "cancelled";

    await pool.query(
      `
      UPDATE extended_warranty_entitlements
      SET
        status = ?,
        refund_amount = ?,
        refunded_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [newStatus, calculation.refundAmount, entitlement.id]
    );

    await pool.query(
      `
      INSERT INTO extended_warranty_refund_records (
        shop_id,
        entitlement_id,
        shopify_order_id,
        shopify_refund_id,
        original_amount,
        calculated_refund_amount,
        currency,
        total_coverage_days,
        remaining_days,
        refund_percentage_applied,
        calculation_notes,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 'pending_finance_action')
      `,
      [
        shopId,
        entitlement.id,
        shopifyOrderId,
        shopifyRefundId,
        entitlement.price,
        calculation.refundAmount,
        entitlement.currency,
        calculation.totalCoverageDays,
        calculation.remainingDays,
        calculation.notes,
      ]
    );

    results.push({ entitlementId: entitlement.id, ...calculation });
  }

  return results;
}

/** Fixed PRD Section 5.2 defaults — not admin-configurable in Phase 2A. */
export async function getRefundSettings(_shopId) {
  return {
    refund_enabled: 1,
    pro_rata_enabled: 1,
    cancel_on_refund: 1,
  };
}

export async function saveRefundSettings(shopId, settings) {
  const {
    refundEnabled = true,
    proRataEnabled = true,
    refundPercentage = 100,
    cancelOnRefund = true,
    minimumUsedDays = 0,
  } = settings;

  await pool.query(
    `
    INSERT INTO extended_warranty_refund_settings (
      shop_id,
      refund_enabled,
      pro_rata_enabled,
      refund_percentage,
      cancel_on_refund,
      minimum_used_days
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      refund_enabled = VALUES(refund_enabled),
      pro_rata_enabled = VALUES(pro_rata_enabled),
      refund_percentage = VALUES(refund_percentage),
      cancel_on_refund = VALUES(cancel_on_refund),
      minimum_used_days = VALUES(minimum_used_days),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      shopId,
      refundEnabled ? 1 : 0,
      proRataEnabled ? 1 : 0,
      Number(refundPercentage),
      cancelOnRefund ? 1 : 0,
      Number(minimumUsedDays) || 0,
    ]
  );
}

/**
 * PRD Section 5.2:
 * (total_coverage_days - days_used) / total_coverage_days × purchase_price
 * Full refund when extended warranty was never activated.
 */
export function calculateProRataRefund(entitlement) {
  const price = Number(entitlement.price);

  if (!entitlement.activation_date) {
    return {
      refundAmount: price,
      totalCoverageDays: Number(entitlement.duration_months || 0) * 30 || 1,
      remainingDays: Number(entitlement.duration_months || 0) * 30 || 1,
      usedDays: 0,
      notes: "Full refund — extended warranty was not activated",
    };
  }

  const activation = new Date(entitlement.activation_date);
  const expiry = new Date(entitlement.expiry_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  activation.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  const msPerDay = 86400000;
  const totalCoverageDays = Math.max(
    1,
    Math.round((expiry - activation) / msPerDay)
  );
  const usedDays = Math.max(0, Math.round((today - activation) / msPerDay));
  const remainingDays = Math.max(0, totalCoverageDays - usedDays);
  const refundAmount =
    Math.round((remainingDays / totalCoverageDays) * price * 100) / 100;

  return {
    refundAmount,
    totalCoverageDays,
    remainingDays,
    usedDays,
    notes: `Pro-rata: (${totalCoverageDays} - ${usedDays}) / ${totalCoverageDays} × ${price}`,
  };
}

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

export async function buildExtendedWarrantyOffer(shopId, registerId) {
  const settings = await getExtendedWarrantySettings(shopId);

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

  const plans = await loadEligiblePlans(shopId, registered);
  if (!plans.length) {
    return { eligible: false, reason: "no_plans_configured" };
  }

  const shopCurrency = plans[0]?.currency || null;

  return {
    eligible: true,
    currency: shopCurrency,
    settings: {
      termsUrl: settings.terms_url,
      coverageText: settings.coverage_text,
    },
    registration: {
      registerId: registered.id,
      productName: registered.product_name,
      serialNumber: registered.serial_number,
      sku: registered.sku,
      standardWarrantyStart: registered.warranty_start,
      standardWarrantyEnd: registered.warranty_end,
      purchaseDate: registered.purchase_date,
      variantId: registered.shopify_variant_id,
      productId: registered.shopify_product_id,
    },
    plans: plans.map(p => {
      const projected = computeExtendedWarrantyDates(registered, {
        duration_months: p.duration_months,
      });
      return {
        planId: p.plan_id,
        planName: p.plan_name,
        durationYears: p.duration_years,
        durationMonths: p.duration_months,
        price: String(p.price),
        currency: p.currency,
        coverageText: p.coverage_text || settings.coverage_text,
        startDate: formatDateOnly(projected.startDate),
        endDate: formatDateOnly(projected.endDate),
        extendedWarrantyStartDate: formatDateOnly(projected.startDate),
        extendedWarrantyEndDate: formatDateOnly(projected.endDate),
      };
    }),
    pendingEntitlement:
      existing?.status === "pending_payment"
        ? formatEntitlementForApi(existing, registered)
        : null,
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
