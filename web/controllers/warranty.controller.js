import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { sendEmailService } from "../services/email.service.js";
import WarrantyRegistrationSuccessTemplate from "../emailTemp/standard_warranty.js";
import {
  getEntitlementsForRegistrations,
  formatEntitlementForApiExport,
  buildExtendedWarrantyOffer,
  getNumericIdFromGid,
  trySyncPendingEntitlementActivation,
  canPurchaseExtendedWarranty,
  getExtendedWarrantySettings,
  buildPlanAvailabilityIndex,
  canExtendWarrantyLight,
} from "../services/extendedWarranty.service.js";
import {
  getLatestRefundForEntitlements,
  getCustomerFacingRefundStatus,
} from "../services/extendedWarrantyRefund.service.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function fetchShopifyProductImages(client, productIds) {
  const map = new Map();
  const uniqueIds = [
    ...new Set(
      productIds
        .map(id => String(id || "").trim())
        .filter(Boolean)
    ),
  ];
  if (!uniqueIds.length) return map;

  const gids = uniqueIds.map(id => `gid://shopify/Product/${id}`);

  for (let offset = 0; offset < gids.length; offset += 50) {
    const chunk = gids.slice(offset, offset + 50);
    try {
      const result = await client.request(
        `
        query ($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              featuredImage {
                url
              }
            }
          }
        }
        `,
        { variables: { ids: chunk } }
      );

      for (const node of result.data?.nodes || []) {
        if (!node?.id) continue;
        const numericId = node.id.split("/").pop();
        map.set(numericId, {
          image: node.featuredImage?.url || null,
          title: node.title || null,
        });
      }
    } catch (err) {
      console.warn("⚠️ Batch product image fetch failed:", err.message);
    }
  }

  return map;
}

async function resolveShopifyCustomer(client, loggedInCustomerId, fallback = {}) {
  let customerId = fallback.id ? String(fallback.id) : null;
  let customerEmail = fallback.email ? String(fallback.email).trim() : null;
  let customerName = fallback.name ? String(fallback.name).trim() : null;

  if (!loggedInCustomerId) {
    return { customerId, customerEmail, customerName };
  }

  const customerResult = await client.request(
    `
    query ($id: ID!) {
      customer(id: $id) {
        email
        displayName
      }
    }
    `,
    {
      variables: { id: `gid://shopify/Customer/${loggedInCustomerId}` },
    }
  );

  const shopifyCustomer = customerResult?.data?.customer;
  if (shopifyCustomer?.email) {
    customerEmail = shopifyCustomer.email.trim();
    customerId = String(loggedInCustomerId);
    if (!customerName && shopifyCustomer.displayName) {
      customerName = shopifyCustomer.displayName;
    }
  }

  return { customerId, customerEmail, customerName };
}

function getStandardWarrantyStatus(warrantyEnd) {
  if (!warrantyEnd) return "pending_registration";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(warrantyEnd);
  end.setHours(0, 0, 0, 0);
  if (end < today) return "expired";
  return "active";
}

function getExtendedWarrantyDisplayStatus(entitlement, refundRecord = null) {
  if (!entitlement) return null;

  const refundStatus = getCustomerFacingRefundStatus(entitlement, refundRecord);
  if (refundStatus) return refundStatus;

  if (entitlement.status === "pending_payment") return "Pending Payment";
  if (entitlement.status === "cancelled") return "Cancelled";
  if (entitlement.status === "refunded") return "Refunded";
  if (entitlement.status === "expired") return "Expired";
  if (entitlement.status === "active" && entitlement.expiry_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(entitlement.expiry_date);
    end.setHours(0, 0, 0, 0);
    if (end < today) return "Expired";
  }
  if (entitlement.status === "active") return "Active";
  return entitlement.status;
}

async function resolveEntitlementWithSync({
  session,
  shopId,
  registerId,
  customerEmail,
  entitlement,
}) {
  if (entitlement?.status !== "pending_payment" || !registerId) {
    return entitlement;
  }

  const synced = await trySyncPendingEntitlementActivation({
    session,
    shopId,
    registerId,
    customerEmail,
  });
  return synced || entitlement;
}

async function enrichProductWarrantyFields(
  product,
  shopId,
  entitlementRow = null,
  refundRecord = null,
  session = null,
  listContext = null
) {
  product.standard_warranty = {
    status: product.is_registered
      ? getStandardWarrantyStatus(product.warranty_end)
      : "pending_registration",
    start: product.warranty_start || null,
    end: product.warranty_end || null,
  };

  const hasActiveExtendedWarranty = entitlementRow?.status === "active";

  if (entitlementRow) {
    const registeredProduct = {
      warranty_end: product.warranty_end,
    };
    const refundDateRaw =
      refundRecord?.completedAt ||
      refundRecord?.createdAt ||
      entitlementRow.refunded_at ||
      null;
    product.extended_warranty = {
      ...formatEntitlementForApiExport(entitlementRow, registeredProduct),
      displayStatus: getExtendedWarrantyDisplayStatus(entitlementRow, refundRecord),
      refundStatus: refundRecord?.status || null,
      refundType: refundRecord?.refundType || null,
      refundAmount:
        refundRecord?.netRefundAmount ?? entitlementRow.refund_amount ?? null,
      refundDate: refundDateRaw
        ? new Date(refundDateRaw).toISOString().split("T")[0]
        : null,
    };
  } else if (product.register_id && product.is_registered) {
    product.extended_warranty = {
      status: null,
      displayStatus: "Not Purchased",
    };
  }

  product.can_extend_warranty = false;
  product.can_resume_warranty_payment = false;

  if (entitlementRow?.status === "pending_payment" && !hasActiveExtendedWarranty) {
    product.can_resume_warranty_payment = true;
    product.extended_warranty_eligibility = {
      eligible: false,
      reason: "pending_payment",
    };
  } else if (
    product.is_registered &&
    product.register_id &&
    !hasActiveExtendedWarranty
  ) {
    if (listContext) {
      const registered =
        listContext.registeredById.get(product.register_id) || {
          id: product.register_id,
          created_at: product.registered_at,
          purchase_date: product.purchase_date,
          shopify_product_id: product.product_id,
          shopify_variant_id: product.variant_id,
        };
      const eligibility = canExtendWarrantyLight({
        entitlement: entitlementRow,
        registered,
        ewSettings: listContext.ewSettings,
        planIndex: listContext.planIndex,
      });
      product.can_extend_warranty = Boolean(eligibility.eligible);
      product.extended_warranty_eligibility = {
        eligible: Boolean(eligibility.eligible),
        reason: eligibility.reason || null,
        purchaseWindow: eligibility.purchaseWindow || null,
      };
    } else {
      try {
        const eligibility = await canPurchaseExtendedWarranty(
          shopId,
          product.register_id,
          { session }
        );
        product.can_extend_warranty = Boolean(eligibility.eligible);
        product.extended_warranty_eligibility = eligibility;
      } catch (eligibilityErr) {
        console.warn(
          `⚠️ EW eligibility check failed for register ${product.register_id}:`,
          eligibilityErr.message
        );
      }
    }
  }

  return product;
}

