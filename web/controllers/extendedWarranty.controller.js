import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import {
    MERCHANDISING_BADGE_LABELS,
    buildExpiryReminderAdminConfigs,
    saveExpiryReminderConfigs,
    getExtendedWarrantySettings,
    normalizeTermsUrl,
    parseExtendedWarrantyOfferEnabled,
} from "../services/extendedWarranty.service.js";
import {
    DEFAULT_WARRANTY_PRICING_TYPE,
    normalizeWarrantyPricingType,
    validateConfiguredPlanPrice,
    formatConfiguredPlanPrice,
    resolvePlanPrice,
} from "../services/extendedWarrantyPricing.js";
import {
    getNumericIdFromGid,
    isDefaultEligible,
    isEffectivelyEligible,
    isExcludedFromDefaultList,
    getOverrideSkipReason,
    productMatchesSearchTerm,
    buildEligibleProductsShopifyQuery,
    buildExcludedProductsShopifyQuery,
    listEnabledOverrideProductIds,
    upsertProductOverride,
    deleteProductOverride,
    slugifyProductType,
    isEffectivelyEligibleWithAllowed,
} from "../services/warrantyProductEligibility.service.js";
import {
    PRICING_DELETE_SCOPE,
    removeWarrantyPricingRecords,
    // writeAdminAudit,
} from "../services/extendedWarrantyPricingDeletion.service.js";

/**
 * Resolves a stable actor label for admin audit rows from the Shopify session.
 */
function getAdminActor(session) {
    const user = session?.onlineAccessInfo?.associated_user;
    if (user?.email) return user.email;
    if (user?.id) return `staff:${user.id}`;
    return session?.shop || null;
}

