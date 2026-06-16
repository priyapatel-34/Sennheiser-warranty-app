import { pool } from "../db/mysql.js";

/* ---------------------------
   GET RETAILERS (ADMIN LOAD)
---------------------------- */
export async function getRetailers(req, res) {

    console.log("🚨 retailers.controller.js LOADED");


  try {

    const session = res.locals.shopify.session;

    console.log("retailers.controller.js 11 11",res.locals);
    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop; // ✅ CORRECT


    console.log("🚨 retailers.controller.js LOADED 111",shopDomain);

    if (!shopDomain) {
      return res.status(400).json({ error: "Shop context missing" });
    }

    console.log("🚨 retailers.controller.js LOADED 222");

    // 1️⃣ Get shop_id
    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain]
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const shopId = shopRow.id;

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
      ORDER BY retailer_name ASC
      LIMIT ? OFFSET ?
      `,
      [shopId, ...searchParams, pageSize, offset]
    );

    res.json({
      retailers: rows.map(r => [
        r.retailer_name,
        r.retailer_name_ja,
        r.retailer_city,
      ]),
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

/* ---------------------------
   IMPORT RETAILERS (EXCEL)
---------------------------- */
export async function importRetailers(req, res) {

    console.log("Import Retailer controller 111");
  try {
   // console.log("Import Retailer controller 222");

    const session = res.locals.shopify.session;

    if (!session || !session.shop) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const shopDomain = session.shop; // ✅ CORRECT
    const { retailers } = req.body;

   // console.log("Import Retailer controller 333", shop, retailers);

    if (!shopDomain) {
      return res.status(400).json({ error: "Shop context missing" });
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

    if (!Array.isArray(retailers) || retailers.length === 0) {
      return res.status(400).json({ error: "Invalid or empty payload" });
    }

    console.log("Import Retailer controller 444");


    /**
     * Expected Excel → JSON mapping:
     * {
     *   name: string,
     *   code?: string,
     *   type?: 'online' | 'offline' | 'both',
     *   city?: string
     * }
     */
    const values = retailers.map(r => [
      shopId,
      r.name?.trim(),
      r.city?.trim() || null,
      r.name_ja?.trim()  || null
    ]);

    console.log("Import Retailer controller 555", values);


    await pool.query(
      `
      INSERT INTO retailers
        (shop_id, retailer_name, retailer_city,retailer_name_ja)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        retailer_city = VALUES(retailer_city),
        retailer_name_ja = VALUES(retailer_name_ja),
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      `,
      [values]
    );

    console.log("Import Retailer controller 666");

    res.json({ success: true, count: values.length });
  } catch (e) {
    console.error("❌ importRetailers error:", e);
    res.status(500).json({ error: "Import failed" });
  }
}
