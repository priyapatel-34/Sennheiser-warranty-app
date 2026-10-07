import { pool } from "../db/mysql.js";
import { normalizeLocale } from "./emailCopyCatalog.js";

export const INDIA_SHOP_DOMAINS = [
  "in.sennheiser-hearing.com",
];

export const PREORDER_METAFIELDS_SELECTION = `
  isPreorder: metafield(namespace: "custom", key: "is_preorder") {
    value
    type
  }
  preorderStartDate: metafield(namespace: "custom", key: "preorder_start_date") {
    value
    type
  }
  preorderEndDate: metafield(namespace: "custom", key: "preorder_end_date") {
    value
    type
  }
`;

export const STANDARD_PLUS_FREE_EXTENDED_LABEL =
  "Standard Warranty + Free Extended Warranty (1 year)";

/**
 * India registration-email sentences. These stay in code so the India store
 * does not need email-settings fields for them. English is the fallback when
 * a store language has no entry here.
 */
const INDIA_FREE_WARRANTY_EMAIL_COPY = {
  en: {
    freeWarrantyTitle: "FREE 1-Year Extended Warranty:",
    freeWarrantyBody: "Your product includes a FREE 1-year extended warranty.",
    preorderWarrantyBody:
      "Your product received a FREE 1-year extended warranty because it was purchased during the preorder offer.",
  },
};

export function getIndiaFreeWarrantyEmailCopy(languageCode) {
  const code = normalizeLocale(languageCode) || "en";
  return INDIA_FREE_WARRANTY_EMAIL_COPY[code] || INDIA_FREE_WARRANTY_EMAIL_COPY.en;
}

export const FREE_EXTENDED_WARRANTY_TAG = "Free_Extended_Warranty";

/** India-only product-tag rule. Kept for existing tagged registrations. */
export function hasIndiaFreeExtendedWarrantyTag(product, shopDomain) {
  if (!isIndiaShop(shopDomain)) return false;
  const tags = Array.isArray(product?.tags)
    ? product.tags
    : String(product?.tags || "").split(",");
  return tags.some(
    (tag) =>
      String(tag).trim().toLowerCase() === FREE_EXTENDED_WARRANTY_TAG.toLowerCase(),
  );
}