function normalizeProductSearchText(value) {
    return String(value || "")
        .replace(/["\\]/g, " ")
        .trim();
}

function buildShopifyProductSearchQuery(searchTerm, statusFilter = "") {
    const status = String(statusFilter || "").toLowerCase().trim();
    let statusQuery;
    if (status === "active") {
        statusQuery = "status:active";
    } else if (status === "draft") {
        statusQuery = "status:draft";
    } else {
        statusQuery = "(status:active OR status:draft)";
    }

    const term = normalizeProductSearchText(searchTerm);
    if (!term) return statusQuery;
    return `(title:*${term}* OR sku:*${term}*) AND ${statusQuery}`;
}

function getShopifyProductSearchQueryForScope(searchTerm, statusFilter, scope = "eligible") {
    const baseQuery = buildShopifyProductSearchQuery(searchTerm, statusFilter);
    if (scope !== "eligible") return baseQuery;
    return baseQuery;
}

async function loadDisabledProductOverrides(shopId) {
    const [rows] = await pool.query(
        `
        SELECT shopify_product_id
        FROM extended_warranty_product_overrides
        WHERE shop_id = ? AND enabled = 0
        `,
        [shopId]
    );

    return rows.map((row) => Number(row.shopify_product_id));
}

async function loadProductOverrides(shopId) {
    const [rows] = await pool.query(
        `
        SELECT shopify_product_id
        FROM extended_warranty_product_overrides
        WHERE shop_id = ? AND enabled = 1
        `,
        [shopId]
    );

    return new Set(
        rows.flatMap(row => {
            const productId = String(row.shopify_product_id);
            const numeric = Number(productId);
            return Number.isFinite(numeric) ? [productId, numeric] : [productId];
        })
    );
}

async function loadEffectiveProductContext(shopId, products) {
    const overrideIds = await loadProductOverrides(shopId);
    return products.map(product => ({
        ...mapProductWithEligibility(product, overrideIds),
        overrideIds,
    }));
}

async function writeAdminAudit(
    connection,
    {
        shopId,
        session,
        actor,
        actionType,
        entityType,
        entityId,
        beforeValue = null,
        afterValue = null,
    }
) {

    await connection.query(
        `
        INSERT INTO extended_warranty_admin_audit (
          shop_id,
          action_type,
          entity_type,
          entity_id,
          before_value,
          after_value
        ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            shopId,
            actionType,
            entityType,
            String(entityId),
            beforeValue == null ? null : JSON.stringify(beforeValue),
            afterValue == null ? null : JSON.stringify(afterValue),
        ]
    );
}

function parseAdminProductId(productId) {
    if (!productId) return null;
    const productGid = productId.startsWith("gid://")
        ? productId
        : `gid://shopify/Product/${productId}`;
    return getNumericIdFromGid(productGid);
}

function parseAdminVariantId(variantId) {
    if (!variantId) return null;
    const variantGid = variantId.startsWith("gid://")
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`;
    return getNumericIdFromGid(variantGid);
}

/**
 * Resolves the installed shop id for the active session so all warranty admin
 * queries remain scoped to the correct merchant.
 */
async function resolveShopId(session) {
    const [[shopRow]] = await pool.query(
        `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
        [session.shop]
    );
    return shopRow?.id ?? null;
}

/**
 * Generates a human-readable warranty plan label from the configured duration.
 */
function buildPlanName(durationMonths) {
    const years = durationMonths / 12;
    if (durationMonths % 12 === 0 && years >= 1) {
        return `+${years} Year`;
    }
    return `+${durationMonths} Months`;
}

/**
 * Converts whole-month durations into a whole-year value for plan storage.
 */
function monthsToYears(durationMonths) {
    return durationMonths % 12 === 0 ? durationMonths / 12 : 0;
}

/**
 * Shapes a Shopify variant node for the admin UI and attaches any configured
 * warranty plans that belong to that variant.
 */
function formatVariantNode(variantNode, plansByVariantId = {}) {
    const variantNumericId = getNumericIdFromGid(variantNode.id);
    const selectedOptions = (variantNode.selectedOptions || []).map(opt => ({
        name: opt.name,
        value: opt.value,
    }));

    const variantName =
        variantNode.displayName ||
        variantNode.title

    return {
        id: variantNode.id,
        title: variantName,
        name: variantName,
        sku: variantNode.sku || "",
        price: variantNode.price ?? null,
        warrantyPlans: plansByVariantId[variantNumericId] || [],
    };
}

const PRODUCTS_WITH_VARIANTS_QUERY = `
  query ExtendedWarrantyProducts($cursor: String, $query: String!, $first: Int!) {
    shop {
      currencyCode
    }
    productsCount(query: $query) {
      count
    }
    products(
      first: $first
      after: $cursor
      query: $query
    ) {
      edges {
        cursor
        node {
          id
          title
          status
          totalInventory
          productType
          tags
          variants(first: 100) {
            edges {
              node {
                id
                title
                displayName
                sku
                price
                compareAtPrice
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

const PRODUCTS_BY_IDS_QUERY = `
  query ExtendedWarrantyProductsByIds($ids: [ID!]!) {
    shop {
      currencyCode
    }
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        status
        totalInventory
        productType
        tags
        variants(first: 100) {
          edges {
            node {
              id
              title
              displayName
              sku
              price
              compareAtPrice
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Counts active plan durations for a product so the grid can show how much of
 * the warranty catalog is already configured.
 */
function countActivePlanDurationsForProduct(planRows, productNumericId) {
    const durations = new Set();
    for (const row of planRows) {
        if (row.status !== "active") continue;
        if (Number(row.shopify_product_id) !== Number(productNumericId)) continue;
        if (Number(row.price) <= 0) continue;
        durations.add(row.duration_months);
    }
    return durations.size;
}

/**
 * Shapes a Shopify product node for the admin eligible-product list.
 */
function shapeListedProduct(node, {
    overrideSet = new Set(),
    plansByVariantId = {},
    allPlanRows = [],
} = {}) {
    const productNumericId = getNumericIdFromGid(node.id);
    const variants = (node.variants?.edges || []).map(v =>
        formatVariantNode(v.node, plansByVariantId)
    );
    const isOverride = Boolean(
        productNumericId && overrideSet.has(Number(productNumericId))
    );

    return {
        id: node.id,
        title: node.title,
        status: node.status,
        inventory: node.totalInventory,
        category: node.productType,
        productType: node.productType || "",
        tags: Array.isArray(node.tags) ? node.tags : [],
        isOverride,
        eligibilitySource: isOverride && !isDefaultEligible(node) ? "override" : "default",
        variants,
        warrantyPlans: variants.flatMap(v => v.warrantyPlans),
        configuredPlanCount: countActivePlanDurationsForProduct(
            allPlanRows,
            productNumericId
        ),
    };
}

const PRODUCT_VARIANTS_QUERY = `
  query ExtendedWarrantyProductVariants($productId: ID!) {
    shop {
      currencyCode
    }
    product(id: $productId) {
      id
      title
      status
      productType
      tags
      variants(first: 100) {
        edges {
          node {
            id
            title
            displayName
            sku
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;

/**
 * Loads active extended-warranty plans for a shop, optionally scoped to one
 * product or variant when the UI needs a focused view.
 */
async function loadPlansForShop(shopId, { productId = null, variantId = null } = {}) {
    let sql = `
    SELECT
      id AS plan_id,
      shopify_product_id,
      shopify_variant_id,
      plan_name,
      duration_years,
      duration_months,
      price,
      currency,
      status
    FROM extended_warranty_plans
    WHERE shop_id = ?
      AND status = 'active'
  `;
    const params = [shopId];

    if (variantId) {
        sql += ` AND shopify_variant_id = ?`;
        params.push(variantId);
    } else if (productId) {
        sql += ` AND shopify_product_id = ?`;
        params.push(productId);
    }

    sql += ` ORDER BY shopify_variant_id, duration_months`;

    const [rows] = await pool.query(sql, params);
    return rows;
}

/**
 * Groups plan rows by Shopify variant id so the product and variant views can
 * render plan pricing next to the matching variant.
 */
function groupPlansByVariantId(
    planRows,
    warrantyPricingType,
    currency,
    variantPricingById = {}
) {
    const pricingType = normalizeWarrantyPricingType(warrantyPricingType);
    const map = {};
    for (const row of planRows) {
        if (row.status !== "active" || Number(row.price) <= 0) continue;

        const key = row.shopify_variant_id;
        if (!map[key]) map[key] = [];

        let displayPrice = formatConfiguredPlanPrice({
            configuredPrice: row.price,
            pricingType,
            currency: row.currency || currency,
        });

        const variantPricing = variantPricingById[key];
        if (pricingType === "percentage" && variantPricing) {
            try {
                const resolved = resolvePlanPrice({
                    configuredPrice: row.price,
                    pricingType,
                    variantPricing,
                });
                displayPrice = new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: row.currency || currency || "USD",
                }).format(resolved.calculatedPrice);
            } catch {
                // keep percentage label when variant pricing unavailable
            }
        }

        map[key].push({
            planId: row.plan_id,
            planName: row.plan_name,
            durationYears: row.duration_years,
            durationMonths: row.duration_months,
            pricingType,
            price: String(row.price),
            displayPrice,
            currency: row.currency,
            status: row.status,
        });
    }
    return map;
}

/* =====================================================
   CONFIGURATION – EXTENDED WARRANTY DURATIONS
   ===================================================== */

/**
 * Returns the configured extended-warranty durations for the admin settings UI.
 */
export async function getEWDurations(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const [rows] = await pool.query(
            `
      SELECT id, duration_months, duration_years, plan_name, merchandising_badge
      FROM extended_warranty_durations
      WHERE shop_id = ?
      ORDER BY duration_months
      `,
            [shopId]
        );

        return res.json(
            rows.map(r => ({
                id: r.id,
                durationMonths: r.duration_months,
                durationYears: r.duration_years,
                planName: r.plan_name,
                merchandisingBadge: r.merchandising_badge || "",
            }))
        );
    } catch (err) {
        console.error("❌ getEWDurations error:", err);
        return res.status(500).json({ error: "Failed to load durations" });
    }
}

/**
 * Adds a new extended-warranty duration option for the current shop.
 */
export async function addEWDuration(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { months, planName } = req.body;
        const durationMonths = Number(months);

        if (!durationMonths || durationMonths <= 0) {
            return res.status(400).json({ error: "Invalid duration" });
        }

        if (durationMonths % 12 !== 0) {
            return res.status(400).json({
                error: "Duration must be in multiples of 12 months (e.g. 12, 24, 36)",
            });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const durationYears = monthsToYears(durationMonths);
        const name = planName?.trim() || buildPlanName(durationMonths);

        await pool.query(
            `
      INSERT IGNORE INTO extended_warranty_durations
        (shop_id, duration_months, duration_years, plan_name)
      VALUES (?, ?, ?, ?)
      `,
            [shopId, durationMonths, durationYears, name]
        );

        return res.json({ success: true });
    } catch (err) {
        console.error("❌ addEWDuration error:", err);
        return res.status(500).json({ error: "Failed to add duration" });
    }
}

/* =====================================================
   API 1 – GET WARRANTY PRODUCTS
   ===================================================== */

/**
 * Loads Shopify products and overlays existing warranty-plan configuration so
 * merchants can manage coverage from a single product list.
 */
export async function getWarrantyProducts(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const jumpLast = req.query.last === "1";
        const cursor = jumpLast ? null : req.query.cursor || null;
        const searchTerm = req.query.q || req.query.search || "";
        const statusFilter = req.query.status || "";
        const scope = String(req.query.scope || "eligible").toLowerCase();
        const pageSize = Math.min(
            50,
            Math.max(1, parseInt(req.query.limit, 10) || 25)
        );
        const overrideIds = await listEnabledOverrideProductIds(pool, shopId);
        const overrideSet = new Set(overrideIds.map(Number));
        const disabledProductIds = await loadDisabledProductOverrides(shopId);
        const disabledProductSet = new Set(disabledProductIds);

        const productQuery = buildEligibleProductsShopifyQuery({
            searchTerm,
            statusFilter,
            overrideProductIds: overrideIds,
        });
        const admin = new shopify.api.clients.Graphql({ session });
        // const overrideIds = await loadProductOverrides(shopId);

        let response;
        if (jumpLast) {
            const countResponse = await admin.request(
                `
        query ProductCount($query: String!) {
          productsCount(query: $query) { count }
        }
        `,
                { variables: { query: productQuery } }
            );
            const totalCount = countResponse.data?.productsCount?.count ?? 0;
            const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
            let walkCursor = null;
            for (let i = 0; i < totalPages; i += 1) {
                response = await admin.request(PRODUCTS_WITH_VARIANTS_QUERY, {
                    variables: { cursor: walkCursor, query: productQuery, first: pageSize },
                });
                const walkEdges = response.data?.products?.edges || [];
                if (!response.data?.products?.pageInfo?.hasNextPage) break;
                walkCursor = walkEdges.length ? walkEdges[walkEdges.length - 1].cursor : null;
            }
        } else {
            response = await admin.request(PRODUCTS_WITH_VARIANTS_QUERY, {
                variables: { cursor, query: productQuery, first: pageSize },
            });
        }

        const edges = response.data?.products?.edges || [];
        // Load EW settings early so we can apply any admin-configured product-type
        // whitelist when filtering the product list.
        const ewSettings = await getExtendedWarrantySettings(shopId);
        const allowedTypesRaw = Array.isArray(ewSettings.allowed_product_types)
            ? ewSettings.allowed_product_types
            : [];
        const allowedSlugSet = new Set(
            allowedTypesRaw.map((t) => slugifyProductType(t)).filter(Boolean)
        );

        // Compute eligibleEdges depending on scope. For "excluded" we return
        // products that are not effectively eligible; otherwise use the
        // effective-eligibility / whitelist logic.
        let eligibleEdges;
        if (String(scope || "").toLowerCase() === "excluded") {
            eligibleEdges = edges.filter((edge) => {
                if (searchTerm && !productMatchesSearchTerm(edge.node, searchTerm)) {
                    return false;
                }
                return isExcludedFromDefaultList(edge.node, overrideIds);
            });
        } else {
            eligibleEdges = edges.filter((edge) => {
                if (searchTerm && !productMatchesSearchTerm(edge.node, searchTerm)) {
                    return false;
                }
                const productNode = edge.node;
                const numericId = getNumericIdFromGid(productNode.id);
                const isOverride = numericId && overrideSet.has(Number(numericId));
                if (allowedSlugSet.size) {
                    const nodeSlug = slugifyProductType(productNode.productType || "");
                    return isOverride || allowedSlugSet.has(nodeSlug);
                }
                return isEffectivelyEligible(edge.node, overrideIds);
            });
        }

        const warrantyPricingType =
            ewSettings.warranty_pricing_type || DEFAULT_WARRANTY_PRICING_TYPE;

        const filteredEdges = edges.filter((edge) => {
            if (searchTerm && !productMatchesSearchTerm(edge.node, searchTerm)) {
                return false;
            }

            const productNode = edge.node;
            const numericId = getNumericIdFromGid(productNode.id);

            if (disabledProductSet.has(Number(numericId))) {
                return false;
            }

            const isOverride =
                numericId && overrideSet.has(Number(numericId));

            if (allowedSlugSet.size) {
                const nodeSlug = slugifyProductType(productNode.productType || "");
                return isOverride || allowedSlugSet.has(nodeSlug);
            }

            return isEffectivelyEligible(edge.node, overrideIds);
        });

        const requestedPage = Math.max(1, parseInt(req.query.page, 10) || 1);
        if (
            !cursor &&
            !jumpLast &&
            requestedPage === 1 &&
            !searchTerm &&
            overrideIds.length
        ) {
            const presentIds = new Set(
                filteredEdges.map((edge) => getNumericIdFromGid(edge.node.id))
            );
            const missingOverrideIds = overrideIds.filter(
                (id) => !presentIds.has(Number(id))
            );
            if (missingOverrideIds.length) {
                const nodesResponse = await admin.request(PRODUCTS_BY_IDS_QUERY, {
                    variables: {
                        ids: missingOverrideIds
                            .slice(0, 50)
                            .map((id) => `gid://shopify/Product/${id}`),
                    },
                });
                for (const node of nodesResponse.data?.nodes || []) {
                    if (!node?.id) continue;
                    filteredEdges.unshift({ cursor: null, node });
                }
            }
        }

        const currency = response.data?.shop?.currencyCode || "USD";
        const totalCount = searchTerm
            ? eligibleEdges.length
            : response.data?.productsCount?.count ?? eligibleEdges.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const currentPage = jumpLast
            ? totalPages
            : Math.max(1, parseInt(req.query.page, 10) || 1);

        // Use the same products that will actually be returned to the UI.
        // This is important for manually-added override products because they
        // may be injected into filteredEdges even when they were not present
        // in the original eligibleEdges collection.
        /**
 * Load warranty plans for the exact products returned to the UI.
 *
 * Important:
 * Override products can be injected into filteredEdges after the
 * Shopify query. Therefore we must use filteredEdges here instead
 * of eligibleEdges, otherwise their saved pricing will not be loaded.
 */
const productNumericIds = [
    ...new Set(
        filteredEdges
            .map((edge) => getNumericIdFromGid(edge.node.id))
            .filter(Boolean)
    ),
];

let plansByVariantId = {};
let allPlanRows = [];

if (scope !== "excluded" && productNumericIds.length > 0) {
    const placeholders = productNumericIds.map(() => "?").join(",");

    const [planRows] = await pool.query(
        `
        SELECT
            id AS plan_id,
            shopify_product_id,
            shopify_variant_id,
            plan_name,
            duration_years,
            duration_months,
            price,
            currency,
            status
        FROM extended_warranty_plans
        WHERE shop_id = ?
          AND shopify_product_id IN (${placeholders})
          AND status = 'active'
          AND price > 0
        ORDER BY shopify_product_id, shopify_variant_id, duration_months
        `,
        [shopId, ...productNumericIds]
    );

    allPlanRows = planRows;

    const variantPricingById = {};

    for (const edge of filteredEdges) {
        for (const variantEdge of edge.node.variants?.edges || []) {
            const variantNumericId = getNumericIdFromGid(
                variantEdge.node.id
            );

            if (!variantNumericId) continue;

            variantPricingById[variantNumericId] = {
                compareAtPrice:
                    variantEdge.node.compareAtPrice != null
                        ? Number(variantEdge.node.compareAtPrice)
                        : null,

                variantPrice:
                    variantEdge.node.price != null
                        ? Number(variantEdge.node.price)
                        : null,
            };
        }
    }

    plansByVariantId = groupPlansByVariantId(
        planRows,
        warrantyPricingType,
        currency,
        variantPricingById
    );
}

        const products = filteredEdges.map(edge =>
            shapeListedProduct(edge.node, {
                overrideSet,
                plansByVariantId,
                allPlanRows,
            })
        );

        return res.json({
            success: true,
            currency,
            warrantyPricingType,
            products,
            nextCursor: eligibleEdges.length ? eligibleEdges[eligibleEdges.length - 1].cursor : null,
            hasNextPage: Boolean(response.data?.products?.pageInfo?.hasNextPage),
            pagination: {
                total: totalCount,
                totalPages,
                pageSize,
                page: currentPage,
                hasNextPage: jumpLast
                    ? false
                    : Boolean(response.data?.products?.pageInfo?.hasNextPage),
                hasPreviousPage: jumpLast ? totalPages > 1 : currentPage > 1,
            },
        });
    } catch (err) {
        console.error("❌ getWarrantyProducts error:", err);
        return res.status(500).json({ error: "Failed to load warranty products" });
    }
}

