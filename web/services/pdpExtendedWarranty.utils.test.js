import test from "node:test";
import assert from "node:assert/strict";
import {
  isExtendedWarrantyLine,
  isPdpExtendedWarrantyLine,
  isWarrantyCatalogLine,
  findParentProductLine,
  entitlementMatchesShopifyProduct,
  assignEntitlementToProduct,
} from "./pdpExtendedWarranty.utils.js";

test("identifies PDP warranty lines without a registration id", () => {
  const pdpLine = {
    id: "11",
    properties: [
      { name: "_ew_type", value: "extended_warranty" },
      { name: "_ew_source", value: "pdp" },
      { name: "_ew_plan_id", value: "1022" },
    ],
  };
  const postRegLine = {
    id: "12",
    customAttributes: [
      { key: "_ew_type", value: "extended_warranty" },
      { key: "_ew_register_id", value: "72" },
    ],
  };

  assert.equal(isExtendedWarrantyLine(pdpLine), true);
  assert.equal(isPdpExtendedWarrantyLine(pdpLine), true);
  assert.equal(isPdpExtendedWarrantyLine(postRegLine), false);
});

test("matches a warranty child to the parent product/variant/plan line", () => {
  const parentA = {
    id: "20745756246302",
    product_id: "9960002060574",
    variant_id: "50469852414238",
    properties: [{ name: "_ew_plan_id", value: "1022" }],
  };
  const parentB = {
    id: "20745756246399",
    product_id: "9960002060574",
    variant_id: "50469852414238",
    properties: [{ name: "_ew_plan_id", value: "1023" }],
  };
  const warranty = {
    id: "99",
    properties: [
      { name: "_ew_type", value: "extended_warranty" },
      { name: "_ew_plan_id", value: "1022" },
      { name: "_ew_product_id", value: "9960002060574" },
      { name: "_ew_variant_id", value: "50469852414238" },
    ],
  };

  const matched = findParentProductLine(warranty, [parentB, parentA, warranty]);
  assert.equal(matched.id, "20745756246302");
});

test("does not attach an entitlement to a different product line", () => {
  const entitlement = {
    id: 29,
    shopify_order_id: "8837820186910",
    shopify_parent_line_item_id: "20745756246302",
    shopify_product_id: "9960002060574",
    shopify_variant_id: "50469852414238",
  };
  const otherProduct = {
    order_id: "gid://shopify/Order/8837820186910",
    line_item_id: "111",
    product_id: "111111",
    variant_id: "222222",
  };
  const matchingProduct = {
    order_id: "gid://shopify/Order/8837820186910",
    line_item_id: "20745756246302",
    product_id: "9960002060574",
    variant_id: "50469852414238",
  };

  assert.equal(entitlementMatchesShopifyProduct(entitlement, otherProduct), false);
  assert.equal(entitlementMatchesShopifyProduct(entitlement, matchingProduct), true);
  assert.equal(assignEntitlementToProduct(matchingProduct, [entitlement])?.id, 29);
});

test("skips warranty catalog lines from My Products matching", () => {
  assert.equal(
    isWarrantyCatalogLine({
      title: "Extended Warranty - +1 Year · 495.00 INR",
      sku: "EW-12-495.00-INR",
    }),
    true
  );
  assert.equal(
    isWarrantyCatalogLine({
      product: { handle: "sennheiser-extended-warranty", title: "Extended Warranty" },
    }),
    true
  );
  assert.equal(
    isWarrantyCatalogLine({
      product: { handle: "hd-550", title: "HD 550" },
      sku: "700455",
    }),
    false
  );
});

test("does not reuse one entitlement for two Shopify line items", () => {
  const entitlement = {
    id: 29,
    shopify_order_id: "8837820186910",
    shopify_parent_line_item_id: "20745756246302",
    shopify_product_id: "9960002060574",
    shopify_variant_id: "50469852414238",
  };
  const first = {
    order_id: "gid://shopify/Order/8837820186910",
    line_item_id: "20745756246302",
    product_id: "9960002060574",
    variant_id: "50469852414238",
  };
  const second = {
    order_id: "gid://shopify/Order/8837820186910",
    line_item_id: "20745756246303",
    product_id: "9960002060574",
    variant_id: "50469852414238",
  };
  const used = new Set();
  assert.equal(assignEntitlementToProduct(first, [entitlement], used)?.id, 29);
  assert.equal(assignEntitlementToProduct(second, [entitlement], used), null);
});
