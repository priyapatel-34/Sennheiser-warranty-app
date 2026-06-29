import crypto from "crypto";

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
