import { pool } from "../db/mysql.js";

/**
 * Resolves the installed shop id for the current authenticated session so all
 * retailer changes stay scoped to the correct merchant.
 */
async function resolveShopId(session) {
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [session.shop]
  );
  return shopRow?.id || null;
}

/**
 * Loads the active retailer list for the admin UI with optional search and
 * pagination so merchants can manage their retailer directory.
 */
export async function getRetailers(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const searchTerm = String(req.query.q || req.query.search || "").trim();
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 25)
    );
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (pageNum - 1) * pageSize;
    const likeTerm = `%${searchTerm}%`;

    const whereClause = `
      shop_id = ?
      AND is_active = 1
      ${
        searchTerm
          ? `AND (
              retailer_name LIKE ?
              OR retailer_city LIKE ?
              OR retailer_name_ja LIKE ?
            )`
          : ""
      }
    `;
    const searchParams = searchTerm ? [likeTerm, likeTerm, likeTerm] : [];

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM retailers WHERE ${whereClause}`,
      [shopId, ...searchParams]
    );
    const total = countRow?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const [rows] = await pool.query(
      `
      SELECT
        id,
        retailer_name,
        retailer_city,
        retailer_name_ja
      FROM retailers
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
      [shopId, ...searchParams, pageSize, offset]
    );

    res.json({
      retailers: rows.map((r) => ({
        id: r.id,
        retailer_name: r.retailer_name,
        retailer_name_localized: r.retailer_name_ja,
        retailer_city: r.retailer_city,
      })),
      pagination: {
        total,
        totalPages,
        page: pageNum,
        pageSize,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1,
      },
    });
  } catch (e) {
    console.error("❌ getRetailers error:", e);
    res.status(500).json({ error: "Failed to load retailers" });
  }
}

/**
 * Imports a batch of retailer rows from the admin UI and reactivates existing
 * matches instead of creating duplicates.
 */
export async function importRetailers(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const { retailers } = req.body;
    if (!Array.isArray(retailers) || retailers.length === 0) {
      return res.status(400).json({ error: "Invalid or empty payload" });
    }

    const values = retailers
      .map((r) => {
        const name = String(r.name || "").trim();
        if (!name) return null;
        return [
          shopId,
          name,
          String(r.city || "").trim() || null,
          String(r.localized_name || r.name_ja || "").trim() || null,
        ];
      })
      .filter(Boolean);

    if (!values.length) {
      return res.status(400).json({ error: "No valid retailer rows to import" });
    }

    await pool.query(
      `
      INSERT INTO retailers
        (shop_id, retailer_name, retailer_city, retailer_name_ja)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        retailer_city = VALUES(retailer_city),
        retailer_name_ja = VALUES(retailer_name_ja),
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      `,
      [values]
    );

    res.json({ success: true, count: values.length });
  } catch (e) {
    console.error("❌ importRetailers error:", e);
    res.status(500).json({ error: "Import failed" });
  }
}

/**
 * Updates a single retailer record for the current shop.
 */
export async function updateRetailer(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

    const shopId = await resolveShopId(session);
    if (!shopId) return res.status(404).json({ error: "Shop not registered" });

    const retailerId = Number(req.params.id);
    if (!Number.isFinite(retailerId)) {
      return res.status(400).json({ error: "Invalid retailer id" });
    }

    const name = String(req.body?.name || req.body?.retailer_name || "").trim();
    if (!name) return res.status(400).json({ error: "Retailer name is required" });

    const country = String(req.body?.city || req.body?.retailer_city || "").trim();
    if (!country) return res.status(400).json({ error: "Country is required" });

    const localizedName =
      String(
        req.body?.localized_name ||
          req.body?.name_ja ||
          req.body?.retailer_name_localized ||
          req.body?.retailer_name_ja ||
          ""
      ).trim() || null;

    const [result] = await pool.query(
      `
      UPDATE retailers
      SET retailer_name = ?, retailer_city = ?, retailer_name_ja = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND shop_id = ? AND is_active = 1
      `,
      [name, city, localizedName, retailerId, shopId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Retailer not found" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("❌ updateRetailer error:", e);
    res.status(500).json({ error: "Failed to update retailer" });
  }
}

/**
 * Soft-deletes a retailer so it no longer appears in the admin list while
 * preserving historical references in older registrations.
 */
export async function deleteRetailer(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) return res.status(401).json({ error: "Unauthorized" });

    const shopId = await resolveShopId(session);
    if (!shopId) return res.status(404).json({ error: "Shop not registered" });

    const retailerId = Number(req.params.id);
    if (!Number.isFinite(retailerId)) {
      return res.status(400).json({ error: "Invalid retailer id" });
    }

    const [result] = await pool.query(
      `
      UPDATE retailers
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND shop_id = ? AND is_active = 1
      `,
      [retailerId, shopId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Retailer not found" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("❌ deleteRetailer error:", e);
    res.status(500).json({ error: "Failed to delete retailer" });
  }
}
