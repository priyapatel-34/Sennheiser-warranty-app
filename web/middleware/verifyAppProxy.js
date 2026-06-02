/*import crypto from "crypto";

export default function verifyAppProxy(req, res, next) {
  const secret = process.env.SHOPIFY_API_SECRET;

  if (!secret) {
    console.error("SHOPIFY_API_SECRET is missing");
    return res.status(500).send("Server misconfigured");
  }

  const { signature, ...query } = req.query;

  if (!signature) {
    return res.status(401).send("Missing signature");
  }

  const sorted = Object.keys(query)
    .sort()
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(",") : query[key]}`)
    .join("");

  const generated = crypto
    .createHmac("sha256", secret)
    .update(sorted)
    .digest("hex");

  if (generated !== signature) {
    return res.status(401).send("Invalid signature");
  }

  next();
}
*/


/*import crypto from "crypto";
import shopify from "../shopify.js"; // adjust path if needed

export default async function verifyAppProxy(req, res, next) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;

    if (!secret) {
      console.error("SHOPIFY_API_SECRET is missing");
      return res.status(500).send("Server misconfigured");
    }

    console.log(req.query);

    const { signature, shop, ...query } = req.query;

    if (!signature || !shop) {
      return res.status(401).send("Missing required parameters");
    }

    /**
     * ✅ Step 1: Verify HMAC
     *
    const sorted = Object.keys(query)
      .sort()
      .map(
        (key) =>
          `${key}=${
            Array.isArray(query[key]) ? query[key].join(",") : query[key]
          }`
      )
      .join("");

    const generated = crypto
      .createHmac("sha256", secret)
      .update(sorted)
      .digest("hex");


      console.log("generated", generated);

    if (generated !== signature) {
     // return res.status(401).send("Invalid signature");
      return res.status(401).json({
        success: false,
        error: "Invalid signature",
      });
    }

    /**
     * ✅ Step 2: Load OFFLINE session (THIS WAS MISSING)
     *
    const sessionId = `offline_${shop}`;
    const session = await shopify.sessionStorage.loadSession(sessionId);

    if (!session) {
      console.error("❌ Offline session not found for shop:", shop);
      return res.status(401).send("App not installed");
    }

    /**
     * ✅ Step 3: Attach session
     *
    res.locals.shopify = { session };

    next();
  } catch (error) {
    console.error("❌ verifyAppProxy error:", error);
    return res.status(500).send("Proxy verification failed");
  }
}*/


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

    //console.log("generatedSignature: ", generatedSignature);
    
    //console.log("signature: ", signature);

  return generatedSignature === signature;
}