/* =====================================================
   API 2 – GET PRODUCT VARIANTS
   ===================================================== */

/**
 * Loads a single product's variants and existing plan mappings for editing.
 */
export async function getProductVariants(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const { productId } = req.params;
        if (!productId) {
            return res.status(400).json({ error: "Product ID is required" });
        }

        const productGid = productId.startsWith("gid://")
            ? productId
            : `gid://shopify/Product/${productId}`;

        const productNumericId = getNumericIdFromGid(productGid);
        if (!productNumericId) {
            return res.status(400).json({ error: "Invalid product ID" });
        }

        const admin = new shopify.api.clients.Graphql({ session });
        const response = await admin.request(PRODUCT_VARIANTS_QUERY, {
            variables: { productId: productGid },
        });

        const product = response.data?.product;
        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }

        const planRows = await loadPlansForShop(shopId, {
            productId: productNumericId,
        });
        const ewSettings = await getExtendedWarrantySettings(shopId);
        const warrantyPricingType =
            ewSettings.warranty_pricing_type || DEFAULT_WARRANTY_PRICING_TYPE;
        const currency = response.data?.shop?.currencyCode || "USD";
        const variantPricingById = {};
        for (const variantEdge of product.variants?.edges || []) {
            const variantNumericId = getNumericIdFromGid(variantEdge.node.id);
            if (!variantNumericId) continue;
            variantPricingById[variantNumericId] = {
                compareAtPrice:
                    variantEdge.node.compareAtPrice != null
                        ? Number(variantEdge.node.compareAtPrice)
                        : null,
                variantPrice:
                    variantEdge.node.price != null
                        ? Number(variantEdge.node.price)
                        : null,
            };
        }
        const plansByVariantId = groupPlansByVariantId(
            planRows,
            warrantyPricingType,
            currency,
            variantPricingById
        );

        const variants = (product.variants?.edges || []).map(v =>
            formatVariantNode(v.node, plansByVariantId)
        );

        return res.json({
            success: true,
            productId: product.id,
            productTitle: product.title,
            status: product.status,
            currency,
            warrantyPricingType,
            variants: variants.map(v => ({
                variantId: v.id,
                variantName: v.name,
                title: v.title,
                sku: v.sku,
                price: v.price,
                selectedOptions: v.selectedOptions,
                warrantyPlans: v.warrantyPlans,
            })),
        });
    } catch (err) {
        console.error("❌ getProductVariants error:", err);
        return res.status(500).json({ error: "Failed to load product variants" });
    }
}

