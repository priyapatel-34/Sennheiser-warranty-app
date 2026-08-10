import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";


/*export async function getSWDurations(req, res) {
  
    try {
      
        const session = res.locals.shopify.session;

        console.log("saveStoreSettings `111", session);
    
        if (!session || !session.shop) {
        return res.status(401).json({ error: "Unauthorized" });
        }
    
        const shop = session.shop; // ✅ CORRECT

      const [rows] = await pool.query(
        `SELECT months FROM standard_warranty_durations WHERE shop_id = ? ORDER BY months`,
        [shop.id]
      );
    
      res.json(rows.map(r => r.months));
  
  
    } catch (err) {
      console.error("❌ Retailer autocomplete error:", err);
      return res.status(500).json([]);
    }
}

export async function addSWuration(req, res) {

    const session = res.locals.shopify.session;

    console.log("saveStoreSettings `111", session);
  
    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  
    const shop = session.shop; // ✅ CORRECT

    const { months } = req.body;

    if (!months || months <= 0) {
        return res.status(400).json({ error: "Invalid duration" });
    }

    await pool.query(
        `
        INSERT IGNORE INTO standard_warranty_durations (shop_id, months)
        VALUES (?, ?)
        `,
        [shop, months]
    );

    res.json({ success: true });
}*/

/**
 * Returns the configured standard-warranty duration list for the current shop.
 */
export async function getSWDurations(req, res) {
  try {
    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop;

    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain]
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const shopId = shopRow.id;

    const [rows] = await pool.query(
      `
        SELECT months
        FROM standard_warranty_durations
        WHERE shop_id = ?
        ORDER BY months
        `,
      [shopId]
    );

    return res.json(rows.map(r => r.months));

  } catch (err) {
    console.error("❌ getSWDurations error:", err);
    return res.status(500).json([]);
  }
}

/**
 * Adds a new standard-warranty duration option for the current shop.
 */
export async function addSWuration(req, res) {
  try {
    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop;
    const { months } = req.body;

    if (!months || months <= 0) {
      return res.status(400).json({ error: "Invalid duration" });
    }

    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain]
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const shopId = shopRow.id;

    await pool.query(
      `
        INSERT IGNORE INTO standard_warranty_durations (shop_id, months)
        VALUES (?, ?)
        `,
      [shopId, months]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ addSWuration error:", err);
    return res.status(500).json({ error: "Failed to add duration" });
  }
}

/**
 * Builds the Shopify product search query used to power the standard warranty
 * product selection list.
 */
function buildShopifyProductSearchQuery(searchTerm, statusFilter = "all") {
  let statusClause;
  switch (String(statusFilter || "all").toLowerCase()) {
    case "active":
      statusClause = "status:active";
      break;
    case "draft":
      statusClause = "status:draft";
      break;
    default:
      statusClause = "(status:active OR status:draft)";
  }

  const term = String(searchTerm || "").trim();
  if (!term) return statusClause;
  const sanitized = term.replace(/["\\]/g, " ").trim();
  return `${sanitized} AND ${statusClause}`;
}

const STANDARD_PRODUCTS_QUERY = `
  query StandardWarrantyProducts($cursor: String, $query: String!, $first: Int!) {
    productsCount(query: $query) {
      count
    }
    products(first: $first, after: $cursor, query: $query) {
      edges {
        cursor
        node {
          id
          title
          status
          totalInventory
          productType
          metafield(
            namespace: "warranty"
            key: "standard_duration"
          ) {
            value
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`;

/**
 * Loads Shopify products and their standard warranty metadata for the admin
 * product-assignment screen.
 */
export async function getAllProducts(req, res) {
  try {
    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop;
    const jumpLast = req.query.last === "1";
    const cursor = jumpLast ? null : req.query.cursor || null;
    const searchTerm = req.query.q || req.query.search || "";
    const statusParam = String(req.query.status || "all").toLowerCase();
    const statusFilter = ["all", "active", "draft"].includes(statusParam)
      ? statusParam
      : "all";
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 25)
    );
    const productQuery = buildShopifyProductSearchQuery(searchTerm, statusFilter);

    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain]
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

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
        response = await admin.request(STANDARD_PRODUCTS_QUERY, {
          variables: { cursor: walkCursor, query: productQuery, first: pageSize },
        });
        const walkEdges = response.data?.products?.edges || [];
        if (!response.data?.products?.pageInfo?.hasNextPage) break;
        walkCursor = walkEdges.length ? walkEdges[walkEdges.length - 1].cursor : null;
      }
    } else {
      response = await admin.request(STANDARD_PRODUCTS_QUERY, {
        variables: { cursor, query: productQuery, first: pageSize },
      });
    }

    const edges = response.data?.products?.edges || [];
    const totalCount = response.data?.productsCount?.count ?? edges.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const currentPage = jumpLast
      ? totalPages
      : Math.max(1, parseInt(req.query.page, 10) || 1);

    return res.json({
      products: edges.map(edge => ({
        id: edge.node.id,
        title: edge.node.title,
        status: edge.node.status,
        inventory: edge.node.totalInventory,
        category: edge.node.productType,
        duration: edge.node.metafield
          ? Number(edge.node.metafield.value)
          : null,
      })),
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
    console.error("❌ getAllProducts error:", err);
    return res.status(500).json({ error: "Failed to load products" });
  }
}

/**
 * Applies one standard-warranty duration to many products and mirrors the
 * assignment in both Shopify metafields and the local database.
 */
export async function bulkUpdateWarranty(req, res) {
  try {
    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop;
    const { productIds, duration } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "No products selected" });
    }

    if (duration === null || duration === undefined || duration < 0) {
      return res.status(400).json({ error: "Invalid duration" });
    }

    // 1️⃣ Get shop_id
    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain]
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const shopId = shopRow.id;

    // 2️⃣ Shopify GraphQL client
    const admin = new shopify.api.clients.Graphql({ session });

    // 3️⃣ Loop products
    for (const productGid of productIds) {

      const productId = getNumericProductId(productGid);

      if (!productId) continue;

      // 🔹 Save metafield (NEW API)
      await admin.request(`
        mutation {
          metafieldsSet(
            metafields: [{
              ownerId: "${productGid}"
              namespace: "warranty"
              key: "standard_duration"
              type: "number_integer"
              value: "${duration}"
            }]
          ) {
            userErrors { message }
          }
        }
      `);

      // 🔹 Save DB
      await pool.query(
        `
        INSERT INTO product_standard_warranty_durations
          (shop_id, product_id, duration_months)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          duration_months = VALUES(duration_months)
        `,
        [shopId, productId, duration]
      );
    }

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ bulkUpdateWarranty error:", err);
    return res.status(500).json({ error: "Failed to update warranty" });
  }
}


/**
 * Normalizes a Shopify product GID into its numeric id for database writes.
 */
function getNumericProductId(gid) {
  if (!gid) return null;
  return Number(gid.split("/").pop());
}

