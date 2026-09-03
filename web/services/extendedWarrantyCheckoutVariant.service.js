import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { getNumericIdFromGid } from "./extendedWarranty.service.js";

const WARRANTY_PRODUCT_HANDLE = "sennheiser-extended-warranty";
const WARRANTY_PRODUCT_TITLE = "Extended Warranty";
const WARRANTY_OPTION_NAME = "Plan";

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid warranty plan price");
  }
  return amount.toFixed(2);
}

function checkoutSku({ durationMonths, price, currency }) {
  const months = Number(durationMonths);
  const money = formatMoney(price);
  const code = String(currency || "INR").trim().toUpperCase() || "INR";
  return `EW-${months}-${money}-${code}`;
}

function checkoutOptionValue({ planName, price, currency }) {
  const money = formatMoney(price);
  const code = String(currency || "INR").trim().toUpperCase() || "INR";
  const name = String(planName || "Extended Warranty").trim() || "Extended Warranty";
  return `${name} · ${money} ${code}`.slice(0, 255);
}

function assertUserErrors(payload, label) {
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new Error(`${label}: ${errors.map((error) => error.message).join(", ")}`);
  }
}

function toNumericId(value) {
  return getNumericIdFromGid(value) || Number(value) || null;
}

function isUsableCheckoutVariant(checkoutVariantId, parentVariantId) {
  const checkoutId = toNumericId(checkoutVariantId);
  const parentId = toNumericId(parentVariantId);
  if (!checkoutId) return false;
  if (parentId && checkoutId === parentId) return false;
  return true;
}

async function getOfflineSession(session) {
  if (!session?.shop) return session;
  try {
    const sessions = await shopify.config.sessionStorage.findSessionsByShop(session.shop);
    return sessions?.find((item) => item.isOnline === false) || session;
  } catch {
    return session;
  }
}

function graphqlData(result) {
  return result?.data || result?.body?.data || result;
}

async function adminRequest(admin, query, variables) {
  const result = await admin.request(query, variables ? { variables } : undefined);
  return graphqlData(result);
}

function mapVariantNode(node) {
  if (!node?.id) return null;
  return {
    id: toNumericId(node.id),
    gid: node.id,
    sku: node.sku || "",
    price: node.price,
    title: node.title,
  };
}

async function loadProductVariants(admin, productGid) {
  const variants = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await adminRequest(
      admin,
      `
      query WarrantyProductVariants($id: ID!, $cursor: String) {
        product(id: $id) {
          id
          handle
          status
          variants(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              sku
              price
              title
            }
          }
        }
      }
      `,
      { id: productGid, cursor }
    );

    const product = data?.product;
    if (!product) return { product: null, variants: [] };

    for (const node of product.variants?.nodes || []) {
      const mapped = mapVariantNode(node);
      if (mapped) variants.push(mapped);
    }

    hasNextPage = Boolean(product.variants?.pageInfo?.hasNextPage);
    cursor = product.variants?.pageInfo?.endCursor || null;
    if (!hasNextPage) {
      return { product, variants };
    }
  }

  return { product: null, variants };
}

async function findWarrantyProduct(admin, storedProductId) {
  if (storedProductId) {
    const gid = String(storedProductId).startsWith("gid://")
      ? storedProductId
      : `gid://shopify/Product/${storedProductId}`;
    const loaded = await loadProductVariants(admin, gid);
    if (loaded.product) return loaded;
  }

  const data = await adminRequest(
    admin,
    `
    query WarrantyProductByHandle($query: String!) {
      products(first: 1, query: $query) {
        nodes { id }
      }
    }
    `,
    { query: `handle:${WARRANTY_PRODUCT_HANDLE}` }
  );

  const existingId = data?.products?.nodes?.[0]?.id;
  if (!existingId) return { product: null, variants: [] };
  return loadProductVariants(admin, existingId);
}

async function publishToOnlineStore(admin, productGid) {
  try {
    const data = await adminRequest(
      admin,
      `
      query Publications {
        publications(first: 20) {
          nodes {
            id
            name
          }
        }
      }
      `
    );
    const publication = (data?.publications?.nodes || []).find((item) =>
      /online store/i.test(item.name || "")
    );
    if (!publication?.id) return;

    const publishData = await adminRequest(
      admin,
      `
      mutation PublishWarrantyProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
      `,
      { id: productGid, input: [{ publicationId: publication.id }] }
    );
    assertUserErrors(publishData?.publishablePublish, "publishablePublish");
  } catch (err) {
    console.warn("⚠️ Could not publish warranty product to Online Store:", err.message);
  }
}

