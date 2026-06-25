export const WARRANTY_PRICING_TYPE = {
  AMOUNT: "amount",
  PERCENTAGE: "percentage",
};

export const DEFAULT_WARRANTY_PRICING_TYPE = WARRANTY_PRICING_TYPE.AMOUNT;

export const MAX_WARRANTY_PERCENTAGE = 100;

export function normalizeWarrantyPricingType(value) {
  return value === WARRANTY_PRICING_TYPE.PERCENTAGE
    ? WARRANTY_PRICING_TYPE.PERCENTAGE
    : WARRANTY_PRICING_TYPE.AMOUNT;
}

export function validateConfiguredPlanPrice(price, pricingType) {
  const num = Number(price);
  const type = normalizeWarrantyPricingType(pricingType);

  if (!Number.isFinite(num)) {
    return { valid: false, error: "Invalid price value" };
  }

  if (type === WARRANTY_PRICING_TYPE.PERCENTAGE) {
    if (num <= 0) {
      return { valid: false, error: "Percentage must be greater than 0" };
    }
    if (num > MAX_WARRANTY_PERCENTAGE) {
      return {
        valid: false,
        error: `Percentage cannot exceed ${MAX_WARRANTY_PERCENTAGE}`,
      };
    }
  } else if (num < 0) {
    return { valid: false, error: "Amount must be greater than or equal to 0" };
  }

  return { valid: true, value: num };
}

/**
 * Resolve the customer-facing warranty price from stored configuration.
 * In amount mode, configuredPrice is the final price.
 * In percentage mode, configuredPrice is the percentage of productVariantPrice.
 */
export function resolvePlanPrice({
  configuredPrice,
  pricingType,
  productVariantPrice,
}) {
  const type = normalizeWarrantyPricingType(pricingType);
  const configured = Number(configuredPrice);

  if (!Number.isFinite(configured)) {
    throw new Error("Invalid warranty price configuration");
  }

  if (type === WARRANTY_PRICING_TYPE.PERCENTAGE) {
    if (productVariantPrice == null || productVariantPrice === "") {
      throw new Error(
        "Product price unavailable for percentage warranty calculation"
      );
    }
    const variantPrice = Number(productVariantPrice);
    if (!Number.isFinite(variantPrice) || variantPrice < 0) {
      throw new Error(
        "Product price unavailable for percentage warranty calculation"
      );
    }
    const resolvedPrice =
      Math.round(((variantPrice * configured) / 100) * 100) / 100;
    return {
      pricingType: type,
      price: configured,
      percentage: configured,
      calculatedPrice: resolvedPrice,
      resolvedPrice,
    };
  }

  return {
    pricingType: type,
    price: configured,
    percentage: null,
    calculatedPrice: configured,
    resolvedPrice: configured,
  };
}

export function formatPercentage(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return `${num}%`;
}

export function formatConfiguredPlanPrice({
  configuredPrice,
  pricingType,
  currency,
  locale,
}) {
  const type = normalizeWarrantyPricingType(pricingType);
  if (type === WARRANTY_PRICING_TYPE.PERCENTAGE) {
    return formatPercentage(configuredPrice);
  }

  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(configuredPrice));
  } catch {
    return `${Number(configuredPrice).toFixed(2)} ${currency || ""}`.trim();
  }
}
