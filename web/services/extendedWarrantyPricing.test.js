import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePlanPrice,
  validateConfiguredPlanPrice,
  normalizeWarrantyPricingType,
  formatPercentage,
  formatConfiguredPlanPrice,
  WARRANTY_PRICING_TYPE,
} from "./extendedWarrantyPricing.js";

describe("normalizeWarrantyPricingType", () => {
  it("defaults unknown values to amount", () => {
    assert.equal(normalizeWarrantyPricingType(null), WARRANTY_PRICING_TYPE.AMOUNT);
    assert.equal(normalizeWarrantyPricingType("invalid"), WARRANTY_PRICING_TYPE.AMOUNT);
  });

  it("preserves percentage", () => {
    assert.equal(
      normalizeWarrantyPricingType("percentage"),
      WARRANTY_PRICING_TYPE.PERCENTAGE
    );
  });
});

describe("validateConfiguredPlanPrice", () => {
  it("accepts zero and positive amounts", () => {
    assert.equal(validateConfiguredPlanPrice(0, "amount").valid, true);
    assert.equal(validateConfiguredPlanPrice(500, "amount").valid, true);
    assert.equal(validateConfiguredPlanPrice(99.99, "amount").valid, true);
  });

  it("rejects negative amounts", () => {
    assert.equal(validateConfiguredPlanPrice(-1, "amount").valid, false);
  });

  it("requires percentage greater than zero and at most 100", () => {
    assert.equal(validateConfiguredPlanPrice(0, "percentage").valid, false);
    assert.equal(validateConfiguredPlanPrice(-5, "percentage").valid, false);
    assert.equal(validateConfiguredPlanPrice(10, "percentage").valid, true);
    assert.equal(validateConfiguredPlanPrice(100, "percentage").valid, true);
    assert.equal(validateConfiguredPlanPrice(101, "percentage").valid, false);
  });
});

describe("resolvePlanPrice", () => {
  it("returns configured amount in amount mode", () => {
    const result = resolvePlanPrice({
      configuredPrice: 500,
      pricingType: "amount",
      productVariantPrice: 10000,
    });
    assert.equal(result.pricingType, "amount");
    assert.equal(result.resolvedPrice, 500);
    assert.equal(result.calculatedPrice, 500);
    assert.equal(result.percentage, null);
  });

  it("calculates percentage of product price", () => {
    const result = resolvePlanPrice({
      configuredPrice: 10,
      pricingType: "percentage",
      productVariantPrice: 10000,
    });
    assert.equal(result.pricingType, "percentage");
    assert.equal(result.percentage, 10);
    assert.equal(result.resolvedPrice, 1000);
    assert.equal(result.calculatedPrice, 1000);
  });

  it("rounds percentage results to two decimal places", () => {
    const result = resolvePlanPrice({
      configuredPrice: 7.5,
      pricingType: "percentage",
      productVariantPrice: 999,
    });
    assert.equal(result.resolvedPrice, 74.93);
  });

  it("throws when product price is missing in percentage mode", () => {
    assert.throws(() =>
      resolvePlanPrice({
        configuredPrice: 10,
        pricingType: "percentage",
        productVariantPrice: null,
      })
    );
  });
});

describe("checkout price resolution integration", () => {
  it("keeps amount-mode plans unchanged for checkout", () => {
    const resolved = resolvePlanPrice({
      configuredPrice: 500,
      pricingType: "amount",
      productVariantPrice: 10000,
    });
    assert.equal(resolved.resolvedPrice, 500);
  });

  it("resolves percentage plans to currency amount for checkout", () => {
    const resolved = resolvePlanPrice({
      configuredPrice: 10,
      pricingType: "percentage",
      productVariantPrice: 10000,
    });
    assert.equal(resolved.resolvedPrice, 1000);
  });

  it("defaults to amount mode for backward-compatible stores", () => {
    const resolved = resolvePlanPrice({
      configuredPrice: 200,
      pricingType: undefined,
      productVariantPrice: 5000,
    });
    assert.equal(resolved.resolvedPrice, 200);
  });
});

describe("formatPercentage", () => {
  it("formats numeric percentages", () => {
    assert.equal(formatPercentage(5), "5%");
    assert.equal(formatPercentage(10.5), "10.5%");
  });
});

describe("formatConfiguredPlanPrice", () => {
  it("formats percentage values without currency", () => {
    assert.equal(
      formatConfiguredPlanPrice({
        configuredPrice: 8,
        pricingType: "percentage",
        currency: "USD",
      }),
      "8%"
    );
  });

  it("formats amount values with currency", () => {
    const formatted = formatConfiguredPlanPrice({
      configuredPrice: 100,
      pricingType: "amount",
      currency: "USD",
      locale: "en-US",
    });
    assert.match(formatted, /100/);
  });
});
