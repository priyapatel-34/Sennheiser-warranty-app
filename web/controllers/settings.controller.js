import { pool } from "../db/mysql.js";

async function resolveShopId(session) {
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [session.shop]
  );
  return shopRow?.id ?? null;
}

/**
 * Saves store settings. Accepts a partial body so unrelated toggles are
 * never overwritten (e.g. posting only `retailer_required` leaves
 * `serial_verification_enabled` untouched, and vice versa).
 */
export async function saveStoreSettings(req, res) {
  const session = res.locals.shopify.session;

  if (!session || !session.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const shopId = await resolveShopId(session);
  if (!shopId) {
    return res.status(404).json({ error: "Shop not registered" });
  }

  const updates = {};
  if (req.body.retailer_required !== undefined) {
    updates.retailer_required = req.body.retailer_required ? 1 : 0;
  }
  if (req.body.serial_verification_enabled !== undefined) {
    updates.serial_verification_enabled = req.body.serial_verification_enabled
      ? 1
      : 0;
  }

  const columns = Object.keys(updates);
  if (!columns.length) {
    return res.status(400).json({ error: "No settings provided" });
  }

  const insertColumns = ["shop_id", ...columns];
  const placeholders = insertColumns.map(() => "?").join(", ");
  const updateClause = columns.map((c) => `${c} = VALUES(${c})`).join(", ");

  await pool.query(
    `
    INSERT INTO store_settings (${insertColumns.join(", ")})
    VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE
      ${updateClause}
    `,
    [shopId, ...columns.map((c) => updates[c])]
  );

  res.json({ success: true });
}

export async function getStoreSettings(req, res) {
  const session = res.locals.shopify.session;

  if (!session || !session.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const shopId = await resolveShopId(session);
  if (!shopId) {
    return res.status(404).json({ error: "Shop not registered" });
  }

  const [[row]] = await pool.query(
    "SELECT retailer_required FROM store_settings WHERE shop_id = ?",
    [shopId]
  );

  res.json(row || { retailer_required: 1 });
}

/** Serial number verification toggle (defaults to OFF/0 for new stores). */
export async function getSerialVerificationSetting(req, res) {
  const session = res.locals.shopify.session;

  if (!session || !session.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const shopId = await resolveShopId(session);
  if (!shopId) {
    return res.status(404).json({ error: "Shop not registered" });
  }

  const [[row]] = await pool.query(
    "SELECT serial_verification_enabled FROM store_settings WHERE shop_id = ?",
    [shopId]
  );

  res.json({
    serial_verification_enabled: row ? Number(row.serial_verification_enabled) : 0,
  });
}
