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

function getNumericIdFromGid(gid) {
    if (!gid) return null;
    const numeric = Number(gid.split("/").pop());
    return Number.isFinite(numeric) ? numeric : null;
}

async function resolveShopId(session) {
    const [[shopRow]] = await pool.query(
        `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
        [session.shop]
    );
    return shopRow?.id ?? null;
}

function buildPlanName(durationMonths) {
    const years = durationMonths / 12;
    if (durationMonths % 12 === 0 && years >= 1) {
        return `+${years} Year`;
    }
    return `+${durationMonths} Months`;
}

function monthsToYears(durationMonths) {
    return durationMonths % 12 === 0 ? durationMonths / 12 : 0;
}

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

    const term = String(searchTerm || "").trim();
    if (!term) return statusQuery;
    const sanitized = term.replace(/["\\]/g, " ").trim();
    return `(title:*${sanitized}* OR sku:*${sanitized}*) AND ${statusQuery}`;
}

function productMatchesSearchTerm(productNode, searchTerm) {
    const term = String(searchTerm || "").trim().toLowerCase();
    if (!term) return true;

    const title = String(productNode.title || "").toLowerCase();
    if (title.includes(term)) return true;

    const variants = productNode.variants?.edges || [];
    return variants.some(edge => {
        const variant = edge.node || {};
        const variantTitle = String(variant.displayName || variant.title || "").toLowerCase();
        const sku = String(variant.sku || "").toLowerCase();
        return variantTitle.includes(term) || sku.includes(term);
    });
}

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

const PRODUCT_VARIANTS_QUERY = `
  query ExtendedWarrantyProductVariants($productId: ID!) {
    shop {
      currencyCode
    }
    product(id: $productId) {
      id
      title
      status
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

/** Load extended warranty plans for a shop, optionally filtered by product or variant. */
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

/** Group plan rows by variant numeric ID. */
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
        const pageSize = Math.min(
            50,
            Math.max(1, parseInt(req.query.limit, 10) || 25)
        );
        const productQuery = buildShopifyProductSearchQuery(searchTerm, statusFilter);
        const admin = new shopify.api.clients.Graphql({ session });

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
        const filteredEdges = searchTerm
            ? edges.filter(edge => productMatchesSearchTerm(edge.node, searchTerm))
            : edges;
        const currency = response.data?.shop?.currencyCode || "USD";
        const ewSettings = await getExtendedWarrantySettings(shopId);
        const warrantyPricingType =
            ewSettings.warranty_pricing_type || DEFAULT_WARRANTY_PRICING_TYPE;
        const totalCount = searchTerm
            ? filteredEdges.length
            : response.data?.productsCount?.count ?? filteredEdges.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const currentPage = jumpLast
            ? totalPages
            : Math.max(1, parseInt(req.query.page, 10) || 1);

        const productNumericIds = filteredEdges
            .map(e => getNumericIdFromGid(e.node.id))
            .filter(Boolean);

        let plansByVariantId = {};
        let allPlanRows = [];
        if (productNumericIds.length > 0) {
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
        ORDER BY duration_months
        `,
                [shopId, ...productNumericIds]
            );
            allPlanRows = planRows;

            const variantPricingById = {};
            for (const edge of filteredEdges) {
                for (const variantEdge of edge.node.variants?.edges || []) {
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
            }

            plansByVariantId = groupPlansByVariantId(
                planRows,
                warrantyPricingType,
                currency,
                variantPricingById
            );
        }

        const products = filteredEdges.map(edge => {
            const node = edge.node;
            const productNumericId = getNumericIdFromGid(node.id);
            const variants = (node.variants?.edges || []).map(v =>
                formatVariantNode(v.node, plansByVariantId)
            );

            return {
                id: node.id,
                title: node.title,
                status: node.status,
                inventory: node.totalInventory,
                category: node.productType,
                variants,
                warrantyPlans: variants.flatMap(v => v.warrantyPlans),
                configuredPlanCount: countActivePlanDurationsForProduct(
                    allPlanRows,
                    productNumericId
                ),
            };
        });

        return res.json({
            success: true,
            currency,
            warrantyPricingType,
            products,
            nextCursor: filteredEdges.length ? filteredEdges[filteredEdges.length - 1].cursor : null,
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
    warrantyPricingType = DEFAULT_WARRANTY_PRICING_TYPE
) {
    const pricingType = normalizeWarrantyPricingType(warrantyPricingType);
    const productGid = productId.startsWith("gid://")
        ? productId
        : `gid://shopify/Product/${productId}`;
    const productNumericId = getNumericIdFromGid(productGid);

    if (!productNumericId) {
        throw new Error("Invalid productId");
    }

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

        const priceValidation = validateConfiguredPlanPrice(planPrice, pricingType);
        if (!priceValidation.valid) {
            throw new Error(priceValidation.error);
        }

        const normalizedStatus = status === "inactive" ? "inactive" : "active";
        const years = monthsToYears(months);
        const name = planName?.trim() || buildPlanName(months);
        const planCurrency = currency?.trim() || shopCurrency;

        if (planPrice === 0 && normalizedStatus === "active") {
            await connection.query(
                `
        DELETE FROM extended_warranty_plans
        WHERE shop_id = ?
          AND shopify_variant_id = ?
          AND duration_months = ?
        `,
                [shopId, variantNumericId, months]
            );
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    }
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
                    await applyProductPlanMappings(
                        connection,
                        shopId,
                        item.productId,
                        item.mappings,
                        shopCurrency,
                        warrantyPricingType
                    );
                    saved += 1;
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

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await applyProductPlanMappings(
                connection,
                shopId,
                productId,
                mappings,
                shopCurrency,
                warrantyPricingType
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
    };
}

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
        } = req.body;
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
        extended_warranty_offer_enabled
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        terms_url = VALUES(terms_url),
        coverage_text = VALUES(coverage_text),
        extended_warranty_purchase_days = VALUES(extended_warranty_purchase_days),
        warranty_pricing_type = VALUES(warranty_pricing_type),
        extended_warranty_offer_enabled = VALUES(extended_warranty_offer_enabled),
        updated_at = CURRENT_TIMESTAMP
      `,
            [
                shopId,
                normalizedTermsUrl,
                coverageText || null,
                purchaseDays,
                normalizedPricingType,
                extendedWarrantyOfferEnabled ? 1 : 0,
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
            await conn.query(
                `DELETE FROM extended_warranty_plans WHERE shop_id = ? AND duration_months = ?`,
                [shopId, durationRow.duration_months]
            );
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

        const [result] = await pool.query(
            `DELETE FROM extended_warranty_plans WHERE shop_id = ? AND id = ?`,
            [shopId, planId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Plan not found" });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("❌ deleteEWPlan error:", err);
        return res.status(500).json({ error: "Failed to delete plan" });
    }
}
