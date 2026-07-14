import shopify from "../shopify.js";
import { pool } from "../db/mysql.js";
import { getNumericIdFromGid } from "./extendedWarranty.service.js";

const CONTAINER_HANDLE_PREFIX = "extended-warranty-plans-app-managed";
const CONTAINER_TITLE = "Extended Warranty Plans (App managed — do not edit)";
const CONTAINER_TAG = "_warranty_app_managed";

function toVariantGid(variantId) {
  return String(variantId).startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;
}

function toProductGid(productId) {
  return String(productId).startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;
}

async function findContainerProduct(admin, handle) {
  const response = await admin.request(
    `
    query WarrantyContainerProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
      }
    }
    `,
    { variables: { handle } }
  );
  return response.data?.productByHandle?.id || null;
}

async function createContainerProduct(admin, handle) {
  const response = await admin.request(
    `
    mutation WarrantyContainerProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }
    `,
    {
      variables: {
        product: {
          title: CONTAINER_TITLE,
          handle,
          productType: "Extended Warranty",
          tags: [CONTAINER_TAG],
          status: "ACTIVE",
        },
      },
    }
  );

  const payload = response.data?.productCreate;
  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map(e => e.message).join(", "));
  }
  return payload?.product?.id || null;
}

async function publishToOnlineStore(admin, productGid) {
  try {
    const pubResponse = await admin.request(
      `query WarrantyAppPublications { publications(first: 10) { edges { node { id name } } } }`
    );
    const onlineStore = (pubResponse.data?.publications?.edges || []).find(
      edge => edge.node?.name === "Online Store"
    );
    if (!onlineStore) return;

    await admin.request(
      `
      mutation WarrantyProductPublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
      `,
      { variables: { id: productGid, input: [{ publicationId: onlineStore.node.id }] } }
    );
  } catch (err) {
    // Publishing requires the `write_publications` scope. If it's missing,
    // the variant still gets created but may not be addable via /cart/add.js
    // until the merchant re-approves the app's scopes — non-fatal.
    console.warn("⚠️ Extended warranty variant publish skipped:", err.message);
  }
}

async function getOrCreateContainerProduct(admin, shopId) {
  const handle = `${CONTAINER_HANDLE_PREFIX}-${shopId}`;
  let productGid = await findContainerProduct(admin, handle);
  if (!productGid) {
    productGid = await createContainerProduct(admin, handle);
    if (productGid) {
      await publishToOnlineStore(admin, productGid);
    }
  }
  return productGid;
}

async function createVariant(admin, productGid, planRow) {
  const response = await admin.request(
    `
    mutation WarrantyVariantCreate(
      $productId: ID!
      $variants: [ProductVariantsBulkInput!]!
      $strategy: ProductVariantsBulkCreateStrategy
    ) {
      productVariantsBulkCreate(
        productId: $productId
        variants: $variants
        strategy: $strategy
      ) {
        productVariants { id }
        userErrors { field message }
      }
    }
    `,
    {
      variables: {
        productId: productGid,
        // Cleans up the auto-generated "Default Title" variant Shopify puts
        // on every newly created product — safe to always pass, it's a
        // no-op once the container product only has app-managed variants.
        strategy: "REMOVE_STANDALONE_VARIANT",
        variants: [
          {
            price: String(planRow.price),
            optionValues: [
              { optionName: "Plan", name: `${planRow.plan_name} (#${planRow.id})` },
            ],
            inventoryPolicy: "CONTINUE",
            inventoryItem: { sku: `EW-${planRow.id}`, tracked: false },
          },
        ],
      },
    }
  );

  const payload = response.data?.productVariantsBulkCreate;
  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map(e => e.message).join(", "));
  }
  return payload?.productVariants?.[0]?.id || null;
}

async function updateVariantPrice(admin, productGid, variantGid, planRow) {
  const response = await admin.request(
    `
    mutation WarrantyVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
    `,
    {
      variables: {
        productId: productGid,
        variants: [{ id: variantGid, price: String(planRow.price) }],
      },
    }
  );

  const payload = response.data?.productVariantsBulkUpdate;
  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map(e => e.message).join(", "));
  }
}

/**
 * Automatically creates (once) and keeps in sync a real, sellable Shopify
 * product variant for a warranty plan, so PDP/Cart can add it to the
 * native Shopify cart via the AJAX Cart API. Best-effort: any failure is
 * logged and returned as `{ success: false }` — it never throws, so it can
 * never block an admin plan save. Until it succeeds, PDP/Cart simply hide
 * that plan; the existing draft-order registration offer is unaffected
 * since it doesn't depend on this variant at all.
 */
export async function ensureCheckoutVariantForPlan(session, shopId, planRow) {
  if (!session?.shop) {
    return { success: false, error: "No session available" };
  }

  try {
    const admin = new shopify.api.clients.Graphql({ session });

    if (planRow.shopify_checkout_variant_id) {
      const productGid = planRow.shopify_checkout_product_id
        ? toProductGid(planRow.shopify_checkout_product_id)
        : await getOrCreateContainerProduct(admin, shopId);
      if (!productGid) throw new Error("Could not resolve container product");

      await updateVariantPrice(
        admin,
        productGid,
        toVariantGid(planRow.shopify_checkout_variant_id),
        planRow
      );

      await pool.query(
        `UPDATE extended_warranty_plans SET checkout_variant_synced_at = CURRENT_TIMESTAMP WHERE shop_id = ? AND id = ?`,
        [shopId, planRow.id]
      );

      return {
        success: true,
        variantId: planRow.shopify_checkout_variant_id,
        productId: getNumericIdFromGid(productGid),
      };
    }

    const productGid = await getOrCreateContainerProduct(admin, shopId);
    if (!productGid) throw new Error("Could not create container product");

    const variantGid = await createVariant(admin, productGid, planRow);
    if (!variantGid) throw new Error("Variant creation returned no id");

    const variantNumericId = getNumericIdFromGid(variantGid);
    const productNumericId = getNumericIdFromGid(productGid);

    await pool.query(
      `
      UPDATE extended_warranty_plans
      SET shopify_checkout_variant_id = ?,
          shopify_checkout_product_id = ?,
          checkout_variant_synced_at = CURRENT_TIMESTAMP
      WHERE shop_id = ? AND id = ?
      `,
      [variantNumericId, productNumericId, shopId, planRow.id]
    );

    return { success: true, variantId: variantNumericId, productId: productNumericId };
  } catch (err) {
    console.warn(
      `⚠️ ensureCheckoutVariantForPlan failed for plan ${planRow?.id}:`,
      err.message
    );
    return { success: false, error: err.message };
  }
}

/** Fire-and-forget wrapper for callers that must not await/slow down the response. */
export function ensureCheckoutVariantForPlanAsync(session, shopId, planRow) {
  ensureCheckoutVariantForPlan(session, shopId, planRow).catch(err => {
    console.warn("⚠️ ensureCheckoutVariantForPlanAsync error:", err.message);
  });
}
