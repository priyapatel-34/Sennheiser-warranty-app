import { emailButton } from "../emailTemp/_layout.js";
import { pool } from "../db/mysql.js";

const DEFAULT_MY_PRODUCTS_PATH = "/pages/my-products";

function normalizeShopDomain(shopDomain) {
  if (!shopDomain) return null;
  return String(shopDomain).replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/**
 * Relative path to My Products with a registration deep-link (no serial or PII).
 */
export function buildProductDetailsPath(
  registerId,
  myProductsPath = DEFAULT_MY_PRODUCTS_PATH
) {
  if (!registerId) return myProductsPath;
  const path = myProductsPath.startsWith("/")
    ? myProductsPath
    : `/${myProductsPath}`;
  return `${path}?registration_id=${encodeURIComponent(registerId)}`;
}

export function buildProductDetailsUrl(
  shopDomain,
  registerId,
  { myProductsPath = DEFAULT_MY_PRODUCTS_PATH } = {}
) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain || !registerId) return null;
  const detailsPath = buildProductDetailsPath(registerId, myProductsPath);
  return `https://${domain}${detailsPath}`;
}

function buildStorefrontLoginUrl(
  shopDomain,
  returnPath,
  accountsVersion = "NEW_CUSTOMER_ACCOUNTS"
) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain || !returnPath) return null;

  const normalizedPath = returnPath.startsWith("/")
    ? returnPath
    : `/${returnPath}`;
  const returnParam = encodeURIComponent(normalizedPath);

  if (accountsVersion === "CLASSIC") {
    return `https://${domain}/account/login?return_url=${returnParam}`;
  }

  return `https://${domain}/customer_authentication/login?return_to=${returnParam}`;
}

/**
 * Login URL that returns to the product details page after authentication.
 * return_to / return_url must be a relative storefront path (not a full URL).
 */
export function buildProductDetailsLoginUrl(
  shopDomain,
  registerId,
  options = {}
) {
  const detailsPath = buildProductDetailsPath(
    registerId,
    options.myProductsPath
  );
  if (!detailsPath || !registerId) return null;
  return buildStorefrontLoginUrl(
    shopDomain,
    detailsPath,
    options.accountsVersion
  );
}

export function buildMyProductsUrl(
  shopDomain,
  myProductsPath = DEFAULT_MY_PRODUCTS_PATH
) {
  const domain = normalizeShopDomain(shopDomain);
  if (!domain) return null;
  const path = myProductsPath.startsWith("/")
    ? myProductsPath
    : `/${myProductsPath}`;
  return `https://${domain}${path}`;
}

/**
 * Login URL that returns to My Products after authentication.
 */
export function buildMyProductsLoginUrl(shopDomain, options = {}) {
  const path = options.myProductsPath || DEFAULT_MY_PRODUCTS_PATH;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return buildStorefrontLoginUrl(
    shopDomain,
    normalizedPath,
    options.accountsVersion
  );
}

export function formatEmailDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().split("T")[0];
  }
  const str = String(value).trim();
  if (!str) return null;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return str;
  return parsed.toISOString().split("T")[0];
}

export async function resolveShopDisplayName(client, fallbackShopDomain) {
  const domain = normalizeShopDomain(fallbackShopDomain);
  let name = domain?.split(".")[0] || "Store";
  if (client?.request) {
    try {
      const result = await client.request(`query { shop { name } }`);
      name = result?.data?.shop?.name || name;
    } catch {
      // use fallback derived from domain
    }
  }
  return name;
}

export async function resolveCustomerAccountsVersion(client) {
  if (!client?.request) return "NEW_CUSTOMER_ACCOUNTS";
  try {
    const result = await client.request(`
      query {
        shop {
          customerAccountsV2 {
            customerAccountsVersion
          }
        }
      }
    `);
    return (
      result?.data?.shop?.customerAccountsV2?.customerAccountsVersion ||
      "NEW_CUSTOMER_ACCOUNTS"
    );
  } catch {
    return "NEW_CUSTOMER_ACCOUNTS";
  }
}

export function renderViewProductDetailsButton(
  shopDomain,
  registerId,
  options = {}
) {
  // Direct storefront link; logged-out visitors are sent to login by the theme
  // with a relative return_to path that preserves registration_id.
  const href = buildProductDetailsUrl(shopDomain, registerId, options);
  if (!href) return "";
  return `
    <p style="margin-top:24px;">
      ${emailButton({
        href,
        label: options.label || "View Product Details",
      })}
    </p>
  `;
}

export async function resolveShopDomain(shopId) {
  if (!shopId) return null;
  const [[row]] = await pool.query(
    `SELECT shop_domain FROM shops WHERE id = ? LIMIT 1`,
    [shopId]
  );
  return row?.shop_domain || null;
}

/** Prefer the storefront primary domain over myshopify.com for customer links. */
export async function resolveCustomerFacingShopDomain(client, fallbackShopDomain) {
  if (client) {
    try {
      const result = await client.request(`
        query {
          shop {
            primaryDomain {
              host
            }
          }
        }
      `);
      const host = result?.data?.shop?.primaryDomain?.host;
      if (host) return host;
    } catch (err) {
      console.warn("Primary domain lookup failed:", err.message);
    }
  }

  return normalizeShopDomain(fallbackShopDomain);
}