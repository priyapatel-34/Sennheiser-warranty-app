import { pool } from "../db/mysql.js";
import { computeExtendedWarrantyDates } from "./extendedWarranty.service.js";
import {
  attributesFromLineItem,
  findParentProductLine,
  isPdpExtendedWarrantyLine,
  lineItemId,
  lineProductId,
  lineVariantId,
  numericShopifyId,
} from "./pdpExtendedWarranty.utils.js";

function graphqlUnitPrice(item) {
  return (
    item?.discountedUnitPriceSet?.shopMoney?.amount ||
    item?.originalUnitPriceSet?.shopMoney?.amount ||
    item?.discountedUnitPrice ||
    item?.originalUnitPrice ||
    item?.price ||
    null
  );
}

function graphqlCurrency(item) {
  return (
    item?.discountedUnitPriceSet?.shopMoney?.currencyCode ||
    item?.originalUnitPriceSet?.shopMoney?.currencyCode ||
    item?.currency ||
    null
  );
}

function normalizeGraphqlLine(node) {
  if (!node) return null;
  return {
    id: numericShopifyId(node.id),
    product_id: numericShopifyId(node.product?.id),
    variant_id: numericShopifyId(node.variant?.id),
    customAttributes: node.customAttributes || [],
    price: graphqlUnitPrice(node),
    currency: graphqlCurrency(node),
    title: node.title || node.name,
    quantity: node.quantity,
  };
}

function normalizeRestLine(item) {
  if (!item) return null;
  return {
    id: numericShopifyId(item.id),
    product_id: numericShopifyId(item.product_id),
    variant_id: numericShopifyId(item.variant_id),
    properties: item.properties || [],
    price: item.price,
    currency: item.price_set?.shop_money?.currency_code || null,
    title: item.title,
    quantity: item.quantity,
  };
}

export function collectPdpWarrantyTargets(orderPayload = {}, graphqlLineItems = []) {
  const restLines = (orderPayload.line_items || []).map(normalizeRestLine).filter(Boolean);
  const gqlLines = (graphqlLineItems || [])
    .map((edge) => normalizeGraphqlLine(edge.node || edge))
    .filter(Boolean);

  const byId = new Map();
  for (const line of [...restLines, ...gqlLines]) {
    if (!line.id) continue;
    const existing = byId.get(line.id) || {};
    byId.set(line.id, {
      ...existing,
      ...line,
      customAttributes: line.customAttributes || existing.customAttributes,
      properties: line.properties || existing.properties,
      price: line.price || existing.price,
      currency: line.currency || existing.currency,
    });
  }

  const lines = [...byId.values()];
  const usedParents = new Set();
  const targets = [];

  for (const line of lines) {
    if (!isPdpExtendedWarrantyLine(line)) continue;
    const attrs = attributesFromLineItem(line);
    const planId = Number(attrs._ew_plan_id);
    if (!Number.isFinite(planId) || planId <= 0) continue;

    const parent = findParentProductLine(line, lines, usedParents);
    const parentId = lineItemId(parent);
    if (parentId) usedParents.add(parentId);

    targets.push({
      planId,
      parentLineItemId: parentId,
      productId: lineProductId(parent) || numericShopifyId(attrs._ew_product_id),
      variantId: lineVariantId(parent) || numericShopifyId(attrs._ew_variant_id),
      price: line.price,
      currency: line.currency,
      title: parent?.title || attrs._ew_product_id || "Product",
    });
  }

  return targets;
}

async function loadPlan(conn, shopId, planId) {
  const [[plan]] = await conn.query(
    `SELECT * FROM extended_warranty_plans WHERE shop_id = ? AND id = ? AND status = 'active'`,
    [shopId, planId]
  );
  return plan || null;
}

/**
 * Creates an extended-warranty entitlement from a paid PDP cart purchase.
 * The entitlement stays unattached to a registration until the customer
 * completes standard warranty with a serial number.
 */
