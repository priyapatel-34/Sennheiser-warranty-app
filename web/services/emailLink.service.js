import { emailButton } from "../emailTemp/_layout.js";
import { pool } from "../db/mysql.js";

const DEFAULT_MY_PRODUCTS_PATH = "/pages/my-products";

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

/**
 * Customer-facing URL: login first (if needed), then My Products with registration deep-link.
 */
export function buildProductDetailsUrl(
  shopDomain,
  registerId,
  { myProductsPath = DEFAULT_MY_PRODUCTS_PATH } = {}
) {
  if (!shopDomain || !registerId) return null;
  const detailsPath = buildProductDetailsPath(registerId, myProductsPath);
  const returnUrl = encodeURIComponent(detailsPath);
  return `https://${shopDomain}/account/login?return_url=${returnUrl}`;
}

export function renderViewProductDetailsButton(
  shopDomain,
  registerId,
  options = {}
) {
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