export async function getMyProductsOld(req, res) {
  console.log("➡️ App Proxy hit: /my-products");

  try {
    const { shop, logged_in_customer_id } = req.query;

    if (!shop || !logged_in_customer_id) {
      return res.status(401).json({
        error: "Customer not logged in or proxy not working",
      });
    }

    // 1️⃣ Shopify session
    const session = res.locals.shopifySession;
    if (!session) {
      return res.status(401).json({ error: "App not installed" });
    }

    const client = new shopify.api.clients.Graphql({ session });

    // 2️⃣ Get customer email
    const customerGid = `gid://shopify/Customer/${logged_in_customer_id}`;

    const customerQuery = `
      query ($id: ID!) {
        customer(id: $id) {
          email
        }
      }
    `;

    const customerResult = await client.request(customerQuery, {
      variables: { id: customerGid },
    });

    const customerEmail = customerResult?.data?.customer?.email;
    if (!customerEmail) {
      return res.status(404).json({ error: "Customer email not found" });
    }

    /* ======================================================
       3️⃣ ORDER PRODUCTS (Shopify)
    ====================================================== */
    const ordersQuery = `
      query ($query: String!) {
        orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              processedAt
              lineItems(first: 50) {
                edges {
                  node {
                    product {
                      id
                      title
                      featuredImage {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const ordersResult = await client.request(ordersQuery, {
      variables: { query: `email:${customerEmail}` },
    });

    const orderProducts = [];

    for (const orderEdge of ordersResult.data?.orders?.edges || []) {
      const order = orderEdge.node;

      for (const itemEdge of order.lineItems.edges) {
        const product = itemEdge.node.product;
        if (!product) continue;

        orderProducts.push({
          product_id: product.id,
          title: product.title,
          image: product.featuredImage?.url || null,
          order_number: order.name,
          order_id: order.id,
          purchase_date: order.processedAt,
        });
      }
    }

    /* ======================================================
       4️⃣ REGISTERED PRODUCTS (DB)
    ====================================================== */
    const [registeredProducts] = await pool.query(
      `
      SELECT *
      FROM registered_products
      WHERE customer_email = ?
      ORDER BY created_at DESC
      `,
      [customerEmail],
    );

    /* ======================================================
       5️⃣ FETCH SHOPIFY PRODUCT IMAGES FOR REGISTERED
    ====================================================== */
    const registeredWithImages = [];

    for (const rp of registeredProducts) {
      let image = null;

      if (rp.shopify_product_id) {
        try {
          const productQuery = `
            query ($id: ID!) {
              product(id: $id) {
                title
                featuredImage {
                  url
                }
              }
            }
          `;

          const productResult = await client.request(productQuery, {
            variables: { id: rp.shopify_product_id },
          });

          image = productResult?.data?.product?.featuredImage?.url || null;
          rp.title = productResult?.data?.product?.title || rp.product_name;
        } catch (e) {
          console.warn(
            "⚠️ Shopify product fetch failed:",
            rp.shopify_product_id,
          );
        }
      }

      registeredWithImages.push({
        ...rp,
        image,
      });
    }

    return res.status(200).json({
      orders: orderProducts,
      registered: registeredWithImages,
    });
  } catch (err) {
    console.error("🔥 getMyProducts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getMyProductsWorkingOld1702(req, res) {
  console.log("➡️ App Proxy hit: /my-products");

  try {
    const { shop, logged_in_customer_id } = req.query;

    if (!shop || !logged_in_customer_id) {
      return res.status(401).json({
        error: "Customer not logged in or proxy not working",
      });
    }

    const session = res.locals.shopifySession;
    if (!session) {
      return res.status(401).json({ error: "App not installed" });
    }

    const client = new shopify.api.clients.Graphql({ session });

    /* =====================================
       1️⃣ CUSTOMER EMAIL
    ===================================== */
    const customerGid = `gid://shopify/Customer/${logged_in_customer_id}`;

    const customerResult = await client.request(
      `
      query ($id: ID!) {
        customer(id: $id) {
          email
        }
      }
      `,
      { variables: { id: customerGid } },
    );

    const customerEmail = customerResult?.data?.customer?.email;
    if (!customerEmail) {
      return res.status(404).json({ error: "Customer email not found" });
    }

    /* =====================================
       2️⃣ REGISTERED PRODUCTS (DB)
    ===================================== */
    const [registeredRows] = await pool.query(
      `
      SELECT *
      FROM registered_products
      WHERE customer_email = ?
      ORDER BY created_at DESC
      `,
      [customerEmail],
    );

    const registeredMap = new Map();

    for (const rp of registeredRows) {
      //registeredMap.set(String(rp.shopify_product_id), rp);
      if (
        rp.purchase_type === "shopify" &&
        rp.shopify_product_id &&
        rp.shopify_order_id
      ) {
        const key = `${rp.shopify_product_id}_${rp.shopify_order_id}`;
        registeredMap.set(key, rp);
      }
    }

    /* =====================================
       3️⃣ SHOPIFY ORDER PRODUCTS
    ===================================== */
    const ordersResult = await client.request(
      `
      query ($query: String!) {
        orders(first: 50, query: $query, reverse: true) {
          edges {
            node {
              id
              name
              processedAt
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    sku
                    variant {
                      id
                      title
                      sku
                      image {
                        url
                      }
                    }
                    product {
                      id
                      title
                      featuredImage {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      `,
      { variables: { query: `email:${customerEmail}` } },
    );

    const products = [];

    for (const orderEdge of ordersResult.data?.orders?.edges || []) {
      const order = orderEdge.node;

      for (const itemEdge of order.lineItems.edges) {
        const item = itemEdge.node;
        const product = item.product;
        const variant = item.variant;
        //const product = itemEdge.node.product;
        if (!product) continue;

        const numericProductId = product.id.split("/").pop();
        //const registered = registeredMap.get(numericProductId);

        const numericOrderId = order.id.split("/").pop();
        const key = `${numericProductId}_${numericOrderId}`;

        const registered = registeredMap.get(key);

        //const OrderId = order.id.split("/").pop();

        /* =====================================
           VARIANT LOGIC
        ===================================== */

        const variantTitle =
          variant && variant.title !== "Default Title" ? variant.title : null;

        const displayTitle = variantTitle
          ? `${product.title} - ${variantTitle}`
          : product.title;

        const image = variant?.image?.url || product.featuredImage?.url || null;

        const sku = variant?.sku || item.sku || null;

        //const OrderId = order.id.split("/").pop();

        products.push({
          source: "shopify",
          order_id: order.id,
          order_number: order.name,
          product_id: numericProductId,
          variant_id: variant?.id?.split("/").pop() || null,
          //title: product.title,
          title: displayTitle,
          base_product_title: product.title,
          variant_title: variantTitle,
          sku: sku,
          image: image,
          order_number: order.name,
          purchase_date: order.processedAt,
          serial_number: registered?.serial_number || null,
          warranty_start: registered?.warranty_start || null,
          warranty_end: registered?.warranty_end || null,
          is_registered: !!registered,
        });
      }
    }

    /* =====================================
       4️⃣ EXTERNAL PRODUCTS (DB)
    ===================================== */
    const externalProducts = registeredRows.filter(
      (p) => p.purchase_type === "external",
    );

    for (const ep of externalProducts) {
      let image = null;

      if (ep.shopify_product_id) {
        try {
          const result = await client.request(
            `
            query ($id: ID!) {
              product(id: $id) {
                featuredImage {
                  url
                }
              }
            }
            `,
            {
              variables: {
                id: `gid://shopify/Product/${ep.shopify_product_id}`,
              },
            },
          );

          image = result?.data?.product?.featuredImage?.url || null;
        } catch {}
      }

      products.push({
        source: "external",
        order_id: null,
        product_id: ep.shopify_product_id,
        title: ep.product_name,
        image,
        order_number: null,
        purchase_date: ep.purchase_date,
        serial_number: ep.serial_number,
        warranty_start: ep.warranty_start,
        warranty_end: ep.warranty_end,
        is_registered: true,
      });
    }

    /* =====================================
       5️⃣ RESPONSE
    ===================================== */
    return res.status(200).json({
      products,
    });
  } catch (err) {
    console.error("🔥 getMyProducts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getMyProducts(req, res) {
  console.log("➡️ App Proxy hit: /my-products");

  try {
    const { shop, logged_in_customer_id } = req.query;

    console.log("in getMyProducts 111", shop);

    if (!shop || !logged_in_customer_id) {
      return res.status(401).json({
        error: "Customer not logged in or proxy not working",
      });
    }

    const session = res.locals.shopifySession;
    if (!session) {
      return res.status(401).json({ error: "App not installed" });
    }

    const client = new shopify.api.clients.Graphql({ session });

    /* =====================================
       🔐 UPDATED: Get shop_id
    ===================================== */
    const [shopRows] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? LIMIT 1`,
      [shop],
    );

    if (!shopRows.length) {
      return res.status(400).json({ error: "Shop not found" });
    }

    const shopId = shopRows[0].id;

    /* =====================================
       1️⃣ CUSTOMER EMAIL
    ===================================== */
    const customerGid = `gid://shopify/Customer/${logged_in_customer_id}`;

    const customerResult = await client.request(
      `
      query ($id: ID!) {
        customer(id: $id) {
          email
        }
      }
      `,
      { variables: { id: customerGid } },
    );

    const customerEmail = customerResult?.data?.customer?.email;
    if (!customerEmail) {
      return res.status(404).json({ error: "Customer email not found" });
    }

    const loggedInCustomerId = String(logged_in_customer_id);
    const normalizedCustomerEmail = normalizeEmail(customerEmail);

    /* =====================================
       2️⃣ REGISTERED PRODUCTS (DB)
    ===================================== */
    const [registeredRows] = await pool.query(
      `
      SELECT *
      FROM registered_products
      WHERE shop_id = ?
        AND (
          LOWER(TRIM(customer_email)) = ?
          OR customer_id = ?
        )
      ORDER BY created_at DESC
      `,
      [shopId, normalizedCustomerEmail, loggedInCustomerId],
    );

    const registeredMap = new Map();

    for (const rp of registeredRows) {
      //registeredMap.set(String(rp.shopify_product_id), rp);
      if (
        rp.purchase_type === "shopify" &&
        rp.shopify_product_id &&
        rp.shopify_order_id
      ) {
        const key = `${rp.shopify_product_id}_${rp.shopify_order_id}`;
        registeredMap.set(key, rp);
      }
    }

    /* =====================================
       3️⃣ SHOPIFY ORDER PRODUCTS
    ===================================== */
    const ordersResult = await client.request(
      `
      query ($query: String!) {
        orders(first: 50, query: $query, reverse: true) {
          edges {
            node {
              id
              name
              processedAt
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    sku
                    variant {
                      id
                      title
                      sku
                      image {
                        url
                      }
                    }
                    product {
                      id
                      title
                      featuredImage {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      `,
      { variables: { query: `email:${customerEmail}` } },
    );

    const products = [];

    for (const orderEdge of ordersResult.data?.orders?.edges || []) {
      const order = orderEdge.node;

      for (const itemEdge of order.lineItems.edges) {
        const item = itemEdge.node;
        const product = item.product;
        const variant = item.variant;
        //const product = itemEdge.node.product;
        if (!product) continue;

        const numericProductId = product.id.split("/").pop();
        //const registered = registeredMap.get(numericProductId);

        const lineItemId = item.id;
        const numericLineItemId = lineItemId.split("/").pop();

        const numericOrderId = order.id.split("/").pop();
        const key = `${numericProductId}_${numericOrderId}`;

        const registered = registeredMap.get(key);

        /* =====================================
           VARIANT LOGIC
        ===================================== */

        const variantTitle =
          variant && variant.title !== "Default Title" ? variant.title : null;

        const displayTitle = variantTitle
          ? `${product.title} - ${variantTitle}`
          : product.title;

        const image = variant?.image?.url || product.featuredImage?.url || null;

        const sku = variant?.sku || item.sku || null;

        //const OrderId = order.id.split("/").pop();

        products.push({
          source: "shopify",
          order_id: order.id,
          order_number: order.name,
          product_id: numericProductId,
          variant_id: variant?.id?.split("/").pop() || null,
          line_item_id: numericLineItemId,
          title: displayTitle,
          base_product_title: product.title,
          variant_title: variantTitle,
          sku: sku,
          image: image,
          purchase_date: order.processedAt,
          registered_at: registered?.created_at || null,
          sort_date: registered?.created_at || order.processedAt,
          register_id: registered?.id || null,
          serial_number: registered?.serial_number || null,
          warranty_start: registered?.warranty_start || null,
          warranty_end: registered?.warranty_end || null,
          is_registered: !!registered,
        });
      }
    }

    /* =====================================
       4️⃣ EXTERNAL PRODUCTS (DB)
    ===================================== */
    const addedRegisterIds = new Set(
      products.map((p) => p.register_id).filter(Boolean)
    );
    const externalProducts = registeredRows.filter(
      (p) => p.purchase_type === "external" && !addedRegisterIds.has(p.id),
    );

    const externalProductIds = externalProducts
      .map(ep => ep.shopify_product_id)
      .filter(Boolean);
    const externalProductImageMap = await fetchShopifyProductImages(
      client,
      externalProductIds
    );

    for (const ep of externalProducts) {
      const productMeta = ep.shopify_product_id
        ? externalProductImageMap.get(String(ep.shopify_product_id))
        : null;
      const image = productMeta?.image || null;

      products.push({
        source: "external",
        order_id: null,
        product_id: ep.shopify_product_id,
        line_item_id: null,
        title: productMeta?.title || ep.product_name,
        image,
        order_number: null,
        register_id: ep.id,
        purchase_date: ep.purchase_date,
        registered_at: ep.created_at,
        sort_date: ep.created_at || ep.purchase_date,
        serial_number: ep.serial_number,
        sku: ep.sku || null,
        warranty_start: ep.warranty_start,
        warranty_end: ep.warranty_end,
        is_registered: true,
      });
    }

    const registerIds = products.map(p => p.register_id).filter(Boolean);
    const entitlementMap = await getEntitlementsForRegistrations(shopId, registerIds);

    const entitlementIds = [...entitlementMap.values()]
      .map(e => e.id)
      .filter(Boolean);
    let refundMap = new Map();
    try {
      refundMap = await getLatestRefundForEntitlements(shopId, entitlementIds);
    } catch (refundErr) {
      console.warn("⚠️ Refund lookup skipped:", refundErr.message);
    }

    const ewSettings = await getExtendedWarrantySettings(shopId);
    const planIndex = await buildPlanAvailabilityIndex(shopId, [
      ...products.map(p => p.product_id),
      ...registeredRows.map(r => r.shopify_product_id),
    ]);
    const registeredById = new Map(registeredRows.map(r => [r.id, r]));
    const listContext = { ewSettings, planIndex, registeredById };

    for (const product of products) {
      const entitlement = product.register_id
        ? entitlementMap.get(product.register_id)
        : null;
      const refundRecord = entitlement ? refundMap.get(entitlement.id) : null;
      try {
        enrichProductWarrantyFields(
          product,
          shopId,
          entitlement,
          refundRecord,
          session,
          listContext
        );
      } catch (enrichErr) {
        console.warn(
          `⚠️ Warranty enrichment failed for product ${product.product_id}:`,
          enrichErr.message
        );
      }
    }

    products.sort((a, b) => {
      const dateA = new Date(a.sort_date || a.registered_at || a.purchase_date || 0);
      const dateB = new Date(b.sort_date || b.registered_at || b.purchase_date || 0);
      return dateB - dateA;
    });

    /* =====================================
       5️⃣ RESPONSE
    ===================================== */
    return res.status(200).json({
      products,
    });
  } catch (err) {
    console.error("🔥 getMyProducts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getProductDetail(req, res) {
  try {
    const { registration_id, product_id, order_id, line_item_id, flow } =
      req.body;

    if (!flow) {
      return res.status(400).json({
        success: false,
        error: "flow is required",
      });
    }

    const session = res.locals.shopifySession;
    if (!session) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized Shopify session",
      });
    }

    const shopDomain = session.shop;

    /* =====================================================
       🔐 Get shop_id for isolation
    ====================================================== */

    const [shopRows] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? LIMIT 1`,
      [shopDomain],
    );

    if (!shopRows.length) {
      return res.status(400).json({
        success: false,
        error: "Shop not registered in system",
      });
    }

    const shopId = shopRows[0].id;

    const client = new shopify.api.clients.Graphql({ session });

    /* =====================================================
       1️⃣ SHOPIFY FLOW
    ====================================================== */

    if (flow === "shopify") {
      if (!order_id || !line_item_id) {
        return res.status(400).json({
          success: false,
          error: "order_id and line_item_id required",
        });
      }

      const numericOrderId = order_id.split("/").pop();
      const normalizedOrderGid = order_id.startsWith("gid://")
        ? order_id
        : `gid://shopify/Order/${order_id}`;

      /* ---- Fetch Order ---- */

      const response = await client.request(
        `
        query getOrder($id: ID!) {
          order(id: $id) {
            id
            name
            processedAt
            lineItems(first: 50) {
              edges {
                node {
                  id
                  name
                  sku
                  variant {
                    id
                    title
                    image { url }
                  }
                  product {
                    id
                    title
                    featuredImage { url }
                  }
                }
              }
            }
          }
        }
        `,
        { variables: { id: normalizedOrderGid } },
      );

      const order = response?.data?.order;

      if (!order) {
        return res.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      /* ---- Match EXACT line item ---- */

      console.log("Lineitem Id from post req.::", line_item_id);

      const numeric_line_item_id = `gid://shopify/LineItem/${line_item_id}`;
      console.log("Lineitem Id from item line.::", numeric_line_item_id);

      // const matchedItem = order.lineItems.edges.find(
      //   (edge) => {
      //     edge.node.id === numeric_line_item_id
      //     console.log("edge.node.id ::",edge.node.id);
      //     console.log("line item id  ::",numeric_line_item_id);
      //   }
      // );

      const matchedItem = order.lineItems.edges.find((edge) => {
        const numericEdgeId = edge.node.id;

        console.log("numericEdgeId ::", numericEdgeId);
        console.log("numeric_line_item_id ::", numeric_line_item_id);

        return numericEdgeId === numeric_line_item_id;
      });

      console.log(
        "Lineitem Id from order shopify.::",
        matchedItem,
        numeric_line_item_id,
      );

      if (!matchedItem) {
        return res.status(404).json({
          success: false,
          error: "Line item not found in order",
        });
      }

      const node = matchedItem.node;
      const product = node.product;
      const variant = node.variant;

      /* ---- Check registration by shop + line item ---- */

      const [registeredRows] = await pool.query(
        `
        SELECT * FROM registered_products
        WHERE shop_id = ?
        AND shopify_line_item_id = ?
        LIMIT 1
        `,
        [shopId, line_item_id],
      );

      const registered = registeredRows[0] || null;
      const entitlementMap = registered
        ? await getEntitlementsForRegistrations(shopId, [registered.id])
        : new Map();
      const entitlement = registered
        ? await resolveEntitlementWithSync({
            session,
            shopId,
            registerId: registered.id,
            customerEmail: registered.customer_email,
            entitlement: entitlementMap.get(registered.id) || null,
          })
        : null;
      const refundMap =
        entitlement?.id
          ? await getLatestRefundForEntitlements(shopId, [entitlement.id])
          : new Map();
      const refundRecord = entitlement ? refundMap.get(entitlement.id) : null;

      const image = variant?.image?.url || product?.featuredImage?.url || null;

      const productPayload = {
        source: "shopify",
        order_id: order.id,
        order_number: order.name,
        product_id: product?.id?.split("/").pop(),
        variant_id: variant?.id?.split("/").pop() || null,
        title: node.name,
        base_product_title: product?.title,
        variant_title: variant?.title || null,
        sku: node.sku || null,
        image,
        purchase_date: order.processedAt,
        registered_at: registered?.created_at || null,
        register_id: registered?.id || null,
        serial_number: registered?.serial_number || null,
        warranty_start: registered?.warranty_start || null,
        warranty_end: registered?.warranty_end || null,
        is_registered: !!registered,
      };

      await enrichProductWarrantyFields(
        productPayload,
        shopId,
        entitlement,
        refundRecord,
        session
      );

      return res.json({
        success: true,
        product: productPayload,
      });
    }

    /* =====================================================
       2️⃣ EXTERNAL FLOW
    ====================================================== */

    if (flow === "external") {
      if (!registration_id) {
        return res.status(400).json({
          success: false,
          error: "registration_id required",
        });
      }

      const [rows] = await pool.query(
        `
        SELECT * FROM registered_products
        WHERE id = ?
        AND shop_id = ?
        LIMIT 1
        `,
        [registration_id, shopId],
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          error: "External registration not found",
        });
      }

      const r = rows[0];

      /* ---- Fetch Shopify product for accuracy ---- */

      const productGid = `gid://shopify/Product/${r.shopify_product_id}`;

      const response = await client.request(
        `
        query getProduct($id: ID!) {
          product(id: $id) {
            id
            title
            featuredImage { url }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  image { url }
                }
              }
            }
          }
        }
        `,
        { variables: { id: productGid } },
      );

      const product = response?.data?.product;

      const variant =
        product?.variants?.edges?.find(
          (v) =>
            v.node.id.endsWith(`/${r.shopify_product_id}`) ||
            v.node.id.endsWith(`/${r.shopify_line_item_id}`),
        )?.node || null;

      const image = variant?.image?.url || product?.featuredImage?.url || null;
      const entitlementMap = await getEntitlementsForRegistrations(shopId, [r.id]);
      const entitlement = await resolveEntitlementWithSync({
        session,
        shopId,
        registerId: r.id,
        customerEmail: r.customer_email,
        entitlement: entitlementMap.get(r.id) || null,
      });
      const refundMap = entitlement?.id
        ? await getLatestRefundForEntitlements(shopId, [entitlement.id])
        : new Map();
      const refundRecord = entitlement ? refundMap.get(entitlement.id) : null;

      const productPayload = {
        source: "external",
        order_id: null,
        order_number: null,
        product_id: r.shopify_product_id,
        variant_id: variant?.id?.split("/").pop() || r.shopify_variant_id || null,
        title: product?.title,
        base_product_title: product?.title,
        variant_title: variant?.title || null,
        sku: r.sku || null,
        image,
        purchase_date: r.purchase_date,
        registered_at: r.created_at || null,
        register_id: r.id,
        serial_number: r.serial_number,
        warranty_start: r.warranty_start,
        warranty_end: r.warranty_end,
        is_registered: true,
      };

      await enrichProductWarrantyFields(
        productPayload,
        shopId,
        entitlement,
        refundRecord,
        session
      );

      return res.json({
        success: true,
        product: productPayload,
      });
    }

    return res.status(404).json({
      success: false,
      error: "Invalid flow",
    });
  } catch (error) {
    console.error("❌ Product detail error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}

export async function getUnregisteredProductDetail(req, res) {
  try {
    console.log("🔥 Incoming proxy query:", req.query);

    const { shop, logged_in_customer_id } = req.query;

    if (!shop || !logged_in_customer_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 1️⃣ Build IDs
    const productGid = `gid://shopify/Product/${req.params.productId}`;
    const customerGid = `gid://shopify/Customer/${logged_in_customer_id}`;

    console.log("🧩 Product GID:", productGid);
    console.log("🧩 Customer GID:", customerGid);

    // 2️⃣ Get OFFLINE session (already validated in middleware)
    const session = res.locals.shopifySession;

    if (!session) {
      return res.status(401).json({ error: "Shop not installed" });
    }

    // 3️⃣ Create GraphQL client
    const client = new shopify.api.clients.Graphql({ session });

    /**
     * 4️⃣ Fetch CUSTOMER EMAIL (MOST RELIABLE IDENTIFIER)
     */
    const customerQuery = `
      query ($id: ID!) {
        customer(id: $id) {
          email
        }
      }
    `;

    const customerResult = await client.request(customerQuery, {
      variables: { id: customerGid },
    });

    const customerEmail = customerResult?.data?.customer?.email;

    if (!customerEmail) {
      return res.status(404).json({ error: "Customer email not found" });
    }

    console.log("📧 Customer Email:", customerEmail);

    /**
     * 5️⃣ Fetch ORDERS by EMAIL (PRODUCTION-SAFE)
     */
    const ordersQuery = `
      query ($query: String!) {
        orders(first: 50, query: $query) {
          edges {
            node {
              createdAt
              lineItems(first: 50) {
                edges {
                  node {
                    product {
                      id
                      title
                      featuredImage {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    //console.log("in getUnregisteredProductDetail 111");

    const ordersResult = await client.request(ordersQuery, {
      variables: {
        query: `email:${customerEmail}`,
      },
    });

    //console.log("in getUnregisteredProductDetail 222", ordersResult);

    /**
     * 6️⃣ Match PRODUCT inside ORDERS
     */
    let matchedProduct = null;
    // console.log("in getUnregisteredProductDetail 222 11");

    let purchaseDate = null;
    // console.log("in getUnregisteredProductDetail 222 222");

    for (const orderEdge of ordersResult.data?.orders?.edges || []) {
      //  console.log("in getUnregisteredProductDetail 333", orderEdge);

      for (const itemEdge of orderEdge.node.lineItems.edges) {
        //  console.log("in getUnregisteredProductDetail 444 ", itemEdge);

        if (itemEdge.node.product?.id === productGid) {
          //console.log("Product id storefront :: ",productGid);
          //console.log("Product id from api:: ",itemEdge.node.product?.id);

          // console.log("data::",itemEdge.node.product,orderEdge.node.createdAt);

          matchedProduct = itemEdge.node.product;
          purchaseDate = orderEdge.node.createdAt;
          break;
        }
      }
      console.log("in getUnregisteredProductDetail 555");

      if (matchedProduct) break;
    }

    if (!matchedProduct) {
      console.log("in getUnregisteredProductDetail 666", matchedProduct);

      console.warn("⚠️ Product not found in customer orders");
      return res.status(404).json({
        error: "Product not found in customer orders",
      });
    }

    /**
     * 7️⃣ SUCCESS RESPONSE (UNREGISTERED PRODUCT)
     */
    return res.json({
      is_registered: false,
      product: {
        product_id: matchedProduct.id,
        title: matchedProduct.title,
        image: matchedProduct.featuredImage?.url || "",
        purchase_date: purchaseDate,
      },
    });
  } catch (error) {
    console.error("❌ Unregistered product detail error:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function getOrdersDetails(req, res) {
  console.log("➡️ App Proxy hit: /apps/warranty/orders");

  try {
    /* -------------------------------------------------
     1️⃣ BASIC APP PROXY VALIDATION
    ------------------------------------------------- */
    const { shop, logged_in_customer_id } = req.query;
    const { order_id, product_id } = req.body;

    //const shop = req.query.shop;
    //const logged_in_customer_id = req.query.logged_in_customer_id;
    //  const order_id = req.query.order_id;
    // const product_id = req.query.product_id;

    console.log("Query params:", {
      shop,
      logged_in_customer_id,
      order_id,
      product_id,
    });

    const productId = "gid://shopify/Product/" + product_id;

    console.log("Order detail: ", order_id, productId);

    if (!shop || !logged_in_customer_id) {
      return res.status(401).json({
        error: "Customer not logged in or App Proxy misconfigured",
      });
    }

    if (!order_id || !productId) {
      return res.status(400).json({
        error: "Missing order_id or product_id",
      });
    }

    /* -------------------------------------------------
     2️⃣ REUSE OFFLINE SESSION (MANDATORY)
    ------------------------------------------------- */
    const session = res.locals.shopifySession;

    if (!session) {
      return res.status(401).json({
        error: "App not installed on this store",
      });
    }

    const client = new shopify.api.clients.Graphql({ session });

    /* -------------------------------------------------
     3️⃣ FETCH ORDER BY ID
    ------------------------------------------------- */
    const orderQuery = `
      query ($id: ID!) {
        order(id: $id) {
          id
          name
          processedAt
          email
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                sku
                variant {
                  id
                  title
                  sku
                }
                product {
                  id
                  title
                }
              }
            }
          }
        }
      }
    `;

    const result = await client.request(orderQuery, {
      variables: { id: order_id },
    });

    const order = result?.data?.order;

    console.log("order detail 22", order);

    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    /* -------------------------------------------------
     4️⃣ SECURITY: VERIFY ORDER BELONGS TO CUSTOMER
    ------------------------------------------------- */
    const customerGid = `gid://shopify/Customer/${logged_in_customer_id}`;

    if (order.email === null) {
      return res.status(403).json({ error: "Order email missing" });
    }

    // Email-based verification (MOST RELIABLE)
    // logged_in_customer_id already validated by App Proxy
    // Shopify guarantees order.email === customer.email
    /* ------------------------------------------------- */

    /* -------------------------------------------------
     5️⃣ FIND REQUESTED PRODUCT IN ORDER
    ------------------------------------------------- */
    const lineItemEdge = order.lineItems.edges.find(
      (edge) => edge.node.product?.id === productId,
    );

    // console.log("in orders 333", lineItemEdge);

    if (!lineItemEdge) {
      return res.status(404).json({
        error: "Product not found in this order",
      });
    }

    const item = lineItemEdge.node;
    const variant = item.variant;

    /* -------------------------------------------------
       BUILD DISPLAY VALUES (THIS IS THE KEY PART)
    ------------------------------------------------- */

    const displayTitle =
      variant && variant.title !== "Default Title"
        ? `${item.product.title} - ${variant.title}`
        : item.product.title;

    const displaySku = variant?.sku ? variant?.sku : item.sku;

    /* -------------------------------------------------
     6️⃣ FINAL RESPONSE (FRONTEND EXPECTS THIS)
    ------------------------------------------------- */
    return res.status(200).json({
      order_number: order.name, // e.g. #891324794
      order_id: order.id,
      purchase_date: order.processedAt ? order.processedAt.split("T")[0] : null,

      product: {
        line_item_id: item.id,
        product_id: item.product.id,
        variant_id: variant?.id,
        title: item.title,
        sku: item.sku,
        displayName: displayTitle,
        displaySku: displaySku,
      },
    });
  } catch (err) {
    console.error("🔥 orders controller error:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}

/**
 * GET /apps/warranty/products/autocomplete?q=he
 */
export async function productAutocomplete(req, res) {
  try {
    const { q, shop } = req.query;

    if (!shop || !q) {
      return res.status(400).json([]);
    }

    const session = res.locals.shopifySession;
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      query ($query: String!) {
        products(first: 30, query: $query) {
          edges {
            node {
              id
              title
              handle
              metafield(
                namespace: "warranty"
                key: "standard_duration"
              ) {
               value
              }
            }
          }
        }
      }
    `;

    const result = await client.request(query, {
      variables: {
        query: `title:*${q}* status:active`,
      },
    });

    const normalizedQuery = String(q).trim().toLowerCase();

    const products = result.data.products.edges
      .filter((p) => {
        const duration = p.node.metafield ? Number(p.node.metafield.value) : null;
        if (duration !== null && duration <= 0) return false;

        const title = String(p.node.title || "").toLowerCase();
        return title.includes(normalizedQuery);
      })
      .slice(0, 10)
      .map((p) => ({
        id: p.node.id,
        title: p.node.title,
      }));

    return res.json(products);
  } catch (error) {
    console.error("❌ Product autocomplete error:", error);
    return res.status(500).json([]);
  }
}

export async function getRetailers(req, res) {
  try {
    /* -------------------------------------------------
       1️⃣ APP PROXY CONTEXT
      ------------------------------------------------- */
    const { shop, q, lang } = req.query;

    if (!shop || !q || q.trim().length < 2) {
      return res.json([]);
    }

    if(!lang || lang == '')
      lang = 'en';

    const shopDomain = shop;

    if (!shopDomain) {
      return res.status(400).json({ error: "Shop context missing" });
    }

    // 1️⃣ Get shop_id
    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
      [shopDomain],
    );

    if (!shopRow) {
      return res.status(404).json({ error: "Shop not registered" });
    }

    let columnName = "";
    switch(lang){
      case 'en':
        columnName = "retailer_name";
        break;
      case 'ja':
        columnName = "retailer_name_ja";
        break;
    }
    const shopId = shopRow.id;

    /* -------------------------------------------------
       2️⃣ FETCH FROM DB (STORE-SCOPED)
      ------------------------------------------------- */
    const [rows] = await pool.query(
      `
        SELECT 
          retailer_name,
          retailer_name_ja
        FROM retailers
        WHERE shop_id = ?
          AND is_active = 1
          AND ${columnName} LIKE ? 
        ORDER BY retailer_name ASC
        LIMIT 10
        `,
      [shopId, `%${q}%`],
    );

    /* -------------------------------------------------
       3️⃣ FORMAT FOR AUTOCOMPLETE
      ------------------------------------------------- */
    const retailers = rows.map((r) => ({
      name_en: r.retailer_name,
      name_ja: r.retailer_name_ja,
    }));

    return res.status(200).json(retailers);
  } catch (err) {
    console.error("❌ Retailer autocomplete error:", err);
    return res.status(500).json([]);
  }
}

export async function getStoreSettings(req, res) {
  const { shop } = req.query;

  const shopDomain = shop;

  // 1️⃣ Get shop_id
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [shopDomain],
  );

  if (!shopRow) {
    return res.status(404).json({ error: "Shop not registered" });
  }

  const shopId = shopRow.id;

  console.log("in getStoreSettings 111", shop);

  const [[row]] = await pool.query(
    "SELECT retailer_required FROM store_settings WHERE shop_id = ?",
    [shopId],
  );

  console.log("in getStoreSettings 222");

  res.json(row || { retailer_required: 1 });
}

/**
 * POST /apps/warranty/register
 * Atomic, multi-store safe, production-ready
 */
export async function registerProductsOLd(req, res) {
  const session = res.locals.shopifySession;

  console.log("In Register Products FN 11", res.locals);
  console.log(session);

  if (!session?.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const shopDomain = session.shop;
  const { flow, products, customer, consent } = req.body;

  /* -------------------------------------------------
   * 1️⃣ SERVER-SIDE VALIDATION
   * ------------------------------------------------- */
  if (!flow || !["shopify", "external"].includes(flow)) {
    return res.status(400).json({ error: "Invalid purchase flow" });
  }

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "No products submitted" });
  }

  if (!customer?.email) {
    return res.status(400).json({ error: "Customer email is required" });
  }

  if (!consent) {
    return res.status(400).json({ error: "Consent is required" });
  }

  /* -------------------------------------------------
   * 2️⃣ GET SHOP ID (MULTI-STORE SAFETY)
   * ------------------------------------------------- */
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain = ? AND is_installed = TRUE`,
    [shopDomain],
  );

  if (!shopRow) {
    return res.status(404).json({ error: "Shop not registered" });
  }

  const shopId = shopRow.id;

  /* -------------------------------------------------
   * 3️⃣ TRANSACTION START
   * ------------------------------------------------- */
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const today = new Date();

    for (const product of products) {
      /* ---------------------------------------------
       * 4️⃣ PER-PRODUCT VALIDATION
       * --------------------------------------------- */
      if (!product.serial_number?.trim()) {
        throw new Error("Serial number is required");
      }

      let productName;
      let purchaseDate = null;
      let retailerName = null;
      let shopifyOrderId = null;
      let shopifyLineItemId = null;

      if (flow === "shopify") {
        if (!product.shopify_order_id || !product.shopify_line_item_id) {
          throw new Error("Invalid Shopify product data");
        }

        productName = "Shopify Product";
        shopifyOrderId = product.shopify_order_id;
        shopifyLineItemId = product.shopify_line_item_id;
        purchaseDate = today;
      } else {
        if (!product.product_name || !product.purchase_date) {
          throw new Error("Missing external product details");
        }

        productName = product.product_name;
        retailerName = product.retailer_name || null;
        purchaseDate = new Date(product.purchase_date);
      }

      /* ---------------------------------------------
       * 5️⃣ WARRANTY DATES
       * --------------------------------------------- */
      const warrantyStart = flow === "shopify" ? today : purchaseDate;

      const warrantyEnd = new Date(warrantyStart);
      warrantyEnd.setFullYear(warrantyStart.getFullYear() + 2);

      /* ---------------------------------------------
       * 6️⃣ INSERT
       * --------------------------------------------- */
      await conn.query(
        `
        INSERT INTO registered_products (
          shop_id,
          customer_email,
          customer_name,
          purchase_type,
          shopify_order_id,
          shopify_line_item_id,
          product_name,
          serial_number,
          retailer_name,
          purchase_date,
          warranty_start,
          warranty_end,
          consent_terms,
          consent_marketing
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,1)
        `,
        [
          shopId,
          customer.email,
          customer.name || null,
          flow,
          shopifyOrderId,
          shopifyLineItemId,
          productName,
          product.serial_number.trim(),
          retailerName,
          purchaseDate,
          warrantyStart,
          warrantyEnd,
        ],
      );
    }

    /* -------------------------------------------------
     * 7️⃣ COMMIT (ALL OR NOTHING)
     * ------------------------------------------------- */
    await conn.commit();
    return res.json({ success: true });
  } catch (err) {
    await conn.rollback();

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "This serial number is already registered for this store",
      });
    }

    console.error("❌ registerProduct error:", err);
    return res.status(500).json({
      error: err.message || "Failed to register product",
    });
  } finally {
    conn.release();
  }
}

