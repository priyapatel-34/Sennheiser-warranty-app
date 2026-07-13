import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { getEntitlementsForRegistrations } from "../services/extendedWarranty.service.js";
import {
  getLatestRefundForEntitlements,
  getCustomerFacingRefundStatus,
} from "../services/extendedWarrantyRefund.service.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SORT_COLUMNS = {
  created_at: "rp.created_at",
  product_name: "rp.product_name",
  customer_name: "rp.customer_name",
  serial_number: "rp.serial_number",
  warranty_end: "rp.warranty_end",
};

async function fetchShopifyOrderNames(client, orderIds) {
  const map = new Map();
  const uniqueIds = [
    ...new Set(
      orderIds
        .map(id => String(id || "").trim())
        .filter(Boolean)
    ),
  ];
  if (!uniqueIds.length) return map;

  const gids = uniqueIds.map(id => `gid://shopify/Order/${id}`);

  for (let offset = 0; offset < gids.length; offset += 50) {
    const chunk = gids.slice(offset, offset + 50);
    try {
      const result = await client.request(
        `
        query ($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id
              name
            }
          }
        }
        `,
        { variables: { ids: chunk } }
      );

      for (const node of result.data?.nodes || []) {
        if (!node?.id) continue;
        const numericId = node.id.split("/").pop();
        map.set(numericId, node.name);
      }
    } catch (err) {
      console.warn("⚠️ Batch order name fetch failed:", err.message);
    }
  }

  return map;
}

async function fetchShopifyVariantTitle(client, variantId) {
  const id = String(variantId || "").trim();
  if (!id) return null;

  try {
    const result = await client.request(
      `
      query ($id: ID!) {
        productVariant(id: $id) {
          title
        }
      }
      `,
      { variables: { id: `gid://shopify/ProductVariant/${id}` } }
    );
    const title = result?.data?.productVariant?.title;
    if (!title || title === "Default Title") return null;
    return title;
  } catch (err) {
    console.warn("⚠️ Variant title fetch failed:", err.message);
    return null;
  }
}

async function fetchShopifyCustomerPhone(client, customerId) {
  const id = String(customerId || "").trim();
  if (!id) return null;

  try {
    const result = await client.request(
      `
      query ($id: ID!) {
        customer(id: $id) {
          phone
        }
      }
      `,
      { variables: { id: `gid://shopify/Customer/${id}` } }
    );
    return result?.data?.customer?.phone || null;
  } catch (err) {
    console.warn("⚠️ Customer phone fetch failed:", err.message);
    return null;
  }
}

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  const str = String(value);
  return str.includes("T") ? str.split("T")[0] : str;
}

function resolveOrderNumber(row, orderNameMap) {
  if (!row.shopify_order_id) return null;
  return orderNameMap.get(String(row.shopify_order_id)) || null;
}

function formatWarrantyTypeLabel(row) {
  const status = row.extended_warranty_status;
  if (status === "active") return "Extended (Active)";
  if (status === "pending_payment" && row.extended_warranty_draft_order_id) {
    return "Extended (Pending)";
  }
  if (status === "refunded") return "Extended (Refunded)";
  if (status === "cancelled") return "Extended (Cancelled)";
  if (status === "expired") return "Extended (Expired)";
  return "Standard";
}

function formatPaymentStatus(entitlement) {
  if (!entitlement) return null;
  switch (entitlement.status) {
    case "pending_payment":
      return "Pending Payment";
    case "active":
      return "Paid";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return entitlement.status;
  }
}

function formatExtendedWarrantyStatus(entitlement) {
  if (!entitlement) return null;
  switch (entitlement.status) {
    case "active":
      return "Active";
    case "pending_payment":
      return "Pending Payment";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return entitlement.status;
  }
}

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