/* =====================================================
   API 3 – GET WARRANTY PLANS FOR VARIANT
   ===================================================== */

/**
 * Returns the warranty plans configured for a product or variant.
 */
export async function getWarrantyPlans(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const { variantId } = req.params;
        if (!variantId) {
            return res.status(400).json({ error: "Variant ID is required" });
        }

        const variantNumericId = getNumericIdFromGid(
            variantId.startsWith("gid://")
                ? variantId
                : `gid://shopify/ProductVariant/${variantId}`
        );

        if (!variantNumericId) {
            return res.status(400).json({ error: "Invalid variant ID" });
        }

        const planRows = await loadPlansForShop(shopId, {
            variantId: variantNumericId,
        });

        const ewSettings = await getExtendedWarrantySettings(shopId);
        const warrantyPricingType =
            ewSettings.warranty_pricing_type || DEFAULT_WARRANTY_PRICING_TYPE;

        return res.json({
            success: true,
            variantId,
            warrantyPricingType,
            plans: planRows.map(row => ({
                planId: row.plan_id,
                planName: row.plan_name,
                durationYears: row.duration_years,
                durationMonths: row.duration_months,
                pricingType: warrantyPricingType,
                price: String(row.price),
                displayPrice: formatConfiguredPlanPrice({
                    configuredPrice: row.price,
                    pricingType: warrantyPricingType,
                    currency: row.currency,
                }),
                currency: row.currency,
                status: row.status,
            })),
        });
    } catch (err) {
        console.error("❌ getWarrantyPlans error:", err);
        return res.status(500).json({ error: "Failed to load warranty plans" });
    }
}

/* =====================================================
   API 4 – SAVE WARRANTY PLAN MAPPING
   ===================================================== */

