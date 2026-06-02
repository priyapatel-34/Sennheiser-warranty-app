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

export async function getSWDurations(req, res) {
    try {
      const session = res.locals.shopify.session;
  
      if (!session || !session.shop) {
        return res.status(401).json({ error: "Unauthorized" });
      }
  
      const shopDomain = session.shop; // string
  
      // 1️⃣ Get shop_id from shops table
      const [[shopRow]] = await pool.query(
        `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
        [shopDomain]
      );
  
      if (!shopRow) {
        return res.status(404).json({ error: "Shop not registered" });
      }
  
      const shopId = shopRow.id;
  
      // 2️⃣ Fetch durations
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
      //return res.json(rows.map(r => r.months * 12));
  
    } catch (err) {
      console.error("❌ getSWDurations error:", err);
      return res.status(500).json([]);
    }
}

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
  
      // 1️⃣ Get shop_id
      const [[shopRow]] = await pool.query(
        `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
        [shopDomain]
      );
  
      if (!shopRow) {
        return res.status(404).json({ error: "Shop not registered" });
      }
  
      const shopId = shopRow.id;
  
      // 2️⃣ Insert duration
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

export async function getAllProducts(req, res) {
  try {
    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop;
    const cursor = req.query.cursor || null;

    // 1️⃣ Get shop_id
    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain]
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    // 2️⃣ Shopify GraphQL client
    const admin = new shopify.api.clients.Graphql({ session });

    // 3️⃣ GraphQL request (NEW API)
    const response = await admin.request(
      `
      query ($cursor: String) {
        products(first: 25, after: $cursor) {
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
      `,
      { variables: { cursor } }
    );


    

    const edges = response.data.products.edges;

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
      nextCursor: edges.length
        ? edges[edges.length - 1].cursor
        : null,
      hasNextPage: response.data.products.pageInfo.hasNextPage,
    });

  } catch (err) {
    console.error("❌ getWarrantyProducts error:", err);
    return res.status(500).json({ error: "Failed to load products" });
  }
}

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


function getNumericProductId(gid) {
  if (!gid) return null;
  return Number(gid.split("/").pop());
}