export async function activatePdpEntitlementsFromOrder({
  shopId,
  shopifyOrderId,
  customerEmail,
  pricingType,
  targets,
}) {
  if (!shopId || !shopifyOrderId || !targets?.length) return [];

  const orderId = numericShopifyId(shopifyOrderId);
  const results = [];
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const target of targets) {
      if (!target.planId || !target.parentLineItemId) {
        console.warn("[EW PDP Webhook] Skipping warranty line without parent/plan", target);
        continue;
      }

      const [[existing]] = await conn.query(
        `
        SELECT *
        FROM extended_warranty_entitlements
        WHERE shop_id = ?
          AND shopify_order_id = ?
          AND shopify_parent_line_item_id = ?
          AND status IN ('active', 'pending_payment')
        LIMIT 1
        FOR UPDATE
        `,
        [shopId, String(orderId), String(target.parentLineItemId)]
      );

      if (existing) {
        results.push(existing);
        continue;
      }

      const plan = await loadPlan(conn, shopId, target.planId);
      if (!plan) {
        console.warn("[EW PDP Webhook] Plan not found for PDP warranty line", {
          shopId,
          planId: target.planId,
          orderId,
        });
        continue;
      }

      const dates = computeExtendedWarrantyDates({ warranty_end: null }, plan);
      const price = Number(target.price);
      const resolvedPrice = Number.isFinite(price) && price > 0 ? price : Number(plan.price);
      const currency = target.currency || plan.currency;

      await conn.query(
        `
        INSERT INTO extended_warranty_entitlements (
          shop_id,
          registered_product_id,
          extended_warranty_plan_id,
          shopify_order_id,
          shopify_parent_line_item_id,
          shopify_product_id,
          shopify_variant_id,
          customer_email,
          source,
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
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'pdp', 'active', ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)
        `,
        [
          shopId,
          plan.id,
          String(orderId),
          String(target.parentLineItemId),
          target.productId ? String(target.productId) : null,
          target.variantId ? String(target.variantId) : null,
          customerEmail ? String(customerEmail).trim().toLowerCase() : null,
          plan.plan_name,
          plan.duration_years,
          plan.duration_months,
          resolvedPrice,
          currency,
          pricingType || plan.pricing_type || "amount",
          dates.startDate,
          dates.endDate,
        ]
      );

      const [[created]] = await conn.query(
        `
        SELECT *
        FROM extended_warranty_entitlements
        WHERE shop_id = ?
          AND shopify_order_id = ?
          AND shopify_parent_line_item_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [shopId, String(orderId), String(target.parentLineItemId)]
      );
      results.push(created);
      console.log("[EW PDP Webhook] Created unattached PDP entitlement", {
        entitlementId: created?.id,
        orderId,
        parentLineItemId: target.parentLineItemId,
        planId: plan.id,
      });
    }

    await conn.commit();
    return results;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getUnattachedPdpEntitlements(shopId, { customerEmail, orderIds = [] } = {}) {
  const clauses = ["shop_id = ?", "registered_product_id IS NULL", "status IN ('active', 'refunded', 'cancelled', 'expired')"];
  const params = [shopId];

  if (customerEmail) {
    clauses.push("LOWER(TRIM(customer_email)) = ?");
    params.push(String(customerEmail).trim().toLowerCase());
  }

  const numericOrderIds = [...new Set(orderIds.map(numericShopifyId).filter(Boolean))];
  if (numericOrderIds.length) {
    clauses.push(`shopify_order_id IN (${numericOrderIds.map(() => "?").join(",")})`);
    params.push(...numericOrderIds);
  }

  const [rows] = await pool.query(
    `
    SELECT *
    FROM extended_warranty_entitlements
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC
    `,
    params
  );
  return rows;
}

export async function getEntitlementForShopifyLine(shopId, { orderId, lineItemId }) {
  const numericOrder = numericShopifyId(orderId);
  const numericLine = numericShopifyId(lineItemId);
  if (!numericOrder || !numericLine) return null;

  const [[row]] = await pool.query(
    `
    SELECT *
    FROM extended_warranty_entitlements
    WHERE shop_id = ?
      AND shopify_order_id = ?
      AND shopify_parent_line_item_id = ?
      AND status IN ('active', 'refunded', 'cancelled', 'expired')
    ORDER BY FIELD(status, 'active', 'refunded', 'cancelled', 'expired'), created_at DESC
    LIMIT 1
    `,
    [shopId, numericOrder, numericLine]
  );
  return row || null;
}

/**
 * Links a paid PDP entitlement to the standard-warranty registration and
 * recalculates coverage dates from the newly known standard warranty end.
 */
export async function attachPdpEntitlementToRegistration(conn, {
  shopId,
  registerId,
  orderId,
  lineItemId,
  productId,
  variantId,
  registeredProduct,
}) {
  if (!shopId || !registerId) return null;

  const numericOrder = numericShopifyId(orderId);
  const numericLine = numericShopifyId(lineItemId);
  const clauses = ["shop_id = ?", "registered_product_id IS NULL", "status = 'active'"];
  const params = [shopId];

  if (numericOrder && numericLine) {
    clauses.push("shopify_order_id = ?", "shopify_parent_line_item_id = ?");
    params.push(numericOrder, numericLine);
  } else if (numericOrder && productId && variantId) {
    clauses.push("shopify_order_id = ?", "shopify_product_id = ?", "shopify_variant_id = ?");
    params.push(numericOrder, String(productId), String(variantId));
  } else {
    return null;
  }

  const [[entitlement]] = await conn.query(
    `
    SELECT *
    FROM extended_warranty_entitlements
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
    `,
    params
  );

  if (!entitlement) return null;

  const dates = computeExtendedWarrantyDates(registeredProduct, {
    duration_months: entitlement.duration_months,
  });

  await conn.query(
    `
    UPDATE extended_warranty_entitlements
    SET
      registered_product_id = ?,
      shopify_parent_line_item_id = COALESCE(shopify_parent_line_item_id, ?),
      shopify_product_id = COALESCE(shopify_product_id, ?),
      shopify_variant_id = COALESCE(shopify_variant_id, ?),
      activation_date = ?,
      expiry_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      registerId,
      numericLine || null,
      productId ? String(productId) : null,
      variantId ? String(variantId) : null,
      dates.startDate,
      dates.endDate,
      entitlement.id,
    ]
  );

  console.log("[EW PDP] Linked entitlement to registration", {
    entitlementId: entitlement.id,
    registerId,
    orderId: numericOrder,
    lineItemId: numericLine,
  });

  return entitlement.id;
}

/**
 * Creates missing PDP entitlements for paid Shopify orders that already contain
 * warranty line items. Safe to call from My Products when a webhook was missed.
 */
export async function healPdpEntitlementsFromOrders({
  shopId,
  customerEmail,
  orders = [],
  pricingType,
}) {
  if (!shopId || !orders.length) return [];

  const created = [];
  for (const order of orders) {
    const edges = order.lineItems?.edges || [];
    const targets = collectPdpWarrantyTargets({}, edges);
    if (!targets.length) continue;

    let missing = false;
    for (const target of targets) {
      const existing = await getEntitlementForShopifyLine(shopId, {
        orderId: order.id,
        lineItemId: target.parentLineItemId,
      });
      if (!existing) {
        missing = true;
        break;
      }
    }

    if (!missing) continue;

    try {
      const rows = await activatePdpEntitlementsFromOrder({
        shopId,
        shopifyOrderId: order.id,
        customerEmail,
        pricingType,
        targets,
      });
      created.push(...(rows || []).filter(Boolean));
    } catch (err) {
      console.error("[EW PDP] Failed to heal entitlements from order", {
        orderId: numericShopifyId(order.id),
        error: err.message,
      });
    }
  }
  return created;
}
