import { pool } from "../db/mysql.js";

export async function saveStoreSettings(req, res) {
  const session = res.locals.shopify.session;

  if (!session || !session.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const shopDomain = session.shop; 
  const { retailer_required } = req.body;

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
    INSERT INTO store_settings (shop_id, retailer_required)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      retailer_required = VALUES(retailer_required)
    `,
    [shopId, retailer_required]
  );

  res.json({ success: true });
}


export async function getStoreSettings(req, res) {
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

  const [[row]] = await pool.query(
    "SELECT retailer_required FROM store_settings WHERE shop_id = ?",
    [shopId]
  );

  res.json(row || { retailer_required: 1 });
}