async function applyProductPlanMappings(
    connection,
    shopId,
    productId,
    mappings,
    shopCurrency,
    warrantyPricingType = DEFAULT_WARRANTY_PRICING_TYPE,
    actor = null
) {
    const pricingType = normalizeWarrantyPricingType(warrantyPricingType);

    const productGid = productId.startsWith("gid://")
        ? productId
        : `gid://shopify/Product/${productId}`;

    const productNumericId = getNumericIdFromGid(productGid);

    if (!productNumericId) {
        throw new Error("Invalid productId");
    }

    let savedPlans = 0;

    for (const mapping of mappings) {
        const {
            variantId,
            durationMonths,
            planName,
            price,
            currency,
            status = "active",
        } = mapping;

        const variantGid = variantId?.startsWith("gid://")
            ? variantId
            : `gid://shopify/ProductVariant/${variantId}`;

        const variantNumericId = getNumericIdFromGid(variantGid);
        const months = Number(durationMonths);
        const planPrice = Number(price);

        if (!variantNumericId) {
            throw new Error("Invalid variantId in mapping");
        }

        if (!months || months <= 0) {
            throw new Error("Invalid durationMonths in mapping");
        }

        const priceValidation = validateConfiguredPlanPrice(
            planPrice,
            pricingType
        );

        if (!priceValidation.valid) {
            throw new Error(priceValidation.error);
        }

        const normalizedStatus =
            status === "inactive" ? "inactive" : "active";

        const years = monthsToYears(months);
        const name = planName?.trim() || buildPlanName(months);
        const planCurrency = currency?.trim() || shopCurrency;

        // Zero means remove pricing, not save a plan.
        if (planPrice === 0 && normalizedStatus === "active") {
            try {
                await removeWarrantyPricingRecords(connection, {
                    shopId,
                    productId: productNumericId,
                    variantId: variantNumericId,
                    durationMonths: months,
                    actor,
                    scope: PRICING_DELETE_SCOPE.VARIANT_DURATION,
                });
            } catch (err) {
                if (err.statusCode !== 404) {
                    throw err;
                }
            }

            continue;
        }

        await connection.query(
            `
            INSERT INTO extended_warranty_plans (
                shop_id,
                shopify_product_id,
                shopify_variant_id,
                plan_name,
                duration_years,
                duration_months,
                price,
                currency,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                plan_name = VALUES(plan_name),
                duration_years = VALUES(duration_years),
                price = VALUES(price),
                currency = VALUES(currency),
                status = VALUES(status),
                updated_at = CURRENT_TIMESTAMP
            `,
            [
                shopId,
                productNumericId,
                variantNumericId,
                name,
                years,
                months,
                planPrice,
                planCurrency,
                normalizedStatus,
            ]
        );

        savedPlans += 1;
    }

    return savedPlans;
}

export async function bulkSaveWarrantyPlanMapping(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const { products } = req.body;
        if (!Array.isArray(products) || !products.length) {
            return res.status(400).json({ error: "products array is required" });
        }

        const admin = new shopify.api.clients.Graphql({ session });
        const shopResponse = await admin.request(`query { shop { currencyCode } }`);
        const shopCurrency = shopResponse.data?.shop?.currencyCode || "USD";
        const ewSettings = await getExtendedWarrantySettings(shopId);
        const warrantyPricingType =
            ewSettings.warranty_pricing_type || DEFAULT_WARRANTY_PRICING_TYPE;
        const actor = getAdminActor(session);

        const connection = await pool.getConnection();
        const errors = [];
        let saved = 0;

        try {
            await connection.beginTransaction();

            for (const item of products) {
                try {
                    if (!item?.productId || !Array.isArray(item.mappings)) {
                        throw new Error("Each product requires productId and mappings");
                    }
                    if (!item.mappings.length) continue;
                    const savedPlans = await applyProductPlanMappings(
                        connection,
                        shopId,
                        item.productId,
                        item.mappings,
                        shopCurrency,
                        warrantyPricingType,
                        actor
                    );

                    if (savedPlans > 0) {
                        saved += 1;
                    }
                } catch (itemErr) {
                    errors.push({
                        productId: item.productId,
                        message: itemErr.message,
                    });
                }
            }

            if (errors.length && saved === 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    saved: 0,
                    errors,
                });
            }

            await connection.commit();
            return res.json({
                success: errors.length === 0,
                saved,
                errors,
            });
        } catch (txErr) {
            await connection.rollback();
            console.error("❌ bulkSaveWarrantyPlanMapping error:", txErr);
            return res.status(400).json({
                error: txErr.message || "Bulk save failed",
            });
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error("❌ bulkSaveWarrantyPlanMapping error:", err);
        return res.status(500).json({ error: "Failed to bulk save pricing" });
    }
}

/**
 * Saves warranty plan mappings for a single product in one transaction so the
 * UI can update a product without needing a bulk operation.
 */
export async function saveWarrantyPlanMapping(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const { productId, mappings } = req.body;

        if (!productId) {
            return res.status(400).json({ error: "productId is required" });
        }

        if (!Array.isArray(mappings)) {
            return res.status(400).json({ error: "mappings array is required" });
        }

        if (mappings.length === 0) {
            return res.json({ success: true });
        }

        const productGid = productId.startsWith("gid://")
            ? productId
            : `gid://shopify/Product/${productId}`;
        const productNumericId = getNumericIdFromGid(productGid);

        if (!productNumericId) {
            return res.status(400).json({ error: "Invalid productId" });
        }

        const admin = new shopify.api.clients.Graphql({ session });
        const shopResponse = await admin.request(`query { shop { currencyCode } }`);
        const shopCurrency = shopResponse.data?.shop?.currencyCode || "USD";
        const ewSettings = await getExtendedWarrantySettings(shopId);
        const warrantyPricingType =
            ewSettings.warranty_pricing_type || DEFAULT_WARRANTY_PRICING_TYPE;
        const actor = getAdminActor(session);

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await applyProductPlanMappings(
                connection,
                shopId,
                productId,
                mappings,
                shopCurrency,
                warrantyPricingType,
                actor
            );
            await connection.commit();
            return res.json({ success: true });
        } catch (txErr) {
            await connection.rollback();
            console.error("❌ saveWarrantyPlanMapping transaction error:", txErr);
            return res.status(400).json({
                error: txErr.message || "Failed to save warranty plan mapping",
            });
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error("❌ saveWarrantyPlanMapping error:", err);
        return res.status(500).json({ error: "Failed to save warranty plan mapping" });
    }
}

/* =====================================================
   STORE SETTINGS (terms, coverage, branding)
   ===================================================== */

