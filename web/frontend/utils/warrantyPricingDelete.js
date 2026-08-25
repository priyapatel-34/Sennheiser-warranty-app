/**
 * Helpers for the extended-warranty pricing confirmation modal.
 */

export function toNumericShopifyId(gidOrId) {
  if (gidOrId == null || gidOrId === "") return "";
  const value = String(gidOrId).split("/").pop();
  return value || "";
}

export function buildRemovePricingModalContent({
  scope,
  product,
  variant,
  plan,
  duration,
} = {}) {
  const productName = product?.title || "this product";
  const variantName = variant?.name || variant?.title || "this variant";
  const planName = plan?.planName || duration?.planName || "this warranty plan";
  const priceLabel = plan?.displayPrice || plan?.price || "";

  if (scope === "product") {
    return {
      title: "Remove pricing?",
      confirmLabel: "Remove Pricing",
      body: `Are you sure you want to remove the warranty pricing for ${productName}?`,
      details: [
        `Product: ${productName}`,
        "This action will remove the selected pricing configuration.",
      ],
    };
  }

  if (scope === "variant") {
    return {
      title: "Remove pricing?",
      confirmLabel: "Remove Pricing",
      body: `Are you sure you want to remove the warranty pricing for ${variantName}?`,
      details: [`Product: ${productName}`, `Variant: ${variantName}`],
    };
  }

  return {
    title: "Remove pricing?",
    confirmLabel: "Remove Pricing",
    body: `Are you sure you want to remove the ${planName} pricing for ${variantName}?`,
    details: [
      `Product: ${productName}`,
      `Variant: ${variantName}`,
      `Warranty Plan: ${planName}`,
      priceLabel ? `Price: ${priceLabel}` : null,
    ].filter(Boolean),
  };
}

// export function buildRemoveOverrideModalContent(product) {
//   const productName = product?.title || "this product";
//   return {
//     title: "Remove from eligible list?",
//     confirmLabel: "Remove from list",
//     body: `Remove ${productName} from the extended-warranty eligible list? Existing pricing will not be deleted.`,
//     details: [`Product: ${productName}`],
//   };
// }
