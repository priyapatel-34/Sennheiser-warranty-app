
import dotenv from "dotenv";
dotenv.config();

console.log("API KEY:", process.env.SHOPIFY_API_KEY);
console.log("HOST:", process.env.HOST);

// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";


import { verifyAppProxy } from "./middleware/verifyAppProxy.js";
import warrantyRoutes from "./routes/warranty.routes.js";
import retailersRoutes from "./routes/retailers.routes.js";
import settingRoutes from "./routes/settings.routes.js";
import standardWarranty from "./routes/standardWarranty.routes.js";
//import webHookRoutes from "./routes/webhook.routes.js";
import registeredProducts from "./routes/registeredProducts.routes.js";


import { createStandardWarrantyMetafield } from "./shopify/metafieldDefinitions.js";
import { registerProductUpdateWebhook } from "./shopify/webhookCreation.js";


import { initDb } from "./db/initDb.js";

import { pool } from "./db/mysql.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
    process.env.NODE_ENV === "production"
      ? join(__dirname, "frontend", "dist")
      : join(__dirname, "frontend");
const app = express();
app.set("trust proxy", 1);
//app.use("/webhooks", webHookRoutes);

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  //shopify.redirectToShopifyOrAppRoot()
  async (req, res) => {
    const session = res.locals.shopify.session;

  // console.log("Session data::", session);

    if (!session) {
      return res.status(500).send("No session found");
    }

    // ✅ STORE SHOP IN MYSQL
    await pool.query(
      `
      INSERT INTO shops
        (shop_domain, access_token, scope, is_installed, installed_at)
      VALUES (?, ?, ?, TRUE, NOW())
      ON DUPLICATE KEY UPDATE
        access_token = VALUES(access_token),
        scope = VALUES(scope),
        is_installed = TRUE,
        uninstalled_at = NULL,
        updated_at = NOW()
      `,
      [
        session.shop,
        session.accessToken,
        session.scope,
      ]
    );

    console.log("✅ App installed for:", session.shop);



    const admin = new shopify.api.clients.Graphql({ session });


    // ✅ CREATE METAFIELD DEFINITION ON INSTALL
    await createStandardWarrantyMetafield(admin);

    await registerProductUpdateWebhook(admin);

    // ✅ redirect AFTER DB write
    return shopify.redirectToShopifyOrAppRoot();
  }
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

await initDb();


app.use("/app/retailers", shopify.validateAuthenticatedSession(), retailersRoutes);

app.use("/app/settings", shopify.validateAuthenticatedSession() , settingRoutes);

app.use("/app/warranty", shopify.validateAuthenticatedSession() , standardWarranty);

app.use("/app/registered-products", shopify.validateAuthenticatedSession() , registeredProducts);

app.use("/tws-warranty/*", authenticateUser);

async function authenticateUser(req, res, next) {
  console.log("IN auth 111");

  const { shop } = req.query;
  if (!shop) {
    return res.status(401).send("Missing shop");
  }

  // ✅ Verify app proxy signature
  if (!verifyAppProxy(req)) {
    return res.status(401).send("Invalid proxy signature");
  }

  const sessions =
    await shopify.config.sessionStorage.findSessionsByShop(shop);

  if (!sessions || !sessions.length) {
    return res.status(401).send("App not installed");
  }

  // Attach session for reuse
  res.locals.shopifySession = sessions[0];

  console.log("IN auth 333");
  next();
}

app.use("/tws-warranty" ,warrantyRoutes);

app.use("/api/*", shopify.validateAuthenticatedSession());

// const STATIC_PATH = join(process.cwd(), "web/dist");

// app.use(express.static(STATIC_PATH));

// app.get("*", (_req, res) => {
//   res.sendFile(join(STATIC_PATH, "index.html"));
// });


// app.get("/api/products/count", async (_req, res) => {
//   const client = new shopify.api.clients.Graphql({
//     session: res.locals.shopify.session,
//   });

//   const countData = await client.request(`
//     query shopifyProductCount {
//       productsCount {
//         count
//       }
//     }
//   `);

//   res.status(200).send({ count: countData.data.productsCount.count });
// });

// app.post("/api/products", async (_req, res) => {
//   let status = 200;
//   let error = null;

//   try {
//     await productCreator(res.locals.shopify.session);
//   } catch (e) {
//     console.log(`Failed to process products/create: ${e.message}`);
//     status = 500;
//     error = e.message;
//   }
//   res.status(status).send({ success: status === 200, error });
// });

console.log("ENV CHECK:");
console.log("API KEY:", process.env.SHOPIFY_API_KEY);
console.log("API SECRET:", process.env.SHOPIFY_API_SECRET);
console.log("port:", process.env.PORT);

console.log("HOST:", process.env.HOST);
console.log("SCOPES:", process.env.SCOPES);

app.use(shopify.cspHeaders());
// Serve only static assets folder
app.use("/assets", express.static(join(STATIC_PATH, "assets")));

// Final catch-all must be AFTER everything
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

app.listen(PORT);