export async function updateEWDuration(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const durationId = Number(req.params.id);
        if (!durationId) {
            return res.status(400).json({ error: "Invalid duration id" });
        }

        const { merchandisingBadge = "" } = req.body;
        const badge = String(merchandisingBadge || "").trim();

        if (badge && !MERCHANDISING_BADGE_LABELS[badge]) {
            return res.status(400).json({ error: "Invalid merchandising badge" });
        }

        const [result] = await pool.query(
            `
      UPDATE extended_warranty_durations
      SET merchandising_badge = ?
      WHERE shop_id = ? AND id = ?
      `,
            [badge || null, shopId, durationId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Duration not found" });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("❌ updateEWDuration error:", err);
        return res.status(500).json({ error: "Failed to update duration" });
    }
}

/**
 * Normalizes the settings row for the frontend so it can consume a stable
 * shape regardless of whether a settings record already exists.
 */
function mapSettingsRow(row, expiryReminderConfigs = []) {
    if (!row) {
        return {
            termsUrl: "",
            coverageText: "",
            extendedWarrantyPurchaseDays: null,
            warrantyPricingType: DEFAULT_WARRANTY_PRICING_TYPE,
            extendedWarrantyOfferEnabled: true,
            expiryReminderConfigs: [],
        };
    }

    return {
        termsUrl: row.terms_url || "",
        coverageText: row.coverage_text || "",
        extendedWarrantyPurchaseDays: row.extended_warranty_purchase_days ?? null,
        warrantyPricingType: normalizeWarrantyPricingType(row.warranty_pricing_type),
        extendedWarrantyOfferEnabled: parseExtendedWarrantyOfferEnabled(
            row?.extended_warranty_offer_enabled,
            true
        ),
        expiryReminderConfigs,
        allowedProductTypes: row?.allowed_product_types ? JSON.parse(row.allowed_product_types) : [],
    };
}

/**
 * Loads the shop-level extended-warranty settings and reminder configuration.
 */
export async function getEWSettings(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const [[row]] = await pool.query(
            `SELECT * FROM extended_warranty_settings WHERE shop_id = ?`,
            [shopId]
        );
        const expiryReminderConfigs = await buildExpiryReminderAdminConfigs(shopId);

        return res.json({
            success: true,
            settings: mapSettingsRow(row, expiryReminderConfigs),
        });
    } catch (err) {
        console.error("❌ getEWSettings error:", err);
        return res.status(500).json({ error: "Failed to load settings" });
    }
}

/**
 * Fetch distinct product types from the store's Shopify catalog (paginated).
 */
// export async function getShopProductTypes(req, res) {
//         try {
//                 const session = res.locals.shopify.session;
//                 if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

//                 const client = new shopify.api.clients.Graphql({ session });
//                 const PRODUCT_TYPES_QUERY = `
//                     query FetchProductTypes($cursor: String, $first: Int!) {
//                         products(first: $first, after: $cursor) {
//                             edges {
//                                 cursor
//                                 node { productType }
//                             }
//                             pageInfo { hasNextPage }
//                         }
//                     }
//                 `;

//                     let cursor = null;
//                     let hasNext = true;
//                     const map = new Map(); // slug -> Set(rawValues)

//                     while (hasNext) {
//                         const response = await client.request(PRODUCT_TYPES_QUERY, {
//                             cursor,
//                             first: 250,
//                         });
//                         const edges = (response?.products?.edges) || [];
//                             for (const e of edges) {
//                                 const pt = e?.node?.productType;
//                                 if (!pt) continue;
//                                 const slug = slugifyProductType(pt);
//                             if (!slug) continue;
//                             if (!map.has(slug)) map.set(slug, new Set());
//                             map.get(slug).add(String(pt).trim());
//                         }
//                         hasNext = Boolean(response?.products?.pageInfo?.hasNextPage);
//                         cursor = edges.length ? edges[edges.length - 1].cursor : null;
//                     }

//                     const productTypes = Array.from(map.entries()).map(([slug, rawSet]) => ({
//                         slug,
//                         raw: Array.from(rawSet)[0] || slug,
//                     })).sort((a, b) => a.raw.localeCompare(b.raw));

//                     return res.json({ success: true, productTypes });
//         } catch (err) {
//                 console.error("❌ getShopProductTypes error:", err);
//                 return res.status(500).json({ error: "Failed to fetch product types" });
//         }
// }

/**
 * Persists the shop-level extended-warranty settings and reminder-day rules.
 */
export async function saveEWSettings(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const {
            termsUrl = "",
            coverageText = "",
            extendedWarrantyPurchaseDays = null,
            warrantyPricingType = DEFAULT_WARRANTY_PRICING_TYPE,
            expiryReminderConfigs = [],
            allowedProductTypes = [],
        } = req.body;

        // Normalize and dedupe allowed product types as raw strings trimmed
        const normalizedAllowed = Array.isArray(allowedProductTypes)
            ? Array.from(
                  new Set(
                      allowedProductTypes
                          .map((v) => (v == null ? "" : String(v).trim()))
                          .filter(Boolean)
                  )
              )
            : [];
        const extendedWarrantyOfferEnabled = parseExtendedWarrantyOfferEnabled(
            req.body.extendedWarrantyOfferEnabled,
            true
        );

        const purchaseDays =
            extendedWarrantyPurchaseDays == null || extendedWarrantyPurchaseDays === ""
                ? null
                : Number(extendedWarrantyPurchaseDays);

        if (
            purchaseDays != null &&
            (!Number.isInteger(purchaseDays) || purchaseDays < 1 || purchaseDays > 3650)
        ) {
            return res.status(400).json({
                error: "Extended Warranty Purchase Days must be a whole number between 1 and 3650",
            });
        }

        const normalizedPricingType = normalizeWarrantyPricingType(warrantyPricingType);

        let normalizedTermsUrl = null;
        if (termsUrl != null && String(termsUrl).trim()) {
            try {
                normalizedTermsUrl = normalizeTermsUrl(termsUrl, session.shop);
            } catch (termsErr) {
                return res.status(400).json({ error: termsErr.message });
            }
        }

        await pool.query(
            `
      INSERT INTO extended_warranty_settings (
        shop_id,
        terms_url,
        coverage_text,
        extended_warranty_purchase_days,
                warranty_pricing_type,
                extended_warranty_offer_enabled,
                allowed_product_types
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        terms_url = VALUES(terms_url),
        coverage_text = VALUES(coverage_text),
        extended_warranty_purchase_days = VALUES(extended_warranty_purchase_days),
                warranty_pricing_type = VALUES(warranty_pricing_type),
                extended_warranty_offer_enabled = VALUES(extended_warranty_offer_enabled),
                allowed_product_types = VALUES(allowed_product_types),
                updated_at = CURRENT_TIMESTAMP
      `,
            [
                shopId,
                normalizedTermsUrl,
                coverageText || null,
                purchaseDays,
                                normalizedPricingType,
                                extendedWarrantyOfferEnabled ? 1 : 0,
                                normalizedAllowed.length ? JSON.stringify(normalizedAllowed) : null,
            ]
        );

        try {
            await saveExpiryReminderConfigs(shopId, expiryReminderConfigs);
        } catch (configErr) {
            return res.status(400).json({ error: configErr.message });
        }

        const [[savedRow]] = await pool.query(
            `SELECT * FROM extended_warranty_settings WHERE shop_id = ?`,
            [shopId]
        );
        const expiryReminderConfigsSaved = await buildExpiryReminderAdminConfigs(shopId);

        return res.json({
            success: true,
            settings: mapSettingsRow(savedRow, expiryReminderConfigsSaved),
        });
    } catch (err) {
        console.error("❌ saveEWSettings error:", err);
        return res.status(500).json({ error: "Failed to save settings" });
    }
}

