export const WARRANTY_PRICING_TYPE = {
    AMOUNT: "amount",
    PERCENTAGE: "percentage",
};

export const WARRANTY_BASE_PRICE_SOURCE = {
    COMPARE_AT: "compare_at",
    VARIANT: "variant",
};

export const DEFAULT_WARRANTY_PRICING_TYPE = WARRANTY_PRICING_TYPE.AMOUNT;

export const MAX_WARRANTY_PERCENTAGE = 100;

/**
 * Normalizes a saved pricing type so downstream pricing logic only has to
 * handle the supported amount or percentage modes.
 */
export function normalizeWarrantyPricingType(value) {
    return value === WARRANTY_PRICING_TYPE.PERCENTAGE
        ? WARRANTY_PRICING_TYPE.PERCENTAGE
        : WARRANTY_PRICING_TYPE.AMOUNT;
}

/**
 * Converts a stored price value into a finite number or null when the source
 * value is empty or invalid.
 */
export function parseProductPrice(value) {
    if (value == null || value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num;
}

/**
 * Percentage mode base price: Compare-at (MSRP) first, then variant price.
 */
export function resolvePercentageBasePrice({
    compareAtPrice,
    variantPrice,
} = {}) {
    const compareAt = parseProductPrice(compareAtPrice);
    if (compareAt != null && compareAt > 0) {
        return {
            basePrice: compareAt,
            basePriceSource: WARRANTY_BASE_PRICE_SOURCE.COMPARE_AT,
        };
    }

    const variant = parseProductPrice(variantPrice);
    if (variant != null && variant > 0) {
        return {
            basePrice: variant,
            basePriceSource: WARRANTY_BASE_PRICE_SOURCE.VARIANT,
        };
    }

    return null;
}

/**
 * Normalizes variant pricing inputs from either a raw number or a structured
 * object so percentage calculations can consume a single shape.
 */
export function normalizeVariantPricing(input) {
    if (input == null) return null;
    if (typeof input === "number") {
        return {
            compareAtPrice: null,
            variantPrice: parseProductPrice(input),
        };
    }
    return {
        compareAtPrice: parseProductPrice(input.compareAtPrice),
        variantPrice: parseProductPrice(input.variantPrice),
    };
}

/**
 * Validates the admin-entered warranty price before it is stored or used to
 * calculate the customer-facing warranty offer.
 */
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
 * In percentage mode, configuredPrice is the percentage of MSRP (compare-at),
 * falling back to variant price when compare-at is missing or zero.
 */
export function resolvePlanPrice({
    configuredPrice,
    pricingType,
    compareAtPrice,
    variantPrice,
    productVariantPrice,
    variantPricing,
}) {
    const type = normalizeWarrantyPricingType(pricingType);
    const configured = Number(configuredPrice);

    if (!Number.isFinite(configured)) {
        throw new Error("Invalid warranty price configuration");
    }

    if (type === WARRANTY_PRICING_TYPE.PERCENTAGE) {
        const pricing =
            normalizeVariantPricing(variantPricing) ||
            normalizeVariantPricing({
                compareAtPrice,
                variantPrice: variantPrice ?? productVariantPrice,
            });

        const base = resolvePercentageBasePrice(pricing);
        if (!base) {
            throw new Error(
                "Product price unavailable for percentage warranty calculation"
            );
        }

        const resolvedPrice =
            Math.round(((base.basePrice * configured) / 100) * 100) / 100;

        return {
            pricingType: type,
            price: configured,
            percentage: configured,
            calculatedPrice: resolvedPrice,
            resolvedPrice,
            basePrice: base.basePrice,
            basePriceSource: base.basePriceSource,
            compareAtPrice: pricing.compareAtPrice,
            variantPrice: pricing.variantPrice,
        };
    }

    return {
        pricingType: type,
        price: configured,
        percentage: null,
        calculatedPrice: configured,
        resolvedPrice: configured,
        basePrice: configured,
        basePriceSource: null,
        compareAtPrice: null,
        variantPrice: null,
    };
}

/**
 * Formats a configured percentage for display in the admin UI and previews.
 */
export function formatPercentage(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return `${num}%`;
}

/**
 * Formats a configured warranty price for display in the appropriate currency
 * or percentage representation depending on the selected pricing mode.
 */
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
