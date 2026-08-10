import crypto from "crypto";

/**
 * Verifies Shopify's app-proxy HMAC signature for storefront requests.
 * This is used before any storefront warranty route is allowed to trust the
 * incoming query parameters or session lookup.
 */
export function verifyAppProxy(req) {
  const { signature, ...params } = req.query;

  if (!signature) return false;

  const message = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("");

  const generatedSignature = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  return generatedSignature === signature;
}