/**
 * Deletes an extended-warranty duration and removes any dependent plan rows.
 */
export async function deleteEWDuration(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const durationId = Number(req.params.id);
        if (!durationId) {
            return res.status(400).json({ error: "Invalid duration id" });
        }

        const [[durationRow]] = await pool.query(
            `SELECT duration_months FROM extended_warranty_durations WHERE shop_id = ? AND id = ?`,
            [shopId, durationId]
        );

        if (!durationRow) {
            return res.status(404).json({ error: "Duration not found" });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [planRows] = await conn.query(
                `SELECT id FROM extended_warranty_plans WHERE shop_id = ? AND duration_months = ?`,
                [shopId, durationRow.duration_months]
            );
            const actor = getAdminActor(session);
            for (const planRow of planRows) {
                try {
                    await removeWarrantyPricingRecords(conn, {
                        shopId,
                        planId: planRow.id,
                        actor,
                        scope: PRICING_DELETE_SCOPE.PLAN,
                    });
                } catch (planErr) {
                    if (planErr.statusCode !== 404) throw planErr;
                }
            }
            const [result] = await conn.query(
                `DELETE FROM extended_warranty_durations WHERE shop_id = ? AND id = ?`,
                [shopId, durationId]
            );
            if (result.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ error: "Duration not found" });
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("❌ deleteEWDuration error:", err);
        return res.status(500).json({ error: "Failed to delete duration" });
    }
}

/**
 * Deletes a single extended-warranty plan for the current shop.
 */
export async function deleteEWPlan(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const planId = Number(req.params.id);
        if (!planId) {
            return res.status(400).json({ error: "Invalid plan id" });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const result = await removeWarrantyPricingRecords(connection, {
                shopId,
                planId,
                actor: getAdminActor(session),
                scope: PRICING_DELETE_SCOPE.PLAN,
            });
            await connection.commit();
            return res.json({ success: true, ...result });
        } catch (err) {
            await connection.rollback();
            if (err.statusCode === 404) {
                return res.status(404).json({ error: "Plan not found" });
            }
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error("❌ deleteEWPlan error:", err);
        return res.status(500).json({ error: "Failed to delete plan" });
    }
}

/**
 * Deletes ALL extended-warranty pricing for one product.
 *
 * This removes every pricing mapping belonging to the product:
 * - all variants
 * - all warranty durations
 *
 * The delete is always scoped by shop_id so one merchant
 * cannot affect another merchant's pricing.
 */
export async function deleteEWProductPricing(req, res) {
    try {
        const session = res.locals.shopify.session;

        if (!session?.shop) {
            return res.status(401).json({
                error: "Unauthorized",
            });
        }

        const shopId = await resolveShopId(session);

        if (!shopId) {
            return res.status(404).json({
                error: "Shop not registered",
            });
        }

        const { productId } = req.params;

        if (!productId) {
            return res.status(400).json({
                error: "Product ID is required",
            });
        }

        const productGid = productId.startsWith("gid://")
            ? productId
            : `gid://shopify/Product/${productId}`;

        const productNumericId = getNumericIdFromGid(productGid);

        if (!productNumericId) {
            return res.status(400).json({
                error: "Invalid product ID",
            });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const result = await removeWarrantyPricingRecords(connection, {
                shopId,
                productId: productNumericId,
                actor: getAdminActor(session),
                scope: PRICING_DELETE_SCOPE.PRODUCT,
            });
            await connection.commit();
            return res.json({
                success: true,
                removed: result.removed,
                deleted: result.deleted,
                deactivated: result.deactivated,
            });
        } catch (err) {
            await connection.rollback();
            if (err.statusCode === 404) {
                return res.status(404).json({
                    error: "Pricing record not found",
                });
            }
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error(
            "❌ deleteEWProductPricing error:",
            err
        );

        return res.status(500).json({
            error: "Failed to remove product pricing",
        });
    }
}

/**
 * Deletes all extended-warranty pricing for one variant of a product.
 */
export async function deleteEWVariantPricing(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const { variantId } = req.params;
        if (!variantId) {
            return res.status(400).json({ error: "Variant ID is required" });
        }

        const variantGid = variantId.startsWith("gid://")
            ? variantId
            : `gid://shopify/ProductVariant/${variantId}`;
        const variantNumericId = getNumericIdFromGid(variantGid);
        if (!variantNumericId) {
            return res.status(400).json({ error: "Invalid variant ID" });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const result = await removeWarrantyPricingRecords(connection, {
                shopId,
                variantId: variantNumericId,
                actor: getAdminActor(session),
                scope: PRICING_DELETE_SCOPE.VARIANT,
            });
            await connection.commit();
            return res.json({
                success: true,
                removed: result.removed,
                deleted: result.deleted,
                deactivated: result.deactivated,
            });
        } catch (err) {
            await connection.rollback();
            if (err.statusCode === 404) {
                return res.status(404).json({ error: "Pricing record not found" });
            }
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error("❌ deleteEWVariantPricing error:", err);
        return res.status(500).json({ error: "Failed to remove variant pricing" });
    }
}

const EXCLUDED_SEARCH_MAX_PAGES = 40;

/**
 * Searches Shopify products that are excluded from the default eligible list
 * so an admin can explicitly add them as overrides.
 */
export async function searchExcludedWarrantyProducts(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const cursor = req.query.cursor || null;
        const searchTerm = req.query.q || req.query.search || "";
        const statusFilter = req.query.status || "";
        const pageSize = Math.min(
            50,
            Math.max(1, parseInt(req.query.limit, 10) || 25)
        );
        const currentPage = Math.max(
            1,
            parseInt(req.query.page, 10) || 1
        );

        const overrideIds = await listEnabledOverrideProductIds(
            pool,
            shopId
        );

        // Load products that were manually removed/disabled.
        const disabledProductIds =
            await loadDisabledProductOverrides(shopId);

        const disabledProductSet =
            new Set(disabledProductIds);

        const productQuery = buildExcludedProductsShopifyQuery({
            searchTerm,
            statusFilter,
        });
        const admin = new shopify.api.clients.Graphql({ session });

        const collected = [];
        let walkCursor = cursor;
        let hasNextPage = true;
        let response = null;
        let pagesWalked = 0;

        while (
            collected.length < pageSize &&
            hasNextPage &&
            pagesWalked < EXCLUDED_SEARCH_MAX_PAGES
        ) {
            response = await admin.request(PRODUCTS_WITH_VARIANTS_QUERY, {
                variables: {
                    cursor: walkCursor,
                    query: productQuery,
                    first: pageSize,
                },
            });
            const edges = response.data?.products?.edges || [];
            hasNextPage = Boolean(response.data?.products?.pageInfo?.hasNextPage);
            walkCursor = edges.length ? edges[edges.length - 1].cursor : null;
            pagesWalked += 1;

            for (const edge of edges) {
                const node = edge.node;
                if (searchTerm && !productMatchesSearchTerm(node, searchTerm)) {
                    continue;
                }
                const numericId = getNumericIdFromGid(node.id);

                const isManuallyExcluded =
                    disabledProductSet.has(Number(numericId));

                if (
                    !isManuallyExcluded &&
                    !isExcludedFromDefaultList(node, overrideIds)
                ) {
                    continue;
                }
                collected.push(edge);
                if (collected.length >= pageSize) break;
            }
        }

        const products = collected.map(edge => ({
            id: edge.node.id,
            title: edge.node.title,
            status: edge.node.status,
            inventory: edge.node.totalInventory,
            category: edge.node.productType,
            productType: edge.node.productType || "",
            tags: Array.isArray(edge.node.tags) ? edge.node.tags : [],
            isOverride: false,
            variantCount: (edge.node.variants?.edges || []).length,
        }));

        return res.json({
            success: true,
            currency: response?.data?.shop?.currencyCode || "USD",
            products,
            nextCursor: walkCursor,
            hasNextPage,
            pagination: {
                pageSize,
                page: currentPage,
                hasNextPage,
                hasPreviousPage: currentPage > 1,
            },
        });
    } catch (err) {
        console.error("❌ searchExcludedWarrantyProducts error:", err);
        return res.status(500).json({ error: "Failed to search excluded products" });
    }
}

