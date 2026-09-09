// Shared admin and storefront request auth helpers.
import { resolveShopId } from "./shop.js";

export function requireSession(
  res,
  { storefront = false, unauthorized = { error: "Unauthorized" } } = {}
) {
  const session = storefront
    ? res.locals.shopifySession
    : res.locals.shopify?.session;
  if (!session?.shop) {
    res.status(401).json(unauthorized);
    return null;
  }
  return session;
}

export async function requireShopId(
  session,
  res,
  notRegistered = { error: "Shop not registered" }
) {
  const shopId = await resolveShopId(session);
  if (!shopId) {
    res.status(404).json(notRegistered);
    return null;
  }
  return shopId;
}

export async function requireAdminShop(res, options = {}) {
  const session = requireSession(res, options);
  if (!session) return null;
  const shopId = await requireShopId(session, res, options.notRegistered);
  if (!shopId) return null;
  return { session, shopId };
}

export async function requireStorefrontShop(res, options = {}) {
  const session = requireSession(res, { ...options, storefront: true });
  if (!session) return null;
  const shopId = await requireShopId(session, res, options.notRegistered);
  if (!shopId) return null;
  return { session, shopId };
}
