/**
 * Targeted extended-warranty pricing deletion.
 *
 * ALL pricing deletes are soft deletes.
 * Existing entitlement records are never deleted/cascaded.
 */

export const PRICING_DELETE_SCOPE = Object.freeze({
  PLAN: "plan",
  VARIANT: "variant",
  PRODUCT: "product",
  VARIANT_DURATION: "variant_duration",
});

function serializePlanRow(row) {
  return {
    id: row.id,
    shopId: row.shop_id,
    shopifyProductId: row.shopify_product_id,
    shopifyVariantId: row.shopify_variant_id,
    planName: row.plan_name,
    durationYears: row.duration_years,
    durationMonths: row.duration_months,
    price: row.price,
    currency: row.currency,
    status: row.status,
  };
}

export function buildPricingDeleteWhere({
  shopId,
  planId = null,
  productId = null,
  variantId = null,
  durationMonths = null,
} = {}) {
  if (!shopId) {
    throw new Error("shopId is required");
  }

  const hasPlanId = planId != null && planId !== "";
  const hasProductId = productId != null && productId !== "";
  const hasVariantId = variantId != null && variantId !== "";

  const hasDuration =
    durationMonths != null &&
    durationMonths !== "" &&
    Number.isFinite(Number(durationMonths));

  if (!hasPlanId && !hasProductId && !hasVariantId) {
    throw new Error("A pricing identifier is required");
  }

  const clauses = ["shop_id = ?"];
  const params = [shopId];

  if (hasPlanId) {
    clauses.push("id = ?");
    params.push(Number(planId));
  }

  if (hasProductId) {
    clauses.push("shopify_product_id = ?");
    params.push(Number(productId));
  }

  if (hasVariantId) {
    clauses.push("shopify_variant_id = ?");
    params.push(Number(variantId));
  }

  if (hasDuration) {
    clauses.push("duration_months = ?");
    params.push(Number(durationMonths));
  }

  return {
    whereSql: clauses.join(" AND "),
    params,
  };
}

/**
 * Soft-deletes matching warranty pricing records.
 *
 * IMPORTANT:
 * - Never DELETEs from extended_warranty_plans.
 * - Never deletes/deactivates entitlements.
 * - Always scopes by shop_id.
 * - Already inactive rows are ignored.
 */
export async function removeWarrantyPricingRecords(
  db,
  {
    shopId,
    planId = null,
    productId = null,
    variantId = null,
    durationMonths = null,
  }
) {
  const { whereSql, params } = buildPricingDeleteWhere({
    shopId,
    planId,
    productId,
    variantId,
    durationMonths,
  });

  const [planRows] = await db.query(
    `
      SELECT
        id,
        shop_id,
        shopify_product_id,
        shopify_variant_id,
        plan_name,
        duration_years,
        duration_months,
        price,
        currency,
        status
      FROM extended_warranty_plans
      WHERE ${whereSql}
        AND status != 'inactive'
    `,
    params
  );

  if (!planRows.length) {
    const error = new Error("Pricing record not found");
    error.statusCode = 404;
    throw error;
  }

  const planIds = planRows.map((row) => row.id);
  const placeholders = planIds.map(() => "?").join(",");

  await db.query(
    `
      UPDATE extended_warranty_plans
      SET
        status = 'inactive',
        updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ?
        AND id IN (${placeholders})
        AND status != 'inactive'
    `,
    [shopId, ...planIds]
  );

  return {
    removed: planRows.length,
    deleted: 0,
    deactivated: planRows.length,
    records: planRows.map(serializePlanRow),
  };
}