export function normalizeShopDomain(shopDomain) {
  return String(shopDomain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function isIndiaShop(shopDomain) {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized) return false;
  return INDIA_SHOP_DOMAINS.some((domain) => {
    const staticDomain = normalizeShopDomain(domain);
    return (
      normalized === staticDomain ||
      normalized === `www.${staticDomain}` ||
      normalized.endsWith(`.${staticDomain}`)
    );
  });
}

function metafieldNodes(product) {
  return (
    product?.metafields?.nodes ||
    product?.metafields?.edges?.map((edge) => edge.node) ||
    []
  );
}

function metafieldRawValue(metafield) {
  if (!metafield) return null;
  if (metafield.jsonValue !== undefined && metafield.jsonValue !== null) {
    return metafield.jsonValue;
  }
  return metafield.value ?? null;
}

function getCustomMetafieldValue(product, key) {
  const aliased = {
    is_preorder: product?.isPreorder,
    preorder_start_date: product?.preorderStartDate,
    preorder_end_date: product?.preorderEndDate,
  };
  if (aliased[key]) return metafieldRawValue(aliased[key]);

  const node = metafieldNodes(product).find(
    (metafield) =>
      (metafield?.namespace === "custom" || !metafield?.namespace) &&
      metafield?.key === key,
  );
  return metafieldRawValue(node);
}

function metafieldIsTrue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parseMetafieldDateTime(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value && typeof value === "object") {
    const year = value.year ?? value.Y;
    const month = value.month ?? value.M;
    const day = value.day ?? value.D;

    if (year && month && day) {
      const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(
        2,
        "0",
      )}-${String(day).padStart(2, "0")}`;

      return parseMetafieldDateTime(iso);
    }
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim().replace(/^"+|"+$/g, "");

  if (!trimmed) return null;

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function addMonthsSafe(startDate, months) {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const day = startDate.getDate();
  const targetMonth = month + months;
  const lastDayOfTargetMonth = new Date(year, targetMonth + 1, 0).getDate();
  return new Date(year, targetMonth, Math.min(day, lastDayOfTargetMonth));
}

export function isPreorderProduct(product) {
  return metafieldIsTrue(getCustomMetafieldValue(product, "is_preorder"));
}

export function isPreorderOfferWindowActive(product, now = new Date()) {
  const startValue = getCustomMetafieldValue(product, "preorder_start_date");
  const endValue = getCustomMetafieldValue(product, "preorder_end_date");
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return false;

  if (!startValue && !endValue) return true;

  const start = startValue ? parseMetafieldDateTime(startValue) : null;
  const end = endValue ? parseMetafieldDateTime(endValue) : null;
  if (start && current.getTime() < start.getTime()) return false;
  if (end && current.getTime() > end.getTime()) return false;
  return true;
}

export function isIndiaFreeExtendedWarrantyEligible(
  product,
  shopDomain,
) {
  if (!isIndiaShop(shopDomain)) return false;
  return isPreorderProduct(product);
}

export function shouldSuppressPaidExtendedWarranty(product, shopDomain) {
  return isIndiaShop(shopDomain) && isPreorderProduct(product);
}

export function getIndiaFreeExtendedWarrantySource(
  product,
  shopDomain,
) {
  return isIndiaFreeExtendedWarrantyEligible(product, shopDomain)
    ? "preorder_offer"
    : null;
}

export function computeFreeExtendedWarrantyRange(warrantyEnd) {
  const start =
    warrantyEnd instanceof Date ? new Date(warrantyEnd) : new Date(warrantyEnd);
  if (Number.isNaN(start.getTime())) return { start: null, end: null };
  return { start, end: addMonthsSafe(start, 12) };
}

export async function assignIndiaFreeExtendedWarranty(
  registered,
  product,
  shopDomain,
) {
  if (!registered?.id || Number(registered.free_extended_warranty) === 1) {
    return registered;
  }

  const eligible =
    isIndiaShop(shopDomain) &&
    (Boolean(Number(registered.preorder_product)) || isPreorderProduct(product));

  if (!eligible) return registered;

  const source = "preorder_offer";

  const { start, end } = computeFreeExtendedWarrantyRange(registered.warranty_end);
  if (!start || !end) return registered;

  await pool.query(
    `
    UPDATE registered_products
    SET
      free_extended_warranty = 1,
      free_extended_warranty_source = ?,
      free_extended_warranty_start = ?,
      free_extended_warranty_end = ?,
      preorder_product = 1
    WHERE id = ? AND shop_id = ?
    `,
    [source, start, end, registered.id, registered.shop_id],
  );

  return {
    ...registered,
    free_extended_warranty: 1,
    free_extended_warranty_source: source,
    free_extended_warranty_start: start,
    free_extended_warranty_end: end,
    preorder_product: 1,
  };
}

export async function loadProductPreorderMap(client, productIds = []) {
  const map = new Map();
  const uniqueIds = [
    ...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  if (!client || !uniqueIds.length) return map;

  for (let offset = 0; offset < uniqueIds.length; offset += 50) {
    const chunk = uniqueIds.slice(offset, offset + 50);
    try {
      const result = await client.request(
        `
        query ($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              ${PREORDER_METAFIELDS_SELECTION}
            }
          }
        }
        `,
        {
          variables: {
            ids: chunk.map((id) =>
              id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`,
            ),
          },
        },
      );

      for (const node of result.data?.nodes || []) {
        if (!node?.id) continue;
        map.set(node.id.split("/").pop(), {
          isPreorder: isPreorderProduct(node),
          inWindow: isPreorderOfferWindowActive(node),
          product: node,
        });
      }
    } catch (err) {
      console.warn("Preorder metafield lookup skipped:", err.message);
    }
  }

  return map;
}

export function registeredHidesPaidExtendedWarranty(registered) {
  return Boolean(
    registered?.free_extended_warranty || registered?.preorder_product,
  );
}
