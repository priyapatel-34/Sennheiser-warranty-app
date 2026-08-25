/**
 * Centralized extended-warranty product eligibility.
 *
 * Default-eligible Shopify product types (normalized):
 *   - audiophile-headphones
 *   - soundbar
 *
 * Default exclusions, based on Shopify `productType` and `tags` after the same
 * normalization (lowercase, trim, non-alphanumeric → hyphen). No title matching.
 *   - accessory / accessories
 *   - spare-part / spare-parts
 *   - empty / null / undefined product type
 *
 * Effective eligibility for a shop:
 *   isDefaultEligible(product) OR hasAdminOverride(product, shop)
 */

export const DEFAULT_ELIGIBLE_TYPE_SLUGS = Object.freeze([
  "audiophile-headphones",
  "soundbar",
  "headphones",
  "Soundbars & Sub",
  "Audiophile Headphones",
  "product-type--audiophile-headphones",
  "product-type--soundbar",
  "product-type--wireless-headphones",
]);

const DEFAULT_ELIGIBLE_COMPACT = new Set(
  DEFAULT_ELIGIBLE_TYPE_SLUGS.map((slug) => slug.replace(/-/g, ""))
);

const DEFAULT_ELIGIBLE_SLUG_SET = new Set(DEFAULT_ELIGIBLE_TYPE_SLUGS);

/**
 * Shopify search tokens used to pre-filter the Admin catalog. Local eligibility
 * remains the source of truth after the query returns.
 */
export const DEFAULT_ELIGIBLE_SHOPIFY_TYPE_QUERIES = Object.freeze([
  "product_type:audiophile-headphones",
  'product_type:"audiophile headphones"',
  "product_type:soundbar",
  'product_type:"sound bar"',
  "product_type:headphones",
  'product_type:"headphones"',
]);

const EXCLUDED_TYPE_SLUGS = new Set([
  "accessory",
  "accessories",
  "spare-part",
  "spare-parts",
  "sparepart",
  "spareparts",
]);

const EXCLUDED_TYPE_COMPACT = new Set(
  [...EXCLUDED_TYPE_SLUGS].map((slug) => slug.replace(/-/g, ""))
);

const MAX_OVERRIDE_IDS_IN_SEARCH_QUERY = 100;

/**
 * Normalizes a Shopify GID or numeric id into a finite numeric id.
 */
