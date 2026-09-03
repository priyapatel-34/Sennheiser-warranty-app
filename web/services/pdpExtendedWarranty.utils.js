/**
 * Pure helpers for matching PDP extended-warranty order lines to parent
 * product lines. Kept free of Shopify/DB clients so the matching rules can be
 * unit-tested without a store session.
 */

export function numericShopifyId(value) {
  if (value == null || value === "") return null;
  const numeric = String(value).split("/").pop();
  if (!numeric || numeric === "undefined" || numeric === "null") return null;
  return numeric;
}

export function attributesFromLineItem(item) {
  const map = {};
  if (!item) return map;

  if (item.properties && !Array.isArray(item.properties) && typeof item.properties === "object") {
    Object.assign(map, item.properties);
  }

  const attrs = item.customAttributes || (Array.isArray(item.properties) ? item.properties : []);
  for (const attr of attrs) {
    const key = attr?.key || attr?.name;
    if (key) map[key] = attr.value;
  }
  return map;
}

export function isExtendedWarrantyLine(item) {
  return attributesFromLineItem(item)._ew_type === "extended_warranty";
}

export function isPdpExtendedWarrantyLine(item) {
  const attrs = attributesFromLineItem(item);
  return attrs._ew_type === "extended_warranty" && !attrs._ew_register_id;
}

/**
 * True for Shopify warranty catalog lines that must not appear as standalone
 * products in My Products. Prefers line-item metadata, then handle/SKU/title.
 */
export function isWarrantyCatalogLine(item) {
  if (isExtendedWarrantyLine(item)) return true;
  const handle = String(item?.product?.handle || item?.handle || "").toLowerCase();
  if (handle === "sennheiser-extended-warranty") return true;
  const sku = String(item?.sku || item?.variant?.sku || "");
  if (/^EW-\d+/i.test(sku)) return true;
  const title = String(item?.product?.title || item?.title || item?.name || "").trim();
  return /^extended warranty/i.test(title);
}

export function lineProductId(item) {
  return numericShopifyId(
    item?.product_id || item?.product?.id || attributesFromLineItem(item)._ew_product_id
  );
}

export function lineVariantId(item) {
  return numericShopifyId(
    item?.variant_id || item?.variant?.id || attributesFromLineItem(item)._ew_variant_id
  );
}

export function lineItemId(item) {
  return numericShopifyId(item?.id || item?.line_item_id);
}

/**
 * Finds the parent product line for a PDP warranty child in the same order.
 * Prefers product + variant + plan properties over title matching.
 */
export function findParentProductLine(warrantyLine, allLines, usedParentIds = new Set()) {
  const attrs = attributesFromLineItem(warrantyLine);
  const productId = numericShopifyId(attrs._ew_product_id);
  const variantId = numericShopifyId(attrs._ew_variant_id);
  const planId = attrs._ew_plan_id ? String(attrs._ew_plan_id) : null;

  const candidates = (allLines || []).filter((line) => {
    if (isExtendedWarrantyLine(line)) return false;
    const id = lineItemId(line);
    if (id && usedParentIds.has(id)) return false;

    const lineProduct = numericShopifyId(line.product_id || line.product?.id);
    const lineVariant = numericShopifyId(line.variant_id || line.variant?.id);
    if (productId && lineProduct && productId !== lineProduct) return false;
    if (variantId && lineVariant && variantId !== lineVariant) return false;
    return true;
  });

  if (planId) {
    const withPlan = candidates.filter(
      (line) => String(attributesFromLineItem(line)._ew_plan_id || "") === planId
    );
    if (withPlan.length) return withPlan[0];
  }

  return candidates[0] || null;
}

export function entitlementMatchesShopifyProduct(entitlement, product, usedIds = new Set()) {
  if (!entitlement || usedIds.has(entitlement.id)) return false;

  const entOrder = numericShopifyId(entitlement.shopify_order_id);
  const prodOrder = numericShopifyId(product.order_id);
  if (entOrder && prodOrder && entOrder !== prodOrder) return false;

  const entLine = numericShopifyId(entitlement.shopify_parent_line_item_id);
  const prodLine = numericShopifyId(product.line_item_id);
  if (entLine && prodLine) {
    return entLine === prodLine;
  }

  const entProduct = numericShopifyId(entitlement.shopify_product_id);
  const entVariant = numericShopifyId(entitlement.shopify_variant_id);
  const prodProduct = numericShopifyId(product.product_id);
  const prodVariant = numericShopifyId(product.variant_id);

  if (
    entOrder &&
    prodOrder &&
    entOrder === prodOrder &&
    entProduct &&
    prodProduct &&
    entProduct === prodProduct &&
    entVariant &&
    prodVariant &&
    entVariant === prodVariant
  ) {
    return true;
  }

  return false;
}

export function assignEntitlementToProduct(product, entitlements, usedIds = new Set()) {
  if (!product || !Array.isArray(entitlements) || !entitlements.length) return null;
  const match = entitlements.find((row) =>
    entitlementMatchesShopifyProduct(row, product, usedIds)
  );
  if (match) usedIds.add(match.id);
  return match || null;
}
