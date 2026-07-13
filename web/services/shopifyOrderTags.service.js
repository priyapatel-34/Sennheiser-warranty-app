import shopify from "../shopify.js";

export const STANDARD_WARRANTY_ORDER_TAG = "Standard Warranty";
export const EXTENDED_WARRANTY_ORDER_TAG = "Extended Warranty";

/** Customer-facing Shopify order tags only — no internal registration tags. */
export const WARRANTY_ORDER_TAGS = [
  STANDARD_WARRANTY_ORDER_TAG,
  EXTENDED_WARRANTY_ORDER_TAG,
];

export const WARRANTY_TAG_TYPES = {
  STANDARD: "standard",
  /** Original product order after EW purchase — Standard + Extended. */
  EXTENDED_PRODUCT: "extended_product",
  /** EW purchase order only — Extended Warranty tag alone. */
  EXTENDED_PURCHASE: "extended_purchase",
};

const INTERNAL_ORDER_TAG_PATTERNS = [
  /^ew-register-\d+$/i,
  /^sw-register-\d+$/i,
  /^registration-/i,
  /^extended-warranty$/i,
  /^extended-warranty-plan$/i,
];

function isInternalOrderTag(tag) {
  const normalized = String(tag || "").trim();
  if (!normalized) return false;
  return INTERNAL_ORDER_TAG_PATTERNS.some(pattern => pattern.test(normalized));
}

export function normalizeOrderId(orderId) {
  if (orderId == null) return null;
  const str = String(orderId).trim();
  if (!str) return null;
  if (str.startsWith("gid://")) {
    return str.split("/").pop();
  }
  return str;
}

function orderIdsMatch(left, right) {
  const a = normalizeOrderId(left);
  const b = normalizeOrderId(right);
  return Boolean(a && b && a === b);
}

async function getShopSession(shop) {
  const sessions = await shopify.config.sessionStorage.findSessionsByShop(shop);
  return sessions?.[0] || null;
}

function toOrderGid(orderId) {
  const numeric = normalizeOrderId(orderId);
  return numeric ? `gid://shopify/Order/${numeric}` : null;
}

function parseTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map(tag => String(tag).trim()).filter(Boolean);
  }
  return String(tags || "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}

function sanitizeOrderTags(tags) {
  return parseTags(tags).filter(tag => !isInternalOrderTag(tag));
}

function getRequiredTags(warrantyType) {
  switch (warrantyType) {
    case WARRANTY_TAG_TYPES.EXTENDED_PRODUCT:
      return [STANDARD_WARRANTY_ORDER_TAG, EXTENDED_WARRANTY_ORDER_TAG];
    case WARRANTY_TAG_TYPES.EXTENDED_PURCHASE:
      return [EXTENDED_WARRANTY_ORDER_TAG];
    case WARRANTY_TAG_TYPES.STANDARD:
    default:
      return [STANDARD_WARRANTY_ORDER_TAG];
  }
}

function mergeTags(existingTags, requiredTags) {
  const merged = [...existingTags];
  for (const tag of requiredTags) {
    if (!merged.includes(tag)) {
      merged.push(tag);
    }
  }
  return merged;
}

function tagsAreComplete(currentTags, requiredTags) {
  return requiredTags.every(tag => currentTags.includes(tag));
}

function getGraphqlErrors(result) {
  if (!result?.errors?.length) return null;
  return result.errors.map(error => error.message).join(", ");
}

/**
 * Append customer-facing warranty tags to a Shopify order.
 * Strips legacy internal tags (ew-register-*, extended-warranty, etc.).
 * Never throws — failures are logged and returned in the result object.
 */
export async function updateShopifyOrderTags(
  shop,
  orderId,
  warrantyType,
  session = null
) {
  const shopDomain = String(shop || "").trim();
  const numericOrderId = normalizeOrderId(orderId);

  if (!numericOrderId) {
    console.log(
      "[Order Tags] Skipping update — external registration has no Shopify order."
    );
    return { success: false, skipped: true, reason: "no_order_id" };
  }

  if (!shopDomain) {
    console.error(
      "[Order Tags] Unable to update tags — missing shop domain.",
      { orderId: numericOrderId, warrantyType }
    );
    return { success: false, skipped: true, reason: "no_shop" };
  }

  const orderGid = toOrderGid(numericOrderId);

  try {
    const resolvedSession = session ?? (await getShopSession(shopDomain));
    if (!resolvedSession) {
      throw new Error("No Shopify session found for shop");
    }

    const client = new shopify.api.clients.Graphql({ session: resolvedSession });

    console.log("[Order Tags] Fetching order", {
      shop: shopDomain,
      orderId: numericOrderId,
      orderGid,
      warrantyType,
    });

    const fetchResult = await client.request(
      `
      query GetOrderTags($id: ID!) {
        order(id: $id) {
          id
          name
          tags
        }
      }
      `,
      { variables: { id: orderGid } }
    );

    const fetchErrors = getGraphqlErrors(fetchResult);
    if (fetchErrors) {
      throw new Error(`Fetch failed: ${fetchErrors}`);
    }

    const order = fetchResult?.data?.order;
    if (!order) {
      throw new Error("Order not found");
    }

    const orderName = order.name || `#${numericOrderId}`;
    const rawTags = parseTags(order.tags);
    const removedInternal = rawTags.filter(isInternalOrderTag);
    const currentTags = sanitizeOrderTags(rawTags);
    const requiredTags = getRequiredTags(warrantyType);

    console.log("[Order Tags] Current tags", {
      orderName,
      orderId: numericOrderId,
      currentTags,
      requiredTags,
      removedInternal,
    });

    const needsInternalCleanup = removedInternal.length > 0;
    const needsWarrantyTags = !tagsAreComplete(currentTags, requiredTags);

    if (!needsInternalCleanup && !needsWarrantyTags) {
      console.log("[Order Tags] Already up to date — skipping", {
        shop: shopDomain,
        orderName,
      });
      return {
        success: true,
        skipped: true,
        reason: "already_up_to_date",
        orderName,
        orderId: numericOrderId,
      };
    }

    const updatedTags = mergeTags(currentTags, requiredTags);
    const mutationInput = { id: orderGid, tags: updatedTags };

    console.log("[Order Tags] Updating order", {
      shop: shopDomain,
      orderName,
      orderId: numericOrderId,
      mutationInput,
      updatedTags,
    });

    const updateResult = await client.request(
      `
      mutation OrderTagsUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            name
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
      `,
      { variables: { input: mutationInput } }
    );

    console.log("[Order Tags] Shopify API response", {
      orderName,
      orderId: numericOrderId,
      response: updateResult?.data?.orderUpdate ?? updateResult,
    });

    const topLevelErrors = getGraphqlErrors(updateResult);
    if (topLevelErrors) {
      throw new Error(`Mutation failed: ${topLevelErrors}`);
    }

    const userErrors = updateResult?.data?.orderUpdate?.userErrors || [];
    if (userErrors.length) {
      throw new Error(
        `userErrors: ${userErrors.map(error => error.message).join(", ")}`
      );
    }

    const appliedTags = parseTags(updateResult?.data?.orderUpdate?.order?.tags);
    console.log("[Order Tags] Success", {
      shop: shopDomain,
      orderName,
      orderId: numericOrderId,
      appliedTags,
    });

    return {
      success: true,
      skipped: false,
      orderName,
      orderId: numericOrderId,
      tags: appliedTags.length ? appliedTags : updatedTags,
    };
  } catch (err) {
    const reason = err.message || String(err);
    const scopeHint = /access denied|write_orders/i.test(reason)
      ? " Action required: re-authorize app with write_orders scope."
      : "";

    console.error("[Order Tags] Failed", {
      shop: shopDomain,
      orderId: numericOrderId,
      warrantyType,
      reason,
      scopeHint: scopeHint.trim() || undefined,
    });

    return { success: false, skipped: false, error: reason, orderId: numericOrderId };
  }
}

/**
 * After extended warranty activation, update both Shopify orders:
 * - Original product order: Standard Warranty + Extended Warranty
 * - EW purchase order: Extended Warranty only
 */
export async function syncExtendedWarrantyOrderTags({
  shop,
  productOrderId,
  purchaseOrderId,
  session = null,
  registerId = null,
}) {
  const shopDomain = String(shop || "").trim();
  const normalizedProductOrderId = normalizeOrderId(productOrderId);
  const normalizedPurchaseOrderId = normalizeOrderId(purchaseOrderId);

  console.log("[EW Tag Sync] Starting", {
    shop: shopDomain,
    registerId,
    originalProductOrderId: normalizedProductOrderId,
    extendedWarrantyOrderId: normalizedPurchaseOrderId,
  });

  if (!shopDomain) {
    console.log("[EW Tag Sync] Skipped — missing shop domain.");
    return { productOrder: null, purchaseOrder: null };
  }

  const results = {
    productOrder: null,
    purchaseOrder: null,
  };

  if (normalizedProductOrderId) {
    results.productOrder = await updateShopifyOrderTags(
      shopDomain,
      normalizedProductOrderId,
      WARRANTY_TAG_TYPES.EXTENDED_PRODUCT,
      session
    );
    console.log("[EW Tag Sync] Original product order result", {
      registerId,
      originalProductOrderId: normalizedProductOrderId,
      result: results.productOrder,
    });
  } else {
    console.log(
      "[EW Tag Sync] Skipped original product order — registration has no Shopify order.",
      { registerId }
    );
  }

  if (
    normalizedPurchaseOrderId &&
    !orderIdsMatch(normalizedProductOrderId, normalizedPurchaseOrderId)
  ) {
    results.purchaseOrder = await updateShopifyOrderTags(
      shopDomain,
      normalizedPurchaseOrderId,
      WARRANTY_TAG_TYPES.EXTENDED_PURCHASE,
      session
    );
    console.log("[EW Tag Sync] Extended warranty purchase order result", {
      registerId,
      extendedWarrantyOrderId: normalizedPurchaseOrderId,
      result: results.purchaseOrder,
    });
  } else if (normalizedPurchaseOrderId) {
    console.log(
      "[EW Tag Sync] Skipped EW purchase order update — same order as product order.",
      { registerId, orderId: normalizedPurchaseOrderId }
    );
  }

  const allSucceeded =
    (!results.productOrder || results.productOrder.success) &&
    (!results.purchaseOrder || results.purchaseOrder.success);

  console.log("[EW Tag Sync] Completed", {
    registerId,
    success: allSucceeded,
    results,
  });

  return results;
}