export function getNumericIdFromGid(gid) {
  if (gid == null || gid === "") return null;
  const numeric = Number(String(gid).split("/").pop());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Converts a Shopify product type or tag into a stable slug for comparisons.
 */
export function slugifyProductType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Strips hyphens from a slug so "sound-bar" and "soundbar" compare equally.
 */
export function compactProductType(value) {
  return slugifyProductType(value).replace(/-/g, "");
}

/**
 * True when the product has a non-empty Shopify product type.
 */
export function hasDefinedProductType(product) {
  const raw =
    product?.productType ??
    product?.product_type ??
    product?.category ??
    "";
  return String(raw).trim().length > 0;
}

/**
 * Normalizes Shopify tags from an array or comma-separated string.
 */
export function normalizeTagList(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag || "").trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function classificationMatches(value, slugSet, compactSet) {
  const slug = slugifyProductType(value);
  if (!slug) return false;
  if (slugSet.has(slug)) return true;
  return compactSet.has(slug.replace(/-/g, ""));
}

function isEligibleTypeValue(value) {
  const slug = slugifyProductType(value);
  if (!slug) return false;
  if (DEFAULT_ELIGIBLE_SLUG_SET.has(slug)) return true;
  return DEFAULT_ELIGIBLE_COMPACT.has(slug.replace(/-/g, ""));
}

/**
 * True when product type or tags identify an accessory or spare part.
 */
export function isExcludedClassification(product) {
  const productType =
    product?.productType ?? product?.product_type ?? product?.category ?? "";
  if (classificationMatches(productType, EXCLUDED_TYPE_SLUGS, EXCLUDED_TYPE_COMPACT)) {
    return true;
  }
  return normalizeTagList(product?.tags).some((tag) =>
    classificationMatches(tag, EXCLUDED_TYPE_SLUGS, EXCLUDED_TYPE_COMPACT)
  );
}

/**
 * Default (non-override) eligibility: approved type, defined type, and not an
 * accessory/spare-part classification.
 */
export function isDefaultEligible(product) {
  const productType =
    product?.productType ?? product?.product_type ?? product?.category ?? "";
  if (!hasDefinedProductType(product)) return false;
  if (!isEligibleTypeValue(productType)) return false;
  if (isExcludedClassification(product)) return false;
  return true;
}

/**
 * Effective eligibility used by every admin product listing path.
 */
export function isEffectivelyEligible(product, overrideProductIds = []) {
  const numericId = getNumericIdFromGid(product?.id ?? product?.shopifyProductId);
  if (
    numericId &&
    Array.isArray(overrideProductIds) &&
    overrideProductIds.some((id) => Number(id) === Number(numericId))
  ) {
    return true;
  }
  return isDefaultEligible(product);
}

/**
 * Variant of `isEffectivelyEligible` that accepts an admin-configured
 * allowed product-type list (raw strings). When `allowedTypesRaw` is
 * non-empty, only products matching those types or explicit overrides are
 * considered eligible. Otherwise falls back to standard effective logic.
 */
export function isEffectivelyEligibleWithAllowed(
  product,
  overrideProductIds = [],
  allowedTypesRaw = []
) {
  const allowed = Array.isArray(allowedTypesRaw) ? allowedTypesRaw : [];
  if (allowed.length) {
    const allowedSet = new Set(allowed.map((t) => slugifyProductType(t)).filter(Boolean));
    const numericId = getNumericIdFromGid(product?.id ?? product?.shopifyProductId);
    if (
      numericId &&
      Array.isArray(overrideProductIds) &&
      overrideProductIds.some((id) => Number(id) === Number(numericId))
    ) {
      return true;
    }
    const nodeSlug = slugifyProductType(product?.productType ?? product?.product_type ?? product?.category ?? "");
    return allowedSet.has(nodeSlug);
  }
  return isEffectivelyEligible(product, overrideProductIds);
}

/**
 * True when a product should appear in the "Add products" picker.
 */
export function isExcludedFromDefaultList(product, overrideProductIds = []) {
  return !isEffectivelyEligible(product, overrideProductIds);
}

/**
 * Server-side validation result for adding a product override. Null means the
 * product can be added.
 */
export function getOverrideSkipReason(product, overrideProductIds = []) {
  if (!product) {
    return {
      reason: "not_found",
      message: "Product was not found in Shopify",
    };
  }
  if (isDefaultEligible(product)) {
    return {
      reason: "already_eligible",
      message: "Product is already eligible by default",
    };
  }
  const numericId = getNumericIdFromGid(product.id ?? product.shopifyProductId);
  if (
    numericId &&
    Array.isArray(overrideProductIds) &&
    overrideProductIds.some((id) => Number(id) === Number(numericId))
  ) {
    return {
      reason: "already_added",
      message: "Product is already on the eligible list",
    };
  }
  return null;
}

function sanitizeSearchTerm(searchTerm) {
  return String(searchTerm || "")
    .replace(/["\\]/g, " ")
    .trim();
}

function buildStatusQuery(statusFilter = "") {
  const status = String(statusFilter || "")
    .toLowerCase()
    .trim();
  if (status === "active") return "status:active";
  if (status === "draft") return "status:draft";
  if (status === "archived") return "status:archived";
  return "(status:active OR status:draft)";
}

/**
 * Builds the Shopify product search string for the default eligible catalog,
 * including shop-scoped admin overrides by numeric product id.
 */
export function buildEligibleProductsShopifyQuery({
  searchTerm = "",
  statusFilter = "",
  overrideProductIds = [],
} = {}) {
  const statusQuery = buildStatusQuery(statusFilter);
  const typeQuery = DEFAULT_ELIGIBLE_SHOPIFY_TYPE_QUERIES.join(" OR ");
  const overrideIds = [...new Set((overrideProductIds || []).map(Number))]
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, MAX_OVERRIDE_IDS_IN_SEARCH_QUERY);
  const idQuery = overrideIds.map((id) => `id:${id}`).join(" OR ");

  const hasStatusFilter = Boolean(String(statusFilter || "").trim());
  let eligibilityQuery;
  if (idQuery && !hasStatusFilter) {
    eligibilityQuery = `((${typeQuery}) AND ${statusQuery}) OR (${idQuery})`;
  } else if (idQuery) {
    eligibilityQuery = `((${typeQuery}) OR (${idQuery})) AND ${statusQuery}`;
  } else {
    eligibilityQuery = `(${typeQuery}) AND ${statusQuery}`;
  }

  const sanitized = sanitizeSearchTerm(searchTerm);
  if (!sanitized) return eligibilityQuery;
  return `(title:*${sanitized}* OR sku:*${sanitized}*) AND (${eligibilityQuery})`;
}

/**
 * Builds a Shopify product search string for the excluded-product picker.
 * Local eligibility filtering remains authoritative after results return.
 */
export function buildExcludedProductsShopifyQuery({
  searchTerm = "",
  statusFilter = "",
} = {}) {
  const statusQuery = buildStatusQuery(statusFilter);
  const sanitized = sanitizeSearchTerm(searchTerm);
  if (!sanitized) return statusQuery;
  return `(title:*${sanitized}* OR sku:*${sanitized}*) AND ${statusQuery}`;
}

/**
 * Applies an additional local filter so product search can match titles and
 * variant SKUs after the Shopify query returns results.
 */
export function productMatchesSearchTerm(productNode, searchTerm) {
  const term = String(searchTerm || "")
    .trim()
    .toLowerCase();
  if (!term) return true;

  const title = String(productNode?.title || "").toLowerCase();
  if (title.includes(term)) return true;

  const variants = productNode?.variants?.edges || [];
  return variants.some((edge) => {
    const variant = edge.node || {};
    const variantTitle = String(
      variant.displayName || variant.title || ""
    ).toLowerCase();
    const sku = String(variant.sku || "").toLowerCase();
    return variantTitle.includes(term) || sku.includes(term);
  });
}

/**
 * Loads enabled override product ids for a shop.
 */
export async function listEnabledOverrideProductIds(db, shopId) {
  const [rows] = await db.query(
    `
    SELECT shopify_product_id
    FROM extended_warranty_product_overrides
    WHERE shop_id = ?
      AND enabled = 1
    `,
    [shopId]
  );
  return rows
    .map((row) => Number(row.shopify_product_id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Returns whether a shop already has an enabled override for a product.
 */
export async function hasProductOverride(db, shopId, productId) {
  const numericId = getNumericIdFromGid(productId);
  if (!numericId) return false;
  const [[row]] = await db.query(
    `
    SELECT id
    FROM extended_warranty_product_overrides
    WHERE shop_id = ?
      AND shopify_product_id = ?
      AND enabled = 1
    LIMIT 1
    `,
    [shopId, numericId]
  );
  return Boolean(row);
}

/**
 * Inserts or re-enables a shop-scoped product override. Unique (shop, product)
 * prevents duplicates.
 */
export async function upsertProductOverride(db, shopId, productId, actor = null) {
  const numericId = getNumericIdFromGid(productId);
  if (!numericId) {
    throw new Error("Invalid product ID");
  }

  await db.query(
    `
    INSERT INTO extended_warranty_product_overrides (
      shop_id,
      shopify_product_id,
      enabled,
      created_by,
      updated_by
    ) VALUES (?, ?, 1, ?, ?)
    ON DUPLICATE KEY UPDATE
      enabled = 1,
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP
    `,
    [shopId, numericId, actor, actor]
  );

  return numericId;
}

/**
 * Removes a shop-scoped product override. Does not delete warranty pricing.
 */
export async function deleteProductOverride(db, shopId, productId) {
  const numericId = getNumericIdFromGid(productId);
  if (!numericId) {
    throw new Error("Invalid product ID");
  }

  const [result] = await db.query(
    `
    DELETE FROM extended_warranty_product_overrides
    WHERE shop_id = ?
      AND shopify_product_id = ?
    `,
    [shopId, numericId]
  );
  return result.affectedRows;
}
