import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
 
export async function registeredProducts(req, res) {
  console.log("🔥 HIT /app/registered-products");
  console.log("Query:", req.query);
  console.log("Headers host:", req.headers.host);
  console.log("res.locals:", res.locals);
  try {
    const session = res.locals.shopify.session;

    console.log(res.locals);

    console.log(session);
 
    if (!session || !session.shop) {
      return res.status(401).json({ error: "No shop provided" });
    }
 
    const shopDomain = session.shop;
    const [[shopRow]] = await pool.query(
      `
      SELECT id 
      FROM shops 
      WHERE shop_domain = ? 
        AND is_installed = TRUE
      `,
      [shopDomain]
    );
 
    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }
 
    const shopId = shopRow.id;

    const [rows] = await pool.query(
      `
      SELECT
        id,
        shop_id,
        customer_id,
        customer_email,
        customer_name,
        purchase_type,
        shopify_order_id,
        shopify_line_item_id,
        shopify_product_id,
        sku,
        product_name,
        serial_number,
        retailer_name,
        purchase_date,
        warranty_start,
        warranty_end,
        consent_terms,
        consent_marketing,
        created_at,
        updated_at
      FROM registered_products
      WHERE shop_id = ?
      ORDER BY created_at DESC
      `,
      [shopId]
    );
 
    return res.json({
      success: true,
      data: rows,
    });
 
  } catch (err) {
    console.error("❌ registeredProducts error:", err);
    return res.status(500).json({ error: "Failed to fetch registered products" });
  }
}

export async function deleteRegisteredProduct(req, res) {
  console.log("🔥 HIT DELETE /app/registered-products/:id");

  try {
    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({
        success: false,
        error: "No shop provided",
      });
    }

    const { id } = req.params;

    const shopDomain = session.shop;

    const [[shopRow]] = await pool.query(
      `
      SELECT id
      FROM shops
      WHERE shop_domain = ?
        AND is_installed = TRUE
      `,
      [shopDomain],
    );

    if (!shopRow) {
      return res.status(404).json({
        success: false,
        error: "Shop not registered",
      });
    }

    const shopId = shopRow.id;

    // Verify product belongs to this shop
    const [[product]] = await pool.query(
      `
      SELECT id
      FROM registered_products
      WHERE id = ?
        AND shop_id = ?
      `,
      [id, shopId],
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Registered product not found",
      });
    }

    await pool.query(
      `
      DELETE FROM registered_products
      WHERE id = ?
        AND shop_id = ?
      `,
      [id, shopId],
    );

    return res.status(200).json({
      success: true,
      message: "Registered product deleted successfully",
    });
  } catch (err) {
    console.error("❌ deleteRegisteredProduct error:", err);

    return res.status(500).json({
      success: false,
      error: "Failed to delete registered product",
    });
  }
}