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
    actor = null,
    scope = PRICING_DELETE_SCOPE.PLAN,
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

  const entityId =
    planId ??
    variantId ??
    productId ??
    planRows[0]?.id ??
    null;

  await writeAdminAudit(db, {
    shopId,
    actionType: "pricing_delete",
    entityType: "extended_warranty_plan",
    entityId,
    beforeValue: {
      scope,
      records: planRows.map(serializePlanRow),
      deactivatedPlanIds: planIds,
    },
    afterValue: {
      status: "inactive",
    },
    actor,
  });

  return {
    removed: planRows.length,
    deleted: 0,
    deactivated: planRows.length,
    records: planRows.map(serializePlanRow),
  };
}

/**
 * Writes a single admin audit row.
 */
export async function writeAdminAudit(
  db,
  {
    shopId,
    actionType,
    entityType,
    entityId = null,
    beforeValue = null,
    afterValue = null,
    actor = null,
  }
) {
  await db.query(
    `
      INSERT INTO extended_warranty_admin_audit (
        shop_id,
        action_type,
        entity_type,
        entity_id,
        before_value,
        after_value,
        actor
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      shopId,
      actionType,
      entityType,
      entityId == null ? null : String(entityId),
      beforeValue == null ? null : JSON.stringify(beforeValue),
      afterValue == null ? null : JSON.stringify(afterValue),
      actor || null,
    ]
  );
}

// /**
//  * Targeted extended-warranty pricing deletion.
//  *
//  * Always shop-scoped. Never deletes by duration alone. Plans referenced by
//  * customer entitlements are deactivated (`status = inactive`) instead of
//  * hard-deleted so `ON DELETE CASCADE` on entitlements cannot remove coverage.
//  */

// export const PRICING_DELETE_SCOPE = Object.freeze({
//   PLAN: "plan",
//   VARIANT: "variant",
//   PRODUCT: "product",
//   VARIANT_DURATION: "variant_duration",
// });

// /**
//  * Builds a shop-scoped WHERE clause that can only target explicit pricing rows.
//  */
// export function buildPricingDeleteWhere({
//   shopId,
//   planId = null,
//   productId = null,
//   variantId = null,
//   durationMonths = null,
// } = {}) {
//   if (!shopId) {
//     throw new Error("shopId is required");
//   }

//   const hasPlanId = planId != null && planId !== "";
//   const hasProductId = productId != null && productId !== "";
//   const hasVariantId = variantId != null && variantId !== "";
//   const hasDuration =
//     durationMonths != null && durationMonths !== "" && Number.isFinite(Number(durationMonths));

//   if (!hasPlanId && !hasProductId && !hasVariantId) {
//     throw new Error("A pricing identifier is required");
//   }

//   const clauses = ["shop_id = ?"];
//   const params = [shopId];

//   if (hasPlanId) {
//     clauses.push("id = ?");
//     params.push(Number(planId));
//   }
//   if (hasProductId) {
//     clauses.push("shopify_product_id = ?");
//     params.push(Number(productId));
//   }
//   if (hasVariantId) {
//     clauses.push("shopify_variant_id = ?");
//     params.push(Number(variantId));
//   }
//   if (hasDuration) {
//     clauses.push("duration_months = ?");
//     params.push(Number(durationMonths));
//   }

//   return { whereSql: clauses.join(" AND "), params };
// }

// /**
//  * Returns only the rows that belong to the requested shop and scope.
//  */
// export function selectPricingRowsForScope(rows, filters) {
//   // const { whereSql } = buildPricingDeleteWhere(filters);
//   // void whereSql;
//   const shopId = Number(filters.shopId);
//   const planId = filters.planId != null && filters.planId !== "" ? Number(filters.planId) : null;
//   const productId =
//     filters.productId != null && filters.productId !== ""
//       ? Number(filters.productId)
//       : null;
//   const variantId =
//     filters.variantId != null && filters.variantId !== ""
//       ? Number(filters.variantId)
//       : null;
//   const durationMonths =
//     filters.durationMonths != null && filters.durationMonths !== ""
//       ? Number(filters.durationMonths)
//       : null;

//   return (rows || []).filter((row) => {
//     if (Number(row.shop_id) !== shopId) return false;
//     if (planId != null && Number(row.id) !== planId) return false;
//     if (productId != null && Number(row.shopify_product_id) !== productId) return false;
//     if (variantId != null && Number(row.shopify_variant_id) !== variantId) return false;
//     if (
//       durationMonths != null &&
//       Number.isFinite(durationMonths) &&
//       Number(row.duration_months) !== durationMonths
//     ) {
//       return false;
//     }
//     return true;
//   });
// }

// /**
//  * Splits pricing rows into hard-delete vs deactivate based on entitlement use.
//  */
// export function partitionPricingRowsByEntitlements(rows, entitledPlanIds = []) {
//   const entitled = new Set((entitledPlanIds || []).map(Number));
//   const toDeactivate = [];
//   const toDelete = [];
//   for (const row of rows || []) {
//     if (entitled.has(Number(row.id))) toDeactivate.push(row);
//     else toDelete.push(row);
//   }
//   return { toDeactivate, toDelete };
// }

// function serializePlanRow(row) {
//   return {
//     id: row.id,
//     shopId: row.shop_id,
//     shopifyProductId: row.shopify_product_id,
//     shopifyVariantId: row.shopify_variant_id,
//     planName: row.plan_name,
//     durationYears: row.duration_years,
//     durationMonths: row.duration_months,
//     price: row.price,
//     currency: row.currency,
//     status: row.status,
//   };
// }

// /**
//  * Writes a single admin audit row for a pricing or override mutation.
//  */
// export async function writeAdminAudit(db, {
//   shopId,
//   actionType,
//   entityType,
//   entityId = null,
//   beforeValue = null,
//   afterValue = null,
//   actor = null,
// }) {
//   await db.query(
//     `
//     INSERT INTO extended_warranty_admin_audit (
//       shop_id,
//       action_type,
//       entity_type,
//       entity_id,
//       before_value,
//       after_value,
//       actor
//     ) VALUES (?, ?, ?, ?, ?, ?, ?)
//     `,
//     [
//       shopId,
//       actionType,
//       entityType,
//       entityId == null ? null : String(entityId),
//       beforeValue == null ? null : JSON.stringify(beforeValue),
//       afterValue == null ? null : JSON.stringify(afterValue),
//       actor || null,
//     ]
//   );
// }

// /**
//  * Loads matching plan rows, deactivates any that back entitlements, deletes the
//  * rest, and writes an audit record. Callers should wrap this in a transaction.
//  */
// export async function removeWarrantyPricingRecords(db, {
//   shopId,
//   planId = null,
//   productId = null,
//   variantId = null,
//   durationMonths = null,
//   actor = null,
//   scope = PRICING_DELETE_SCOPE.PLAN,
// }) {
//   const { whereSql, params } = buildPricingDeleteWhere({
//     shopId,
//     planId,
//     productId,
//     variantId,
//     durationMonths,
//   });

//   const [planRows] = await db.query(
//     `
//     SELECT
//       id,
//       shop_id,
//       shopify_product_id,
//       shopify_variant_id,
//       plan_name,
//       duration_years,
//       duration_months,
//       price,
//       currency,
//       status
//     FROM extended_warranty_plans
//     WHERE ${whereSql}
//     `,
//     params
//   );

//   if (!planRows.length) {
//     const error = new Error("Pricing record not found");
//     error.statusCode = 404;
//     throw error;
//   }

//   const planIds = planRows.map((row) => row.id);
//   const placeholders = planIds.map(() => "?").join(",");
//   const [entitlementRows] = await db.query(
//     `
//     SELECT DISTINCT extended_warranty_plan_id AS plan_id
//     FROM extended_warranty_entitlements
//     WHERE shop_id = ?
//       AND extended_warranty_plan_id IN (${placeholders})
//     `,
//     [shopId, ...planIds]
//   );
//   const entitledPlanIds = entitlementRows.map((row) => Number(row.plan_id));
//   const { toDeactivate, toDelete } = partitionPricingRowsByEntitlements(
//     planRows,
//     entitledPlanIds
//   );

//   if (toDeactivate.length) {
//     const deactivateIds = toDeactivate.map((row) => row.id);
//     const deactivatePlaceholders = deactivateIds.map(() => "?").join(",");
//     await db.query(
//       `
//       UPDATE extended_warranty_plans
//       SET status = 'inactive',
//           updated_at = CURRENT_TIMESTAMP
//       WHERE shop_id = ?
//         AND id IN (${deactivatePlaceholders})
//       `,
//       [shopId, ...deactivateIds]
//     );
//   }

//   if (toDelete.length) {
//     const deleteIds = toDelete.map((row) => row.id);
//     const deletePlaceholders = deleteIds.map(() => "?").join(",");
//     await db.query(
//       `
//       DELETE FROM extended_warranty_plans
//       WHERE shop_id = ?
//         AND id IN (${deletePlaceholders})
//       `,
//       [shopId, ...deleteIds]
//     );
//   }

//   const entityId =
//     planId ||
//     variantId ||
//     productId ||
//     planRows[0]?.id ||
//     null;

//   await writeAdminAudit(db, {
//     shopId,
//     actionType: "pricing_delete",
//     entityType: "extended_warranty_plan",
//     entityId,
//     beforeValue: {
//       scope,
//       records: planRows.map(serializePlanRow),
//       deactivatedPlanIds: toDeactivate.map((row) => row.id),
//       deletedPlanIds: toDelete.map((row) => row.id),
//     },
//     afterValue: null,
//     actor,
//   });

//   return {
//     removed: planRows.length,
//     deleted: toDelete.length,
//     deactivated: toDeactivate.length,
//     records: planRows.map(serializePlanRow),
//   };
// }