async function createWarrantyProduct(admin, optionValue) {
  const data = await adminRequest(
    admin,
    `
    mutation CreateWarrantyProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          handle
          status
          variants(first: 1) {
            nodes { id sku price title }
          }
        }
        userErrors { field message }
      }
    }
    `,
    {
      product: {
        title: WARRANTY_PRODUCT_TITLE,
        handle: WARRANTY_PRODUCT_HANDLE,
        status: "ACTIVE",
        vendor: "Sennheiser",
        productType: "Extended Warranty",
        descriptionHtml:
          "<p>Extended warranty coverage added with an eligible product at checkout.</p>",
        tags: ["extended-warranty", "hidden"],
        productOptions: [
          {
            name: WARRANTY_OPTION_NAME,
            values: [{ name: optionValue }],
          },
        ],
        metafields: [
          {
            namespace: "seo",
            key: "hidden",
            type: "number_integer",
            value: "1",
          },
        ],
      },
    }
  );

  assertUserErrors(data?.productCreate, "productCreate");
  const product = data?.productCreate?.product;
  if (!product?.id) {
    throw new Error("Shopify did not return a warranty product id");
  }

  await publishToOnlineStore(admin, product.id);
  return product;
}

async function updateVariant(admin, productGid, variantGid, { price, sku }) {
  const data = await adminRequest(
    admin,
    `
    mutation UpdateWarrantyVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          price
          title
        }
        userErrors { field message }
      }
    }
    `,
    {
      productId: productGid,
      variants: [
        {
          id: variantGid,
          price,
          inventoryPolicy: "CONTINUE",
          inventoryItem: {
            sku,
            tracked: false,
            requiresShipping: false,
          },
        },
      ],
    }
  );

  assertUserErrors(data?.productVariantsBulkUpdate, "productVariantsBulkUpdate");
  const variant = data?.productVariantsBulkUpdate?.productVariants?.[0];
  const mapped = mapVariantNode(variant);
  if (!mapped?.id) {
    throw new Error("Failed to update warranty checkout variant");
  }
  return mapped;
}

async function createVariant(admin, productGid, { price, sku, optionValue }) {
  const data = await adminRequest(
    admin,
    `
    mutation CreateWarrantyVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          price
          title
        }
        userErrors { field message }
      }
    }
    `,
    {
      productId: productGid,
      variants: [
        {
          price,
          optionValues: [{ optionName: WARRANTY_OPTION_NAME, name: optionValue }],
          inventoryPolicy: "CONTINUE",
          inventoryItem: {
            sku,
            tracked: false,
            requiresShipping: false,
          },
        },
      ],
    }
  );

  assertUserErrors(data?.productVariantsBulkCreate, "productVariantsBulkCreate");
  const variant = data?.productVariantsBulkCreate?.productVariants?.[0];
  const mapped = mapVariantNode(variant);
  if (!mapped?.id) {
    throw new Error("Failed to create warranty checkout variant");
  }
  return mapped;
}

async function saveCheckoutProductId(shopId, productNumericId) {
  try {
    await pool.query(
      `
      INSERT INTO extended_warranty_settings (shop_id, shopify_checkout_product_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        shopify_checkout_product_id = VALUES(shopify_checkout_product_id),
        updated_at = CURRENT_TIMESTAMP
      `,
      [shopId, productNumericId]
    );
  } catch (err) {
    console.warn("⚠️ Could not store shopify_checkout_product_id on settings:", err.message);
  }
}

async function savePlanCheckoutVariant({
  shopId,
  planId,
  productNumericId,
  variantNumericId,
}) {
  try {
    await pool.query(
      `
      UPDATE extended_warranty_plans
      SET
        shopify_checkout_variant_id = ?,
        shopify_checkout_product_id = ?,
        checkout_variant_synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ?
        AND id = ?
      `,
      [variantNumericId, productNumericId, shopId, planId]
    );
  } catch (err) {
    await pool.query(
      `
      UPDATE extended_warranty_plans
      SET
        shopify_checkout_variant_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE shop_id = ?
        AND id = ?
      `,
      [variantNumericId, shopId, planId]
    );
    console.warn("⚠️ Saved checkout variant id only:", err.message);
  }
}

/**
 * Creates or reuses a Shopify warranty variant for nested cart checkout.
 * The variant is never the customer's product variant.
 */