function buildSearchQuery(shopId, query, resolvedOrderIds = []) {
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
    const extraOrderClauses = resolvedOrderIds.length
      ? ` OR rp.shopify_order_id IN (${resolvedOrderIds.map(() => "?").join(",")})`
      : "";
    conditions.push(`(
      rp.customer_name LIKE ?
      OR rp.customer_email LIKE ?
      OR rp.serial_number LIKE ?
      OR rp.product_name LIKE ?
      OR rp.sku LIKE ?
      OR CAST(rp.id AS CHAR) LIKE ?
      OR rp.shopify_order_id LIKE ?${extraOrderClauses}
    )`);
    const pattern = `%${global}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    if (resolvedOrderIds.length) {
      params.push(...resolvedOrderIds);
    }
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
    conditions.push(`(
      ew.status = 'active'
      OR (ew.status = 'pending_payment' AND ew.shopify_draft_order_id IS NOT NULL)
    )`);
  } else if (wt === "extended_active") {
    conditions.push("ew.status = 'active'");
  } else if (wt === "extended_pending") {
    conditions.push(
      "ew.status = 'pending_payment' AND ew.shopify_draft_order_id IS NOT NULL"
    );
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
        AND (
          e2.status = 'active'
          OR (
            e2.status = 'pending_payment'
            AND e2.shopify_draft_order_id IS NOT NULL
          )
        )
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

    // If the search query looks like a Shopify order name (e.g. #1082), resolve
    // it to a numeric shopify_order_id so we can match the DB field exactly.
    const resolvedOrderIds = [];
    const rawQ = String(req.query.q || "").trim();
    if (/^#\S+$/.test(rawQ)) {
      try {
        const lookupClient = new shopify.api.clients.Graphql({ session });

        // Step 1: Shopify orders search API (fast path).
        try {
          const apiResult = await lookupClient.request(
            `query ($q: String!) {
              orders(first: 5, query: $q) {
                edges { node { id name } }
              }
            }`,
            { variables: { q: `name:${rawQ}` } }
          );
          for (const edge of apiResult?.data?.orders?.edges || []) {
            if (edge.node.name === rawQ) {
              const numericId = edge.node.id.split("/").pop();
              if (numericId && !resolvedOrderIds.includes(numericId)) {
                resolvedOrderIds.push(numericId);
              }
            }
          }
        } catch (apiErr) {
          console.warn("⚠️ orders() search failed, will try fallback:", apiErr.message);
        }

        // Step 2: Fallback — reverse-map stored shopify_order_ids via nodes query
        // (the nodes query is the same mechanism that renders order names in the table,
        //  so it is guaranteed to work when the table already shows names).
        if (!resolvedOrderIds.length) {
          const [dbRows] = await pool.query(
            `SELECT DISTINCT shopify_order_id
             FROM registered_products
             WHERE shop_id = ? AND shopify_order_id IS NOT NULL
             ORDER BY created_at DESC
             LIMIT 300`,
            [shopId]
          );
          const dbOrderIds = dbRows.map(r => String(r.shopify_order_id));
          if (dbOrderIds.length) {
            const nameMap = await fetchShopifyOrderNames(lookupClient, dbOrderIds);
            for (const [id, name] of nameMap.entries()) {
              if (name === rawQ && !resolvedOrderIds.includes(id)) {
                resolvedOrderIds.push(id);
              }
            }
          }
        }

        console.log(
          resolvedOrderIds.length
            ? `✅ Order name "${rawQ}" resolved to shopify_order_id(s): ${resolvedOrderIds.join(", ")}`
            : `ℹ️ No Shopify order found with name "${rawQ}"`
        );
      } catch (err) {
        console.warn("⚠️ Order name resolution error:", err.message);
      }
    }

    const built = buildSearchQuery(shopId, req.query, resolvedOrderIds);

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
        ew.shopify_draft_order_id AS extended_warranty_draft_order_id,
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

    const orderIds = rows
      .filter(row => row.shopify_order_id)
      .map(row => row.shopify_order_id);

    let orderNameMap = new Map();
    if (orderIds.length) {
      try {
        const client = new shopify.api.clients.Graphql({ session });
        orderNameMap = await fetchShopifyOrderNames(client, orderIds);
      } catch (err) {
        console.warn("⚠️ Order number enrichment skipped:", err.message);
      }
    }

    const data = rows.map(row => ({
      ...row,
      order_number: resolveOrderNumber(row, orderNameMap),
    }));

    const total = Number(countRow.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / built.pageSize));

    return res.json({
      success: true,
      data,
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

export async function getRegisteredProductDetail(req, res) {
  try {
    const session = res.locals.shopify.session;
    if (!session?.shop) {
      return res.status(401).json({ error: "No shop provided" });
    }

    const shopId = await resolveShopId(session);
    if (!shopId) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    const { id } = req.params;
    const [rows] = await pool.query(
      `
      SELECT
        rp.*,
        ew.id AS ew_id,
        ew.status AS extended_warranty_status,
        ew.shopify_draft_order_id AS extended_warranty_draft_order_id,
        ew.shopify_order_id AS extended_warranty_shopify_order_id,
        ew.plan_name AS extended_warranty_plan,
        ew.activation_date AS extended_warranty_start,
        ew.expiry_date AS extended_warranty_end
      FROM registered_products rp
      LEFT JOIN extended_warranty_entitlements ew ON ew.id = (
        SELECT e2.id
        FROM extended_warranty_entitlements e2
        WHERE e2.shop_id = rp.shop_id
          AND e2.registered_product_id = rp.id
        ORDER BY FIELD(e2.status, 'active', 'pending_payment', 'refunded', 'cancelled', 'expired'), e2.created_at DESC
        LIMIT 1
      )
      WHERE rp.id = ? AND rp.shop_id = ?
      `,
      [id, shopId]
    );

    const row = rows[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        error: "Registered product not found",
      });
    }

    const client = new shopify.api.clients.Graphql({ session });

    let orderNumber = null;
    if (row.shopify_order_id) {
      const orderNameMap = await fetchShopifyOrderNames(client, [row.shopify_order_id]);
      orderNumber = orderNameMap.get(String(row.shopify_order_id)) || null;
    }

    const variantTitle = await fetchShopifyVariantTitle(client, row.shopify_variant_id);
    const phoneNumber = await fetchShopifyCustomerPhone(client, row.customer_id);

    const entitlementMap = await getEntitlementsForRegistrations(shopId, [row.id]);
    const entitlement = entitlementMap.get(row.id) || null;

    let refundRecord = null;
    if (entitlement?.id) {
      const refundMap = await getLatestRefundForEntitlements(shopId, [entitlement.id]);
      refundRecord = refundMap.get(entitlement.id) || null;
    }

    const purchaseTypeLabel =
      row.purchase_type === "shopify" ? "Shopify Purchase" : "External Purchase";

    return res.json({
      success: true,
      data: {
        id: row.id,
        order_number: orderNumber,
        shopify_order_id: row.shopify_order_id,
        serial_number: row.serial_number,
        sku: row.sku,
        product_name: row.product_name,
        product_variant: variantTitle,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        purchase_type: purchaseTypeLabel,
        warranty_type: formatWarrantyTypeLabel(row),
        purchase_date: formatDateOnly(row.purchase_date),
        registration_date: formatDateOnly(row.created_at),
        warranty_start: formatDateOnly(row.warranty_start),
        warranty_end: formatDateOnly(row.warranty_end),
        extended_warranty_start: formatDateOnly(row.extended_warranty_start),
        extended_warranty_end: formatDateOnly(row.extended_warranty_end),
        retailer_name: row.retailer_name || null,
        shopify_customer_id: row.customer_id,
        refund_status: getCustomerFacingRefundStatus(entitlement, refundRecord),
      },
    });
  } catch (err) {
    console.error("❌ getRegisteredProductDetail error:", err);
    return res.status(500).json({ error: "Failed to fetch registered product details" });
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
