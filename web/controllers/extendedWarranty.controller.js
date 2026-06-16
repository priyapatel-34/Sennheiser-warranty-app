import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import {
  DEFAULT_COVERAGE_SUMMARY,
  DEFAULT_COVERAGE_POINTS,
} from "../constants/defaultCoverageTemplates.js";

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

function buildShopifyProductSearchQuery(searchTerm) {
  const statusFilter = "(status:active OR status:draft)";
  const term = String(searchTerm || "").trim();
  if (!term) return statusFilter;
  const sanitized = term.replace(/["\\]/g, " ").trim();
  return `${sanitized} AND ${statusFilter}`;
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
function groupPlansByVariantId(planRows) {
  const map = {};
  for (const row of planRows) {
    const key = row.shopify_variant_id;
    if (!map[key]) map[key] = [];
    map[key].push({
      planId: row.plan_id,
      planName: row.plan_name,
      durationYears: row.duration_years,
      durationMonths: row.duration_months,
      price: String(row.price),
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
      SELECT id, duration_months, duration_years, plan_name
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
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 25)
    );
    const productQuery = buildShopifyProductSearchQuery(searchTerm);
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
    const currency = response.data?.shop?.currencyCode || "USD";
    const totalCount = response.data?.productsCount?.count ?? edges.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const currentPage = jumpLast
      ? totalPages
      : Math.max(1, parseInt(req.query.page, 10) || 1);

    const productNumericIds = edges
      .map(e => getNumericIdFromGid(e.node.id))
      .filter(Boolean);

    let plansByVariantId = {};
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
        ORDER BY duration_months
        `,
        [shopId, ...productNumericIds]
      );
      plansByVariantId = groupPlansByVariantId(planRows);
    }

    const products = edges.map(edge => {
      const node = edge.node;
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
      };
    });

    return res.json({
      success: true,
      currency,
      products,
      nextCursor: edges.length ? edges[edges.length - 1].cursor : null,
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
    const plansByVariantId = groupPlansByVariantId(planRows);
    const currency = response.data?.shop?.currencyCode || "USD";

    const variants = (product.variants?.edges || []).map(v =>
      formatVariantNode(v.node, plansByVariantId)
    );

    return res.json({
      success: true,
      productId: product.id,
      productTitle: product.title,
      status: product.status,
      currency,
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

    return res.json({
      success: true,
      variantId,
      plans: planRows.map(row => ({
        planId: row.plan_id,
        planName: row.plan_name,
        durationYears: row.duration_years,
        durationMonths: row.duration_months,
        price: String(row.price),
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

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

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
        if (!Number.isFinite(planPrice) || planPrice < 0) {
          throw new Error("Invalid price in mapping");
        }

        const normalizedStatus =
          status === "inactive" ? "inactive" : "active";
        const years = monthsToYears(months);
        const name = planName?.trim() || buildPlanName(months);
        const planCurrency = currency?.trim() || shopCurrency;

        if (planPrice === 0 && normalizedStatus === "active") {
          // Remove plan when price cleared (admin UI sends empty as 0)
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

    return res.json({
      success: true,
      settings: row || {
        enabled: 1,
        terms_url: "",
        coverage_text: "",
      },
      defaultCoverageSummary: DEFAULT_COVERAGE_SUMMARY,
      defaultCoveragePoints: DEFAULT_COVERAGE_POINTS,
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

    const { enabled = true, termsUrl = "", coverageText = "" } = req.body;

    await pool.query(
      `
      INSERT INTO extended_warranty_settings (
        shop_id, enabled, offer_after_registration, terms_url, coverage_text
      ) VALUES (?, ?, 1, ?, ?)
      ON DUPLICATE KEY UPDATE
        enabled = VALUES(enabled),
        terms_url = VALUES(terms_url),
        coverage_text = VALUES(coverage_text),
        updated_at = CURRENT_TIMESTAMP
      `,
      [shopId, enabled ? 1 : 0, termsUrl || null, coverageText || null]
    );

    return res.json({ success: true });
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

    const [result] = await pool.query(
      `DELETE FROM extended_warranty_durations WHERE shop_id = ? AND id = ?`,
      [shopId, durationId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Duration not found" });
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
