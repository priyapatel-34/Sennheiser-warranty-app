import { shopifyApp } from "@shopify/shopify-app-express";
import { restResources } from "@shopify/shopify-api/rest/admin/2026-01";
import { MySQLSessionStorage } from "@shopify/shopify-app-session-storage-mysql";

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env"),
});

const shopify = shopifyApp({
  api: {
    restResources,

    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,

    hostName: process.env.HOST.replace(/^https?:\/\//, ""),
    hostScheme: "https",

    apiVersion: "2026-01",
    isEmbeddedApp: true,

    future: {
      customerAddressDefaultFix: true,
      lineItemBilling: true,
      unstable_managedPricingSupport: true,
    },

    billing: undefined,
  },

  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },

  webhooks: {
    path: "/api/webhooks",
  },

  sessionStorage: new MySQLSessionStorage(
    process.env.MYSQL_DATABASE_URL
  ),

  useOnlineTokens: true,
});

export default shopify;