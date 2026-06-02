import 'dotenv/config';
import { BillingInterval } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
//import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import { restResources } from "@shopify/shopify-api/rest/admin/2026-01";
import { MySQLSessionStorage } from "@shopify/shopify-app-session-storage-mysql";

//const DB_PATH = `${process.cwd()}/database.sqlite`;

console.log("ENV CHECK:");
console.log("API KEY:", process.env.SHOPIFY_API_KEY);
console.log("API SECRET:", process.env.SHOPIFY_API_SECRET);
console.log("port:", process.env.PORT);

console.log("HOST:", process.env.HOST);
console.log("SCOPES:", process.env.SCOPES);
console.log("DATABASE_URL:", process.env.MYSQL_DATABASE_URL);


// The transactions with Shopify will always be marked as test transactions, unless NODE_ENV is production.
// See the ensureBilling helper to learn more about billing in this template.
const billingConfig = {
  "My Shopify One-Time Charge": {
    // This is an example configuration that would do a one-time charge for $5 (only USD is currently supported)
    amount: 5.0,
    currencyCode: "USD",
    interval: BillingInterval.OneTime,
  },
};

    //apiVersion: LATEST_API_VERSION,


    const shopify = shopifyApp({
      api: {
        restResources,
        apiKey: process.env.SHOPIFY_API_KEY,
        apiSecretKey: process.env.SHOPIFY_API_SECRET,
        hostName: process.env.HOST.replace(/^https?:\/\//, ""),
        hostScheme: "https",
        apiVersion: "2026-01",
        isEmbeddedApp: true,   // 👈 MOVE IT HERE
        future: {
          customerAddressDefaultFix: true,
          lineItemBilling: true,
          unstable_managedPricingSupport: true,
        },
        billing: undefined
      },
    
      auth: {
        path: "/api/auth",
        callbackPath: "/api/auth/callback",
      },
    
      webhooks: {
        path: "/api/webhooks",
      },
    
      sessionStorage: new MySQLSessionStorage(process.env.MYSQL_DATABASE_URL),
      
      useOnlineTokens: true,  
    });
// const shopify = shopifyApp({
//   api: {
//     restResources,
//     apiKey: process.env.SHOPIFY_API_KEY,
//     apiSecretKey: process.env.SHOPIFY_API_SECRET,
//     hostName: process.env.HOST.replace(/^https?:\/\//, ""),
//     hostScheme: "https",
//     apiVersion: "2026-01",
//     future: {
//       customerAddressDefaultFix: true,
//       lineItemBilling: true,
//       unstable_managedPricingSupport: true,
//     },
//     billing: undefined, // or replace with billingConfig above to enable example billing
//   },
//   auth: {
//     path: "/api/auth",
//     callbackPath: "/api/auth/callback",
//   },
//   webhooks: {
//     path: "/api/webhooks",
//   },
//   // This should be replaced with your preferred storage strategy
//   //sessionStorage: new SQLiteSessionStorage(DB_PATH),
//     sessionStorage: new MySQLSessionStorage(process.env.MYSQL_DATABASE_URL),
//     isEmbeddedApp: true,
//   // sessionStorage: new MySQLSessionStorage({
//   //   host: process.env.MYSQL_HOST,
//   //   port: Number(process.env.MYSQL_PORT) || 3306,
//   //   user: process.env.MYSQL_USER,
//   //   password: process.env.MYSQL_PASSWORD,
//   //   database: process.env.MYSQL_DATABASE,
//   //   ssl: {
//   //     rejectUnauthorized: false,
//   //   },
//   // }),

//   // sessionStorage: new MySQLSessionStorage({
//   //   host: process.env.MYSQL_HOST,
//   //   port: Number(process.env.MYSQL_PORT) || 3306,
//   //   user: process.env.MYSQL_USER,
//   //   password: process.env.MYSQL_PASSWORD,
//   //   database: process.env.MYSQL_DATABASE,
//   //   ssl: { rejectUnauthorized: false },
//   // }),
// });

export default shopify;