/**
 * POST /apps/warranty/register
 */
export async function registerProductsNew0502(req, res) {
  const session = res.locals.shopifySession;

  if (!session?.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { flow, products, customer, consent_terms } = req.body;

  if (!flow || !products?.length || !customer?.email || !consent_terms) {
    return res.status(400).json({ error: "Invalid request" });
  }

  /* =====================================
     SHOP ID
  ===================================== */
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain=? AND is_installed=TRUE`,
    [session.shop],
  );

  if (!shopRow) return res.status(404).json({ error: "Shop not registered" });

  const shopId = shopRow.id;

  /* =====================================
    ⭐ CUSTOMER FROM BODY (FIXED)
  ===================================== */
  const customerId = customer.id || null;
  const customerEmail = customer.email;
  const customerName = customer.name || null;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const today = new Date();

    const client = new shopify.api.clients.Graphql({ session });

    for (const p of products) {
      const serial = p.serial_number?.trim();

      if (!/^[a-zA-Z0-9]{1,20}$/.test(serial)) {
        throw new Error("Invalid serial number");
      }

      console.log("in registerProducts fn 11", p.product_id);

      let productId = p.product_id || null;
      let productName = null;

      /* =====================================================
         SHOPIFY FLOW
         product_id already sent
      ===================================================== */
      if (flow === "shopify") {
        console.log("in registerProducts fn 22");

        if (!productId) {
          throw new Error("Missing product_id from frontend");
        }
        console.log("in registerProducts fn 33");

        const gid = productId.startsWith("gid://")
          ? productId
          : `gid://shopify/Product/${productId}`;

        console.log("in registerProducts fn 44", gid);

        const response = await client.request(
          `
          query($id: ID!) {
            product(id: $id) {
              title
              variants(first: 1) {
                nodes {
                  sku
                }
              }
            }
          }
        `,
          {
            variables: { id: gid },
          },
        );

        console.log("in registerProducts fn 55");

        productName = response.data.product.title;

        //        const productSku = response.variants?.nodes?.[0]?.sku || null;

        console.log("in registerProducts fn 66", productName);
      } else {
        /* =====================================================
         EXTERNAL FLOW
         resolve product id using Shopify search
      ===================================================== */
        productName = p.product_name;

        const response = await client.request(
          `
          query($query: String!) {
            products(first: 1, query: $query) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        `,
          {
            variables: {
              query: `title:"${productName}"`,
            },
          },
        );

        const found = response.data.products.edges[0];

        if (!found) {
          throw new Error(`Product not found in Shopify: ${productName}`);
        }

        productId = found.node.id; // gid
        productName = found.node.title;
      }

      console.log("in get fn productId", productId);

      const numericPId = productId.split("/").pop();

      console.log("In shopify_line_item_id 11 ", p.shopify_line_item_id);

      //const shopify_line_item_id = p.shopify_line_item_id.split("/").pop();
      const shopify_line_item_id = p.shopify_line_item_id
        ? p.shopify_line_item_id.split("/").pop()
        : null;

      /* =====================================================
      //    WARRANTY DURATION FROM DB
      ===================================================== */
      const [[durRow]] = await conn.query(
        `
        SELECT duration_months
        FROM product_standard_warranty_durations
        WHERE shop_id=? AND product_id=?
        `,
        [shopId, numericPId],
      );
      console.log("in registerProducts fn 77");

      if (!durRow) {
        throw new Error(
          `Warranty duration not configured for product ${numericPId}`,
        );
      }

      console.log("in registerProducts fn 88");

      const warrantyStart = today;

      console.log("in registerProducts fn 99");

      const warrantyEnd = new Date(
        today.getFullYear(),
        today.getMonth() + durRow.duration_months,
        today.getDate(),
      );

      console.log("in registerProducts fn 100100", warrantyEnd);

      /* =====================================================
         INSERT
      ===================================================== */
      await conn.query(
        `
        INSERT INTO registered_products (
          shop_id,
          customer_id,
          customer_email,
          customer_name,
          purchase_type,
          shopify_order_id,
          shopify_line_item_id,
          shopify_product_id,
          product_name,
          serial_number,
          retailer_name,
          purchase_date,
          warranty_start,
          warranty_end,
          consent_terms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
        [
          shopId,
          customerId,
          customer.email,
          customer.name || null,
          flow,

          p.shopify_order_id || null,
          shopify_line_item_id || null,
          numericPId,
          productName,
          serial,

          p.retailer_name || null,
          p.purchase_date || null,

          warrantyStart,
          warrantyEnd,
        ],
      );
    }

    console.log("in registerProducts fn 11 11 11");

    await conn.commit();

    console.log("in registerProducts fn 12 12");

    return res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);

    return res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
}

// export async function registerProducts(req, res) {

//   const session = res.locals.shopifySession;

//   if (!session?.shop) {
//     return res.status(401).json({ error: "Unauthorized" });
//   }

//   const { flow, products, customer, consent_terms } = req.body;

//   if (!flow || !products?.length || !customer?.email || !consent_terms) {
//     return res.status(400).json({ error: "Invalid request" });
//   }

//   /* ===============================
//      SHOP ID
//   =============================== */
//   const [[shopRow]] = await pool.query(
//     `SELECT id FROM shops WHERE shop_domain=? AND is_installed=TRUE`,
//     [session.shop]
//   );

//   if (!shopRow) return res.status(404).json({ error: "Shop not registered" });

//   const shopId = shopRow.id;

//   /* ===============================
//      CUSTOMER FROM BODY
//   =============================== */
//   const customerId = customer.id || null;
//   const customerEmail = customer.email;
//   const customerName = customer.name || null;

//   const conn = await pool.getConnection();
//   await conn.beginTransaction();

//   try {

//     const today = new Date();

//     const client = new shopify.api.clients.Graphql({ session });

//     for (const p of products) {

//       const serial = p.serial_number?.trim();

//       if (!/^[a-zA-Z0-9]{1,20}$/.test(serial)) {
//         throw new Error("Invalid serial number");
//       }

//       let productId;
//       let productName;

//       /* ==========================================
//          SHOPIFY FLOW
//       ========================================== */
//       if (flow === "shopify") {

//         if (!p.product_id) {
//           throw new Error("Missing product_id from frontend");
//         }

//         const gid = p.product_id.startsWith("gid://")
//           ? p.product_id
//           : `gid://shopify/Product/${p.product_id}`;

//         const response = await client.request(`
//           query($id: ID!) {
//             product(id: $id) {
//               title
//             }
//           }
//         `, { variables: { id: gid } });

//         productId = gid;
//         productName = response.data.product.title;
//       }

//       /* ==========================================
//          EXTERNAL FLOW
//       ========================================== */
//       else {

//         const response = await client.request(`
//           query($query: String!) {
//             products(first: 1, query: $query) {
//               edges {
//                 node {
//                   id
//                   title
//                 }
//               }
//             }
//           }
//         `, {
//           variables: { query: `title:"${p.product_name}"` }
//         });

//         const found = response.data.products.edges[0];

//         if (!found) {
//           throw new Error(`Product not found: ${p.product_name}`);
//         }

//         productId = found.node.id;
//         productName = found.node.title;
//       }

//       /* ===============================
//          SAFE CONVERSIONS
//       =============================== */
//       const numericPId = productId?.split("/").pop();

//       const shopifyOrderId = p.shopify_order_id || null;

//       const shopifyLineItemId = p.shopify_line_item_id
//         ? p.shopify_line_item_id.split("/").pop()
//         : null;

//       /* ===============================
//          WARRANTY DURATION
//       =============================== */
//       const [[durRow]] = await conn.query(
//         `
//         SELECT duration_months
//         FROM product_standard_warranty_durations
//         WHERE shop_id=? AND product_id=?
//         `,
//         [shopId, numericPId]
//       );

//       if (!durRow) {
//         throw new Error(`Warranty duration not configured for product ${numericPId}`);
//       }

//       /* ===============================
//          WARRANTY DATES
//       =============================== */
//       const warrantyStart = today;

//       const warrantyEnd = new Date(
//         warrantyStart.getFullYear(),
//         warrantyStart.getMonth() + durRow.duration_months,
//         warrantyStart.getDate()
//       );

//       /* ===============================
//          INSERT
//       =============================== */
//       await conn.query(
//         `
//         INSERT INTO registered_products (
//           shop_id,
//           customer_id,
//           customer_email,
//           customer_name,
//           purchase_type,
//           shopify_order_id,
//           shopify_line_item_id,
//           shopify_product_id,
//           product_name,
//           serial_number,
//           retailer_name,
//           purchase_date,
//           warranty_start,
//           warranty_end,
//           consent_terms
//         )
//         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
//         `,
//         [
//           shopId,
//           customerId,
//           customerEmail,
//           customerName,
//           flow,

//           shopifyOrderId,
//           shopifyLineItemId,
//           numericPId,
//           productName,
//           serial,

//           p.retailer_name || null,
//           p.purchase_date || null,

//           warrantyStart,
//           warrantyEnd
//         ]
//       );
//     }

//     await conn.commit();

//     return res.json({ success: true });
//     //email template

//   } catch (err) {

//     await conn.rollback();
//     console.error(err);

//     return res.status(500).json({ error: err.message });

//   } finally {
//     conn.release();
//   }
// }

export async function registerProductsOLDDesignWorking(req, res) {
  const session = res.locals.shopifySession;

  if (!session?.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { flow, products, customer, consent_terms } = req.body;

  if (!flow || !products?.length || !customer?.email || !consent_terms) {
    return res.status(400).json({ error: "Invalid request" });
  }

  /* ===============================
     SHOP ID
  =============================== */
  const [[shopRow]] = await pool.query(
    `SELECT id FROM shops WHERE shop_domain=? AND is_installed=TRUE`,
    [session.shop],
  );

  if (!shopRow) return res.status(404).json({ error: "Shop not registered" });

  const shopId = shopRow.id;

  /* ===============================
     CUSTOMER FROM BODY
  =============================== */
  const customerId = customer.id || null;
  const customerEmail = customer.email;
  const customerName = customer.name || null;

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const today = new Date();
    const client = new shopify.api.clients.Graphql({ session });

    // Collect products for email after commit
    const createdProducts = [];

    for (const p of products) {
      const serial = p.serial_number?.trim();

      if (!/^[a-zA-Z0-9]{1,20}$/.test(serial)) {
        throw new Error("Invalid serial number");
      }

      let productId;
      let productName;

      /* ===============================
       SHOPIFY FLOW
    =============================== */
      if (flow === "shopify") {
        if (!p.product_id) {
          throw new Error("Missing product_id from frontend");
        }

        const gid = p.product_id.startsWith("gid://")
          ? p.product_id
          : `gid://shopify/Product/${p.product_id}`;

        const response = await client.request(
          `
        query($id: ID!) {
          product(id: $id) {
            title
          }
        }
      `,
          { variables: { id: gid } },
        );

        if (!response.data.product) {
          throw new Error("Product not found in Shopify");
        }

        productId = gid;
        productName = response.data.product.title;
      } else {
        /* ===============================
       EXTERNAL FLOW
    =============================== */
        const response = await client.request(
          `
        query($query: String!) {
          products(first: 1, query: $query) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      `,
          { variables: { query: `title:"${p.product_name}"` } },
        );

        const found = response.data.products.edges[0];

        if (!found) {
          throw new Error(`Product not found: ${p.product_name}`);
        }

        productId = found.node.id;
        productName = found.node.title;
      }

      /* ===============================
       SAFE CONVERSIONS
    =============================== */
      const numericPId = productId.split("/").pop();

      const shopifyOrderId = p.shopify_order_id || null;
      const shopifyLineItemId = p.shopify_line_item_id
        ? p.shopify_line_item_id.split("/").pop()
        : null;

      /* ===============================
       WARRANTY DURATION
    =============================== */
      const [[durRow]] = await conn.query(
        `
      SELECT duration_months
      FROM product_standard_warranty_durations
      WHERE shop_id=? AND product_id=?
      `,
        [shopId, numericPId],
      );

      if (!durRow) {
        throw new Error(
          `Warranty duration not configured for product ${numericPId}`,
        );
      }

      /* ===============================
       WARRANTY DATES
    =============================== */
      const warrantyStart = today;
      const warrantyEnd = new Date(
        warrantyStart.getFullYear(),
        warrantyStart.getMonth() + durRow.duration_months,
        warrantyStart.getDate(),
      );

      /* ===============================
       INSERT REGISTERED PRODUCT
    =============================== */
      await conn.query(
        `
      INSERT INTO registered_products (
        shop_id,
        customer_id,
        customer_email,
        customer_name,
        purchase_type,
        shopify_order_id,
        shopify_line_item_id,
        shopify_product_id,
        product_name,
        serial_number,
        retailer_name,
        purchase_date,
        warranty_start,
        warranty_end,
        consent_terms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
        [
          shopId,
          customerId,
          customerEmail,
          customerName,
          flow,
          shopifyOrderId,
          shopifyLineItemId,
          numericPId,
          productName,
          serial,
          p.retailer_name || null,
          p.purchase_date || null,
          warrantyStart,
          warrantyEnd,
        ],
      );

      // Save for email after commit
      createdProducts.push({
        productName,
        shopifyOrderId,
        purchaseDate: p.purchase_date,
        warrantyStart,
        warrantyEnd,
      });
    }

    /* ===============================
     COMMIT TRANSACTION
  =============================== */
    await conn.commit();

    /* ===============================
     SEND CONFIRMATION EMAILS
  =============================== */
    try {
      const subject = "Warranty registration confirmation";

      // await Promise.all(
      //   createdProducts.map(async (cp) => {
      //     try {
      //       const html = WarrantyRegistrationSuccessTemplate({
      //         customerName,
      //         productTitle: cp.productName,
      //         orderNumber: cp.shopifyOrderId || "-",
      //         purchaseDate: cp.purchaseDate
      //           ? new Date(cp.purchaseDate).toISOString().split("T")[0]
      //           : new Date(cp.warrantyStart).toISOString().split("T")[0],
      //         warrantyPeriod: `${new Date(cp.warrantyStart)
      //           .toISOString()
      //           .split("T")[0]} to ${new Date(cp.warrantyEnd)
      //           .toISOString()
      //           .split("T")[0]}`,
      //       });

      //       await sendMail({
      //         to: customerEmail,
      //         subject,
      //         html,
      //       });
      //     } catch (mailErr) {
      //       console.error(
      //         "⚠️ Failed to send email for product:",
      //         cp.productName,
      //         mailErr
      //       );
      //     }
      //   })
      // );
    } catch (e) {
      console.error("⚠️ Email processing error:", e);
    }

    return res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Registration failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

function addMonthsSafe(startDate, months) {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const day = startDate.getDate();

  const targetMonth = month + months;

  const lastDayOfTargetMonth = new Date(year, targetMonth + 1, 0).getDate();

  const safeDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(year, targetMonth, safeDay);
}

export async function registerProducts(req, res) {
  const session = res.locals.shopifySession;

  if (!session?.shop) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { flow, products, customer, consent_privacy, consent_confirm } =
    req.body;

  if (
    !flow ||
    !products?.length ||
    !customer?.email ||
    !consent_privacy ||
    !consent_confirm
  ) {
    return res.status(400).json({ error: "Invalid request" });
  }

  try {
    /* ===============================
       GET SHOP ID FROM DB
    =============================== */
    const [[shopRow]] = await pool.query(
      `SELECT id FROM shops WHERE shop_domain=? AND is_installed=TRUE`,
      [session.shop],
    );

    if (!shopRow) return res.status(404).json({ error: "Shop not registered" });

    const shopId = shopRow.id;

    /* ===============================
       CUSTOMER DATA (prefer logged-in Shopify customer)
    =============================== */
    const client = new shopify.api.clients.Graphql({ session });
    const resolvedCustomer = await resolveShopifyCustomer(
      client,
      req.query.logged_in_customer_id,
      customer
    );
    const customerId = resolvedCustomer.customerId;
    let customerEmail = resolvedCustomer.customerEmail;
    const customerName = resolvedCustomer.customerName;

    if (flow === "external" && customer?.email) {
      customerEmail = normalizeEmail(customer.email);
    }

    if (!customerEmail || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
      return res.status(400).json({ error: "Invalid customer email" });
    }

    /* ===============================
       FETCH SHOP ADMIN EMAIL (Dynamic)
    =============================== */
    const shopResponse = await client.request(`
      query {
        shop {
          name
          email
        }
      }
    `);

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      const today = new Date();
      const createdProducts = [];

      for (const p of products) {
        /* ===============================
          SERIAL NUMBER DUPLICATE CHECK
        =============================== */
        const [[serialExists]] = await conn.query(
          `
          SELECT id
          FROM registered_products
          WHERE shop_id = ?
            AND serial_number = ?
          LIMIT 1
          `,
          [shopId, p.serial_number?.trim()],
        );

        if (serialExists) {
          return res.status(409).json({
            success: false,
            message: `Product Serial Number already registered.`,
          });
        }

        const serial = p.serial_number?.trim();

        if (!/^[a-zA-Z0-9]{1,20}$/.test(serial)) {
          throw new Error("Invalid serial number");
        }

        let productId;
        let productName;

        /* ===============================
           SHOPIFY FLOW
        =============================== */
        if (flow === "shopify") {
          if (!p.product_id) {
            throw new Error("Missing product_id");
          }

          const gid = p.product_id.startsWith("gid://")
            ? p.product_id
            : `gid://shopify/Product/${p.product_id}`;

          const response = await client.request(
            `
            query($id: ID!) {
              product(id: $id) {
                title
              }
            }
            `,
            { variables: { id: gid } },
          );

          if (!response.data.product) {
            throw new Error("Product not found in Shopify");
          }

          productId = gid;
          productName = response.data.product.title;
        } else {
          /* ===============================
             EXTERNAL FLOW
          =============================== */
          if (p.product_id) {
            const gid = p.product_id.startsWith("gid://")
              ? p.product_id
              : `gid://shopify/Product/${p.product_id}`;

            const response = await client.request(
              `
              query($id: ID!) {
                product(id: $id) {
                  id
                  title
                }
              }
              `,
              { variables: { id: gid } },
            );

            if (!response.data?.product) {
              throw new Error(
                `Product not found: ${p.product_name || p.product_id}`,
              );
            }

            productId = response.data.product.id;
            productName = response.data.product.title;
          } else if (p.product_name) {
            const response = await client.request(
              `
              query($query: String!) {
                products(first: 1, query: $query) {
                  edges {
                    node {
                      id
                      title
                    }
                  }
                }
              }
              `,
              { variables: { query: `title:"${p.product_name}"` } },
            );

            const found = response.data.products.edges[0];

            if (!found) {
              throw new Error(`Product not found: ${p.product_name}`);
            }

            productId = found.node.id;
            productName = found.node.title;
          } else {
            throw new Error("Product name or product ID is required");
          }
        }

        const numericPId = productId.split("/").pop();
        const variantNumericId = p.variant_id
          ? getNumericIdFromGid(
              p.variant_id.startsWith("gid://")
                ? p.variant_id
                : `gid://shopify/ProductVariant/${p.variant_id}`
            )
          : null;

        /* ===============================
           WARRANTY DURATION
        =============================== */
        const [[durRow]] = await conn.query(
          `
          SELECT duration_months
          FROM product_standard_warranty_durations
          WHERE shop_id=? AND product_id=?
          `,
          [shopId, numericPId],
        );

        if (!durRow) {
          throw new Error(
            `Warranty duration not configured for product ${numericPId}`,
          );
        }

        const warrantyStart = p.purchase_date ? new Date(p.purchase_date) : today;
        /*const warrantyEnd = new Date(
          warrantyStart.getFullYear(),
          warrantyStart.getMonth() + durRow.duration_months,
          warrantyStart.getDate()
        );*/

        // ✅ FIXED: safe month addition
        const warrantyEnd = addMonthsSafe(
          warrantyStart,
          durRow.duration_months,
        );

        /* ===============================
           INSERT REGISTERED PRODUCT
        =============================== */
        const [insertResult] = await conn.query(
          `
          INSERT INTO registered_products (
            shop_id,
            customer_id,
            customer_email,
            customer_name,
            purchase_type,
            shopify_order_id,
            shopify_line_item_id,
            shopify_product_id,
            shopify_variant_id,
            sku,
            product_name,
            serial_number,
            retailer_name,
            purchase_date,
            warranty_start,
            warranty_end,
            consent_terms,
            consent_marketing
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            shopId,
            customerId,
            normalizeEmail(customerEmail),
            customerName,
            flow,
            p.shopify_order_id || null,
            p.shopify_line_item_id
              ? p.shopify_line_item_id.split("/").pop()
              : null,
            numericPId,
            variantNumericId ? String(variantNumericId) : null,
            p.sku || null,
            productName,
            serial,
            p.retailer_name || null,
            p.purchase_date || null,
            warrantyStart,
            warrantyEnd,
            consent_privacy,
            consent_confirm,
          ],
        );

        createdProducts.push({
          registerId: insertResult.insertId,
          productName,
          productId: numericPId,
          variantId: variantNumericId,
          orderNumber: p.shopify_order_id,
          purchaseDate: p.purchase_date,
          serialNumber: serial,
          warrantyStart,
          warrantyEnd,
        });
      }

      await conn.commit();

      const emailSubject = "Your Product Warranty Registration is Completed.";

      const firstProduct = createdProducts[0];

      const diffMonths =
        (firstProduct.warrantyEnd.getFullYear() -
          firstProduct.warrantyStart.getFullYear()) *
          12 +
        (firstProduct.warrantyEnd.getMonth() -
          firstProduct.warrantyStart.getMonth());

      const warrantyPeriodText = `${diffMonths} Months`;
      const emailHtml = WarrantyRegistrationSuccessTemplate({
        customerName: customerName || "Customer",
        productTitle: firstProduct.productName,
        orderNumber: firstProduct.orderNumber || "N/A",
        warrantyPeriod: warrantyPeriodText,
      });

      // const dynamicFrom = shopSenderEmail
      //   ? `${shopName} <${shopSenderEmail}>`
      //   : process.env.DEFAULT_FROM_EMAIL;

      const dynamicFrom = process.env.DEFAULT_FROM_EMAIL;

      console.log("From email:", dynamicFrom);

      const emailResult = await sendEmailService({
        to: customerEmail,
        subject: emailSubject,
        html: emailHtml,
        from: dynamicFrom,
      });

      if (!emailResult.success) {
        if (emailResult.skipped) {
          console.warn("Registration email skipped (SendGrid not configured)", {
            flow,
            to: customerEmail,
            mode: process.env.EMAIL_MODE,
          });
        } else {
          console.error("Registration succeeded but email failed:", {
            flow,
            to: customerEmail,
            from: dynamicFrom,
            error: emailResult.error,
            statusCode: emailResult.statusCode,
          });
        }
      } else {
        console.log("Registration email accepted:", {
          flow,
          to: customerEmail,
          messageId: emailResult.messageId,
          testMode: emailResult.testMode || false,
        });
      }

      const primaryRegistration = createdProducts[0];
      let extendedWarrantyOffer = null;
      if (primaryRegistration?.registerId) {
        extendedWarrantyOffer = await buildExtendedWarrantyOffer(
          shopId,
          primaryRegistration.registerId,
          { session }
        );
      }

      const postRegistrationNavigation = {
        next: extendedWarrantyOffer?.eligible ? "extended_warranty" : "my_products",
        reason: extendedWarrantyOffer?.reason || null,
        purchaseWindow: extendedWarrantyOffer?.purchaseWindow || null,
      };

      return res.json({
        success: true,
        registrations: createdProducts,
        showExtendedWarrantyOffer: Boolean(
          extendedWarrantyOffer?.eligible
        ),
        extendedWarrantyOffer,
        postRegistrationNavigation,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("❌ Registration failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