export async function ensurePlanCheckoutVariant({
  session,
  shopId,
  plan,
  parentVariantId,
} = {}) {
  const planId = Number(plan?.planId || plan?.plan_id);
  if (!session?.shop || !shopId || !planId) {
    throw new Error("session, shopId, and planId are required");
  }

  const writeSession = await getOfflineSession(session);
  const admin = new shopify.api.clients.Graphql({ session: writeSession });
  const price = formatMoney(plan.price ?? plan.calculatedPrice);
  const sku = checkoutSku({
    durationMonths: plan.durationMonths ?? plan.duration_months,
    price,
    currency: plan.currency,
  });
  const optionValue = checkoutOptionValue({
    planName: plan.planName || plan.plan_name,
    price,
    currency: plan.currency,
  });

  const [[settings]] = await pool.query(
    `
    SELECT shopify_checkout_product_id
    FROM extended_warranty_settings
    WHERE shop_id = ?
    `,
    [shopId]
  );

  let { product, variants } = await findWarrantyProduct(
    admin,
    settings?.shopify_checkout_product_id
  );

  if (!product) {
    try {
      product = await createWarrantyProduct(admin, optionValue);
      variants = (product.variants?.nodes || []).map(mapVariantNode).filter(Boolean);
    } catch (err) {
      const existing = await findWarrantyProduct(admin, null);
      if (!existing.product) throw err;
      product = existing.product;
      variants = existing.variants;
    }
  }

  const productNumericId = toNumericId(product.id);
  if (!productNumericId) {
    throw new Error("Could not resolve warranty product id");
  }
  await saveCheckoutProductId(shopId, productNumericId);

  let variant = variants.find((item) => item.sku === sku);
  if (!variant && variants.length === 1 && !variants[0].sku) {
    variant = await updateVariant(admin, product.id, variants[0].gid, { price, sku });
  } else if (!variant) {
    variant = await createVariant(admin, product.id, { price, sku, optionValue });
  } else if (String(variant.price) !== price) {
    variant = await updateVariant(admin, product.id, variant.gid, { price, sku });
  }

  if (!isUsableCheckoutVariant(variant.id, parentVariantId)) {
    throw new Error("Provisioned warranty variant matches the product variant");
  }

  await savePlanCheckoutVariant({
    shopId,
    planId,
    productNumericId,
    variantNumericId: variant.id,
  });

  try {
    await ensureWarrantyVariantPurchasable({
      session: writeSession,
      variantId: variant.id,
    });
  } catch (err) {
    console.warn("⚠️ Could not force warranty variant purchasable during provision:", err.message);
  }

  console.log("✅ Provisioned warranty checkout variant", {
    planId,
    sku,
    warrantyProductId: productNumericId,
    warrantyVariantId: variant.id,
  });

  return variant.id;
}

/**
 * Extended warranty variants are not physical inventory. Force CONTINUE +
 * untracked so Shopify does not return 422 "already sold out".
 */
export async function ensureWarrantyVariantPurchasable({ session, variantId } = {}) {
  const numericId = toNumericId(variantId);
  if (!session?.shop || !numericId) return null;

  const writeSession = await getOfflineSession(session);
  const admin = new shopify.api.clients.Graphql({ session: writeSession });
  const variantGid = String(variantId).startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${numericId}`;

  const data = await adminRequest(
    admin,
    `
    query WarrantyVariantAvailability($id: ID!) {
      productVariant(id: $id) {
        id
        inventoryPolicy
        availableForSale
        product { id }
        inventoryItem { id tracked }
      }
    }
    `,
    { id: variantGid }
  );

  const variant = data?.productVariant;
  if (!variant?.id) {
    throw new Error(`Warranty checkout variant ${numericId} was not found`);
  }

  const tracked = Boolean(variant.inventoryItem?.tracked);
  const policy = String(variant.inventoryPolicy || "").toUpperCase();
  if (!tracked && policy === "CONTINUE") {
    return numericId;
  }

  console.warn("[EW Checkout] Warranty variant is not freely purchasable; updating inventory settings", {
    variantId: numericId,
    inventoryPolicy: variant.inventoryPolicy,
    tracked,
    availableForSale: variant.availableForSale,
  });

  if (variant.inventoryItem?.id && tracked) {
    const itemData = await adminRequest(
      admin,
      `
      mutation UntrackWarrantyInventory($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }
      `,
      { id: variant.inventoryItem.id, input: { tracked: false } }
    );
    assertUserErrors(itemData?.inventoryItemUpdate, "inventoryItemUpdate");
  }

  if (variant.product?.id && policy !== "CONTINUE") {
    const policyData = await adminRequest(
      admin,
      `
      mutation ContinueWarrantySales($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id inventoryPolicy }
          userErrors { field message }
        }
      }
      `,
      {
        productId: variant.product.id,
        variants: [{ id: variant.id, inventoryPolicy: "CONTINUE" }],
      }
    );
    assertUserErrors(policyData?.productVariantsBulkUpdate, "productVariantsBulkUpdate");
  }

  return numericId;
}

export { isUsableCheckoutVariant };
