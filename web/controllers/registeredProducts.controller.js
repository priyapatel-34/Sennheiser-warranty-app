import { pool } from "../db/mysql.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const SORT_COLUMNS = {
  created_at: "rp.created_at",
  product_name: "rp.product_name",
  customer_name: "rp.customer_name",
  serial_number: "rp.serial_number",
  warranty_end: "rp.warranty_end",
};

async function resolveShopId(session) {
  const [[shopRow]] = await pool.query(
    `
    SELECT id
    FROM shops
    WHERE shop_domain = ?
      AND is_installed = TRUE
    `,
    [session.shop]
  );
  return shopRow?.id ?? null;
}

function buildSearchQuery(shopId, query) {
  const {
    q = "",
    customerName = "",
    email = "",
    serial = "",
    productName = "",
    sku = "",
    registrationId = "",
    warrantyType = "",
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
    sort = "created_at",
    order = "desc",
  } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || DEFAULT_PAGE);
  const pageSize = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT)
  );
  const offset = (pageNum - 1) * pageSize;
  const sortColumn = SORT_COLUMNS[sort] || SORT_COLUMNS.created_at;
  const sortOrder = String(order).toLowerCase() === "asc" ? "ASC" : "DESC";

  const conditions = ["rp.shop_id = ?"];
  const params = [shopId];

  const addLike = (column, value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    conditions.push(`${column} LIKE ?`);
    params.push(`%${trimmed}%`);
  };

  const global = String(q || "").trim();
  if (global) {
    conditions.push(`(
      rp.customer_name LIKE ?
      OR rp.customer_email LIKE ?
      OR rp.serial_number LIKE ?
      OR rp.product_name LIKE ?
      OR rp.sku LIKE ?
      OR CAST(rp.id AS CHAR) LIKE ?
    )`);
    const pattern = `%${global}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  addLike("rp.customer_name", customerName);
  addLike("rp.customer_email", email);
  addLike("rp.serial_number", serial);
  addLike("rp.product_name", productName);
  addLike("rp.sku", sku);

  const regId = String(registrationId || "").trim();
  if (regId && /^\d+$/.test(regId)) {
    conditions.push("rp.id = ?");
    params.push(Number(regId));
  }

  const wt = String(warrantyType || "").trim().toLowerCase();
  if (wt === "standard") {
    conditions.push(`(
      ew.status IS NULL
      OR ew.status IN ('cancelled', 'refunded', 'expired')
    )`);
  } else if (wt === "extended") {
    conditions.push("ew.status IN ('active', 'pending_payment')");
  } else if (wt === "extended_active") {
    conditions.push("ew.status = 'active'");
  } else if (wt === "extended_pending") {
    conditions.push("ew.status = 'pending_payment'");
  }

  const pt = String(query.purchaseType || query.purchase_type || "")
    .trim()
    .toLowerCase();
  if (pt === "shopify" || pt === "external") {
    conditions.push("rp.purchase_type = ?");
    params.push(pt);
  }

  const whereClause = conditions.join(" AND ");

  const baseFrom = `
    FROM registered_products rp
    LEFT JOIN extended_warranty_entitlements ew ON ew.id = (
      SELECT e2.id
      FROM extended_warranty_entitlements e2
      WHERE e2.shop_id = rp.shop_id
        AND e2.registered_product_id = rp.id
      ORDER BY FIELD(e2.status, 'active', 'pending_payment'), e2.created_at DESC
      LIMIT 1
    )
  `;

  return {
    pageNum,
    pageSize,
    offset,
    sortColumn,
    sortOrder,
    whereClause,
    params,
    baseFrom,
  };
}

export async function registeredProducts(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "No shop provided" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const built = buildSearchQuery(shopId, req.query);

    const [[countRow]] = await pool.query(
      `
      SELECT COUNT(*) AS total
      ${built.baseFrom}
      WHERE ${built.whereClause}
      `,
      built.params
    );

    const [rows] = await pool.query(
      `
      SELECT
        rp.id,
        rp.shop_id,
        rp.customer_id,
        rp.customer_email,
        rp.customer_name,
        rp.purchase_type,
        rp.shopify_order_id,
        rp.shopify_line_item_id,
        rp.shopify_product_id,
        rp.sku,
        rp.product_name,
        rp.serial_number,
        rp.retailer_name,
        rp.purchase_date,
        rp.warranty_start,
        rp.warranty_end,
        rp.consent_terms,
        rp.consent_marketing,
        rp.created_at,
        rp.updated_at,
        ew.status AS extended_warranty_status,
        ew.plan_name AS extended_warranty_plan,
        ew.activation_date AS extended_warranty_start,
        ew.expiry_date AS extended_warranty_end
      ${built.baseFrom}
      WHERE ${built.whereClause}
      ORDER BY ${built.sortColumn} ${built.sortOrder}
      LIMIT ? OFFSET ?
      `,
      [...built.params, built.pageSize, built.offset]
    );

    const total = Number(countRow.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / built.pageSize));

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: built.pageNum,
        limit: built.pageSize,
        total,
        totalPages,
        hasNextPage: built.pageNum < totalPages,
        hasPreviousPage: built.pageNum > 1,
      },
    });
  } catch (err) {
    console.error("❌ registeredProducts error:", err);
    return res.status(500).json({ error: "Failed to fetch registered products" });
  }
}

export async function deleteRegisteredProduct(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ success: false, error: "No shop provided" });
    }

    const { id } = req.params;
    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ success: false, error: "Shop not registered" });
    }

    const [[product]] = await pool.query(
      `SELECT id FROM registered_products WHERE id = ? AND shop_id = ?`,
      [id, shopId]
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Registered product not found",
      });
    }

    await pool.query(
      `DELETE FROM registered_products WHERE id = ? AND shop_id = ?`,
      [id, shopId]
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