/**
 * Adds shop-scoped overrides so excluded products appear in the eligible list.
 */
export async function addWarrantyProductOverrides(req, res) {
    try {
        const session = res.locals.shopify.session;
        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);
        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const rawIds = req.body?.productIds;
        if (!Array.isArray(rawIds) || !rawIds.length) {
            return res.status(400).json({ error: "productIds array is required" });
        }
        if (rawIds.length > 50) {
            return res.status(400).json({
                error: "A maximum of 50 products can be added at once",
            });
        }

        const gids = [...new Set(
            rawIds
                .map(id => {
                    const numericId = getNumericIdFromGid(id);
                    return numericId ? `gid://shopify/Product/${numericId}` : null;
                })
                .filter(Boolean)
        )];

        if (!gids.length) {
            return res.status(400).json({ error: "No valid product IDs provided" });
        }

        const admin = new shopify.api.clients.Graphql({ session });
        const response = await admin.request(PRODUCTS_BY_IDS_QUERY, {
            variables: { ids: gids },
        });
        const nodes = (response.data?.nodes || []).filter(node => node?.id);
        const foundById = new Map(
            nodes.map(node => [getNumericIdFromGid(node.id), node])
        );
        const overrideIds = await listEnabledOverrideProductIds(pool, shopId);

        const disabledProductIds =
            await loadDisabledProductOverrides(shopId);

        const disabledProductSet =
            new Set(disabledProductIds);

        const actor = getAdminActor(session);
        const added = [];
        const skipped = [];

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            for (const gid of gids) {
                const numericId = getNumericIdFromGid(gid);
                const product = foundById.get(numericId) || null;

                const wasManuallyExcluded =
                    disabledProductSet.has(Number(numericId));

                const skip = wasManuallyExcluded
                    ? null
                    : getOverrideSkipReason(product, overrideIds);
                if (skip) {
                    skipped.push({
                        productId: gid,
                        title: product?.title,
                        ...skip,
                    });
                    continue;
                }

                await upsertProductOverride(connection, shopId, numericId, actor);
                await writeAdminAudit(connection, {
                    shopId,
                    actionType: "product_override_add",
                    entityType: "extended_warranty_product_override",
                    entityId: numericId,
                    beforeValue: null,
                    afterValue: {
                        shopifyProductId: numericId,
                        title: product.title,
                        enabled: true,
                    },
                    actor,
                });
                added.push({ productId: gid, title: product.title });
                overrideIds.push(numericId);
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        const allAlreadyAdded =
            added.length === 0 &&
            skipped.length > 0 &&
            skipped.every(item => item.reason === "already_added");
        const allAlreadyEligible =
            added.length === 0 &&
            skipped.length > 0 &&
            skipped.every(item => item.reason === "already_eligible");

        if (allAlreadyEligible) {
            return res.status(409).json({
                success: false,
                error:
                    skipped.length === 1
                        ? "Product is already eligible by default"
                        : "Selected products are already eligible by default",
                added,
                skipped,
            });
        }

        return res.json({
            success: added.length > 0 || allAlreadyAdded,
            added,
            skipped,
        });
    } catch (err) {
        console.error("❌ addWarrantyProductOverrides error:", err);
        return res.status(500).json({ error: "Failed to add products" });
    }
}

/**
 * Removes a shop-scoped product override. Existing warranty pricing is kept.
 */
export async function removeWarrantyProductOverride(req, res) {
    try {
        const session = res.locals.shopify.session;

        if (!session?.shop) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const shopId = await resolveShopId(session);

        if (!shopId) {
            return res.status(404).json({ error: "Shop not registered" });
        }

        const { productId } = req.params;

        const numericId = getNumericIdFromGid(
            productId?.startsWith("gid://")
                ? productId
                : `gid://shopify/Product/${productId}`
        );

        if (!numericId) {
            return res.status(400).json({ error: "Invalid product ID" });
        }

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // Instead of deleting the override, explicitly exclude the product.
            await connection.query(
                `
                INSERT INTO extended_warranty_product_overrides (
                    shop_id,
                    shopify_product_id,
                    enabled
                )
                VALUES (?, ?, 0)
                ON DUPLICATE KEY UPDATE
                    enabled = 0,
                    updated_at = CURRENT_TIMESTAMP
                `,
                [shopId, numericId]
            );

            await writeAdminAudit(connection, {
                shopId,
                actionType: "product_override_remove",
                entityType: "extended_warranty_product_override",
                entityId: numericId,
                beforeValue: null,
                afterValue: {
                    shopifyProductId: numericId,
                    enabled: false,
                },
                actor: getAdminActor(session),
            });

            await connection.commit();

            return res.json({
                success: true,
                productId: numericId,
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error("❌ removeWarrantyProductOverride error:", err);

        return res.status(500).json({
            error: "Failed to remove product",
        });
    }
}
